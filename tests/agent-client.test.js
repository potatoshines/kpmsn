import test from "node:test";
import assert from "node:assert/strict";
import { createAgent, redact } from "../src/agent-client.js";
import { M } from "../src/data/members.js";

const maria = M[0];
const cfg = {
  url: "https://agent.example/",
  timeoutMs: 200,
  maxCalls: 3,
  contextLines: 2,
};
const mk = (o = {}) => createAgent({ cfg, getCode: () => "code1", ...o });
const lines = [
  ["Rep", "How can I help?"],
  ["Member", "Hi, this is Maria Alvarez, my number is 555-010-2231."],
  ["Member", "I cannot afford this bill"],
];
const ok = (items) => async () => ({ ok: true, json: async () => ({ items }) });

test("no url configured: keyword rules answer, no network call", async () => {
  let hit = 0;
  const a = createAgent({
    cfg: { ...cfg, url: "" },
    getCode: () => "code1",
    fetchFn: async () => (hit++, ok([])()),
  });
  const r = await a.tagMemberLine(lines, 3, maria);
  assert.equal(r.mode, "rules");
  assert.ok(r.items.some((x) => x.tag === "payment_difficulty"));
  assert.equal(hit, 0);
});

test("agent answer: only tags for the new line, normalized, de-duplicated, with the real line as evidence", async () => {
  let sent;
  const a = mk({
    fetchFn: async (url, o) => {
      sent = { url, o, body: JSON.parse(o.body) };
      return ok([
        { tag: "Payment Difficulty", source: "transcript", turn: 3, evidence: "x" },
        { tag: "payment_difficulty", source: "transcript", turn: 3, evidence: "x" },
        { tag: "medical_bills", source: "transcript", evidence: "x" },
        { tag: "food_insecurity", source: "transcript", turn: 2, evidence: "x" },
      ])();
    },
  });
  const r = await a.tagMemberLine(lines, 3, maria);
  assert.equal(r.mode, "agent");
  assert.deepEqual(
    r.items.map((x) => x.tag),
    ["payment_difficulty", "medical_bills"],
  );
  assert.ok(
    r.items.every((x) => x.source === "transcript" && x.turn === 3 && x.evidence === lines[2][1]),
  );
  assert.equal(sent.url, "https://agent.example/tag");
  assert.equal(sent.o.headers["x-admin-code"], "code1");
  assert.deepEqual(
    sent.body.transcript.map((t) => t.turn),
    [1, 2, 3],
  );
  assert.equal(sent.body.transcript[0].speaker, "representative");
});

test("identifiers are removed before anything is sent", async () => {
  let body;
  const a = mk({ fetchFn: async (u, o) => ((body = o.body), ok([])()) });
  await a.tagMemberLine(lines, 3, maria);
  for (const s of ["Maria", "Alvarez", "555-010-2231", "KP-100234"])
    assert.ok(!body.includes(s), s);
  assert.ok(body.includes("[removed]"));
  assert.equal(
    redact("call me at (626) 555-1234 or a.b@mail.com", null),
    "call me at [removed] or [removed]",
  );
});

test("failures fall back to the keyword rules and never throw", async () => {
  const bad = [
    async () => ({ ok: false, status: 502, json: async () => ({}) }),
    async () => ({ ok: true, json: async () => ({ nope: 1 }) }),
    async () => ({
      ok: true,
      json: async () => {
        throw new Error("bad json");
      },
    }),
    async () => {
      throw new TypeError("network");
    },
    (u, o) =>
      new Promise((_, rej) => o.signal.addEventListener("abort", () => rej(new Error("aborted")))),
  ];
  const warn = console.warn;
  console.warn = () => {};
  try {
    for (const f of bad) {
      const r = await mk({ fetchFn: f }).tagMemberLine(lines, 3, maria);
      assert.equal(r.mode, "fallback");
      assert.ok(r.items.some((x) => x.tag === "payment_difficulty"));
    }
  } finally {
    console.warn = warn;
  }
});

test("the same line is only sent once; the call cap switches to keyword rules", async () => {
  let n = 0;
  const a = mk({
    fetchFn: async () => (n++, ok([{ tag: "medical_bills", turn: 3 }])()),
  });
  await a.tagMemberLine(lines, 3, maria);
  const again = await a.tagMemberLine(lines, 3, maria);
  assert.equal(n, 1);
  assert.equal(again.mode, "agent");
  again.items[0].tag = "changed"; // callers cannot corrupt the cache
  assert.equal((await a.tagMemberLine(lines, 3, maria)).items[0].tag, "medical_bills");
  for (let k = 0; k < 6; k++) await a.tagMemberLine([["Member", "line " + k]], k + 10, maria);
  assert.equal(n, 3);
  assert.equal((await a.tagMemberLine([["Member", "one more bill"]], 99, maria)).mode, "fallback");
});

test("no admin code: nothing is ever sent, even with a URL configured", async () => {
  let hit = 0;
  const a = createAgent({ cfg, getCode: () => "", fetchFn: async () => (hit++, ok([])()) });
  assert.equal(a.enabled, false);
  assert.equal((await a.tagMemberLine(lines, 3, maria)).mode, "rules");
  assert.equal(hit, 0);
});

test("the server refusing the code or the daily limit is reported, not hidden", async () => {
  const st = (status) => async () => ({ ok: false, status, json: async () => ({}) });
  const r1 = await mk({ fetchFn: st(401) }).tagMemberLine(lines, 3, maria);
  assert.deepEqual([r1.mode, r1.reason], ["fallback", "unauthorized"]);
  const r2 = await mk({ fetchFn: st(429) }).tagMemberLine(lines, 3, maria);
  assert.deepEqual([r2.mode, r2.reason], ["fallback", "limit"]);
  const r3 = await mk({ fetchFn: st(500) }).tagMemberLine(lines, 3, maria);
  assert.equal(r3.reason, "error");
});

test("verify: accepts the right code, explains the wrong ones, and reads the budget", async () => {
  const res =
    (status, body = {}) =>
    async () => ({ ok: status === 200, status, json: async () => body });
  const a = mk({ fetchFn: res(200, { ok: true, remaining: 290, limit: 300, model: "gem" }) });
  const r = await a.verify(" code1 ");
  assert.equal(r.ok, true);
  assert.deepEqual(a.budget, { remaining: 290, limit: 300, model: "gem" });
  for (const [status, reason] of [
    [401, "wrong"],
    [429, "locked"],
    [503, "unconfigured"],
    [500, "network"],
  ])
    assert.equal((await mk({ fetchFn: res(status) }).verify("x")).reason, reason);
  assert.equal((await mk({ fetchFn: res(200) }).verify("  ")).reason, "wrong");
  assert.equal(
    (
      await mk({
        fetchFn: async () => {
          throw new Error("down");
        },
      }).verify("x")
    ).reason,
    "network",
  );
  assert.equal((await createAgent({ cfg: { ...cfg, url: "" } }).verify("x")).reason, "no_url");
});

test("the agent's reply updates the remaining-call budget", async () => {
  const a = mk({
    fetchFn: async () => ({
      ok: true,
      json: async () => ({ items: [], remaining: 41, limit: 50, model: "m" }),
    }),
  });
  await a.tagMemberLine(lines, 3, maria);
  assert.equal(a.budget.remaining, 41);
});
