import test from "node:test";
import assert from "node:assert/strict";
import { validateRun, buildRun, loadRun, runItems } from "../src/recorded.js";

const good = () => ({
  version: 1,
  member: "KP-1",
  recordedAt: "2026-11-18T17:02:11.000Z",
  model: "gemini-x",
  transcript: [
    ["Rep", "How can I help?"],
    ["Member", "I cannot afford this bill"],
    ["Rep", "Ok"],
    ["Member", "thanks"],
  ],
  tags: { 2: ["Payment Difficulty", "medical_bills"], 4: [] },
});
const err = (mut, re) => {
  const r = good();
  mut(r);
  const v = validateRun(r, "KP-1");
  assert.equal(v.ok, false);
  assert.match(v.error, re);
};

test("a good run is accepted and tags are normalized", () => {
  const v = validateRun(good(), "KP-1");
  assert.equal(v.ok, true);
  assert.deepEqual(v.run.tags[2], ["payment_difficulty", "medical_bills"]);
  assert.deepEqual(
    runItems(v.run, 2).map((x) => [x.tag, x.turn, x.source]),
    [
      ["payment_difficulty", 2, "transcript"],
      ["medical_bills", 2, "transcript"],
    ],
  );
  assert.equal(runItems(v.run, 2)[0].evidence, "I cannot afford this bill");
  assert.deepEqual(runItems(v.run, 4), []);
});

test("bad files are rejected with a clear reason", () => {
  assert.equal(validateRun(null, "KP-1").ok, false);
  assert.equal(validateRun([], "KP-1").ok, false);
  assert.equal(validateRun("x", "KP-1").ok, false);
  err((r) => (r.version = 2), /version/);
  err((r) => (r.member = "KP-2"), /KP-2/);
  err((r) => (r.transcript = []), /empty/);
  err((r) => (r.transcript = "x"), /empty/);
  err((r) => (r.transcript[0] = ["Bot", "hi"]), /Rep or Member/);
  err((r) => (r.transcript[0] = ["Rep", "  "]), /no text/);
  err((r) => (r.transcript[0] = ["Rep"]), /\[speaker, text\]/);
  err((r) => (r.transcript[0] = ["Rep", "x".repeat(601)]), /longer than/);
  err((r) => (r.transcript = Array.from({ length: 101 }, () => ["Rep", "x"])), /more than/);
  err((r) => (r.transcript = [["Rep", "only rep"]]), /no Member lines/);
  err((r) => delete r.tags, /tags are missing/);
  err((r) => (r.tags[1] = ["x"]), /not a Member line/);
  err((r) => (r.tags[9] = ["x"]), /not a Member line/);
  err((r) => (r.tags[2] = "x"), /short list/);
  err((r) => (r.tags[2] = [1]), /short list/);
  err((r) => delete r.tags[4], /no tag entry/);
  err((r) => (r.recordedAt = "yesterday"), /recordedAt/);
});

test("buildRun only produces complete files and round-trips through validateRun", () => {
  const g = good();
  const b = buildRun({
    member: "KP-1",
    transcript: g.transcript,
    tagsByTurn: { 2: ["medical_bills"], 4: [] },
    model: "m",
  });
  assert.equal(b.ok, true);
  assert.equal(validateRun(JSON.parse(b.json), "KP-1").ok, true);
  const missing = buildRun({ member: "KP-1", transcript: g.transcript, tagsByTurn: { 2: [] } });
  assert.equal(missing.ok, false);
});

test("loadRun: missing, broken, invalid, wrong member and unsafe ids", async () => {
  const res =
    (status, body, json = true) =>
    async () => ({
      ok: status === 200,
      status,
      json: json
        ? async () => body
        : async () => {
            throw new Error("bad");
          },
    });
  assert.equal((await loadRun("KP-1", res(200, good()))).ok, true);
  const miss = await loadRun("KP-1", res(404));
  assert.deepEqual([miss.ok, miss.missing], [false, true]);
  assert.match((await loadRun("KP-1", res(500))).error, /HTTP 500/);
  assert.match((await loadRun("KP-1", res(200, null, false))).error, /not valid JSON/);
  assert.match((await loadRun("KP-1", res(200, { ...good(), member: "KP-2" }))).error, /invalid/);
  assert.match(
    (
      await loadRun("KP-1", async () => {
        throw new Error("x");
      })
    ).error,
    /network/,
  );
  let asked = false;
  assert.equal((await loadRun("../secret", async () => (asked = true))).ok, false);
  assert.equal(asked, false);
});
