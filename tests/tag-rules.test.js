import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildCatalog, matchTags } from "../src/data/catalog.js";
import { RULES, tagLine, tagProfile, recordContext } from "../src/data/tag-rules.js";
import { M } from "../src/data/members.js";

const c = buildCatalog(
  readFileSync(new URL("../src/data/kp_resource_opportunity_catalog.csv", import.meta.url), "utf8"),
);
const ids = (items) =>
  matchTags(
    c,
    items.map((x) => x.tag),
  ).map((h) => h.id);

test("every tag the simulated agent can emit exists in the catalog (no drift)", () => {
  const vocab = new Set(c.vocabulary);
  const tags = [
    ...RULES.flatMap((r) => r.tags),
    ...M.flatMap((m) => tagProfile(m).map((x) => x.tag)),
  ];
  for (const t of tags) assert.ok(vocab.has(t), `${t} is not in the catalog`);
  for (const r of RULES)
    assert.ok(
      r.tags.some((t) => c.idsForTag(t).length),
      `rule ${r.re} matches no row`,
    );
});

test("agent item shape matches the contract", () => {
  const [x] = tagLine("I can’t afford this", 2);
  assert.deepEqual(Object.keys(x).sort(), ["evidence", "source", "tag", "turn"]);
  assert.equal(x.source, "transcript");
  const [p] = tagProfile(M[0]);
  assert.deepEqual(Object.keys(p).sort(), ["evidence", "source", "tag"]);
});

test("sample members get the expected resources", () => {
  const [maria, james, linda] = M;
  assert.ok(ids(tagLine(maria.tr[1][1], 2)).includes("FIN-01"));
  assert.ok(ids(tagLine(maria.tr[3][1], 4)).includes("SOC-03"));
  assert.deepEqual(ids(tagProfile(maria)).sort(), ["EDU-03", "FIN-08", "WELL-08A"]);
  assert.deepEqual(ids(tagLine(james.tr[1][1], 2)), ["RX-03", "RX-05"]);
  assert.deepEqual(ids(tagLine(linda.tr[2][1], 3)), ["SOC-02"]);
  assert.deepEqual(ids(tagProfile(linda)), ["SOC-02"]);
});

test("lines with no catalog match produce nothing (ride and screening have no catalog row)", () => {
  assert.deepEqual(ids(tagLine(M[1].tr[2][1], 3)), []);
  assert.deepEqual(ids(tagLine(M[1].tr[4][1], 5)), []);
  assert.deepEqual(ids(tagLine("I just want to update my phone number.", 2)), []);
});

test("recordContext reads the member record", () => {
  assert.equal(recordContext(["payment_difficulty"], M[0]), "On record: $412.60 due 2026-11-05");
  assert.equal(recordContext(["prescription_refills"], M[1]), "On record: Lisinopril 10 mg");
});
