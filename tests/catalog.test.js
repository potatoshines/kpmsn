// Run with: npm test   (Node's built-in test runner, no dependencies)
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildCatalog,
  parseCsv,
  normalizeRow,
  safeUrl,
  matchTags,
  normTag,
} from "../src/data/catalog.js";
import { cardParts, isFlagged, esc } from "../src/card.js";

const REAL = readFileSync(
  new URL("../src/data/kp_resource_opportunity_catalog.csv", import.meta.url),
  "utf8",
);
const HEAD =
  "resource_id,resource_name,description,matching_tags,eligibility_description,resource_url,region\n";
const cat = (...rows) => buildCatalog(HEAD + rows.join("\n"));

test("the real catalog loads clean: 35 rows, no problems, nothing flagged", () => {
  const c = buildCatalog(REAL);
  assert.equal(c.rows.length, 35);
  assert.deepEqual(c.problems, []);
  assert.equal(c.rows.filter(isFlagged).length, 0);
  assert.equal(c.get("FIN-01").name, "Medical Financial Assistance (MFA)");
});

test("parseCsv handles quotes, escaped quotes, commas, line breaks, CRLF and a BOM", () => {
  const t = parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n"multi\nline",z');
  assert.deepEqual(t, [
    ["a", "b"],
    ["x, y", 'say "hi"'],
    ["multi\nline", "z"],
  ]);
  assert.throws(() => parseCsv('a,"unterminated'), /unterminated/);
});

test("full row: every field is kept", () => {
  const r = cat('A-1,Name,Desc,"t1, t2",Elig,https://example.org/x,Region X').get("A-1");
  assert.equal(r.name, "Name");
  assert.equal(r.description, "Desc");
  assert.equal(r.eligibility, "Elig");
  assert.equal(r.region, "Region X");
  assert.deepEqual(r.tags, ["t1", "t2"]);
  assert.deepEqual(r.issues, []);
});

test("optional fields empty (or N/A): the card has no label for them", () => {
  for (const blank of ["", "  ", "N/A", "null", "nan", "none"]) {
    const html = cardParts(
      cat(`A-1,Name,${blank},t1,${blank},https://example.org/x,${blank}`).get("A-1"),
    ).body;
    assert.ok(!html.includes("Eligibility"), `blank=${JSON.stringify(blank)}`);
    assert.ok(!html.includes("Region"), `blank=${JSON.stringify(blank)}`);
    assert.ok(!/<p>\s*<\/p>/.test(html), "no empty description paragraph");
    assert.ok(html.includes("Open program link"));
    assert.ok(!html.includes("Description:"), "no Description label without a description");
  }
});

test("optional fields present: description (bold label), eligibility, region, then the link last", () => {
  const html = cardParts(
    cat("A-1,Name,Desc,t1,Elig,https://example.org/x,Region X").get("A-1"),
  ).body;
  const at = (s) => html.indexOf(s);
  assert.ok(html.includes("<b>Description:</b> Desc"));
  assert.ok(
    at("Description:") < at("Eligibility:") &&
      at("Eligibility:") < at("Region:") &&
      at("Region:") < at("Open program link"),
  );
  assert.equal(html.trim().endsWith("</a></p>"), true, "the link is the last element on the card");
});

test("missing name: shown as not available, flagged, not shareable", () => {
  const r = cat("A-1,,Desc,t1,Elig,https://example.org/x,R").get("A-1");
  const { title, body, flagged } = cardParts(r);
  assert.ok(flagged && isFlagged(r));
  assert.match(title, /Resource name not available/);
  assert.match(body, /cannot be added to a follow-up/);
  assert.ok(!title.includes("undefined"));
});

test("missing link: shown as not available, flagged, not shareable", () => {
  const r = cat("A-1,Name,Desc,t1,Elig,,R").get("A-1");
  const { body, flagged } = cardParts(r);
  assert.ok(flagged);
  assert.match(body, /Link not available/);
  assert.ok(!body.includes("<a "), "no anchor without a link");
  assert.ok(
    body.indexOf("Region:") < body.indexOf("Link not available"),
    "the flag sits where the link would be, last",
  );
});

test("missing name and link together report both", () => {
  const c = cat("A-1,,Desc,t1,Elig,,R");
  const { title, body } = cardParts(c.get("A-1"));
  assert.match(title, /name not available/);
  assert.match(body, /Link not available/);
  assert.equal(c.problems.length, 1);
  assert.match(c.problems[0], /resource_name is empty; resource_url is empty/);
});

test("unsafe or malformed links are rejected, not rendered", () => {
  for (const bad of [
    "javascript:alert(1)",
    "data:text/html,x",
    "ftp://x.org/a",
    "not a url",
    "//example.org",
  ]) {
    const r = normalizeRow({ resource_id: "A", resource_name: "N", resource_url: bad });
    assert.equal(r.url, "", bad);
    assert.ok(r.issues.includes("link_invalid"), bad);
    assert.match(cardParts(r).body, /not a valid web address/);
  }
  assert.equal(safeUrl("https://example.org/a b"), "https://example.org/a%20b");
});

test("catalog text is HTML-escaped on the card", () => {
  const r = normalizeRow({
    resource_id: "A",
    resource_name: '<img src=x onerror="alert(1)">',
    description: "<script>x</script>",
    eligibility_description: "a & b",
    resource_url: 'https://example.org/?q="x"&y=<z>',
    region: "<b>r</b>",
  });
  const { title, body } = cardParts(r);
  assert.equal(
    title,
    '<b>&lt;img src=x onerror="alert(1)"&gt;</b>',
    "tag characters escaped, so it renders as text",
  );
  for (const html of [title, body])
    assert.ok(!/<(img|script)\b/i.test(html), "no raw tag from catalog text");
  assert.ok(!body.includes('"x"'), "quotes in the link are escaped inside the attribute");
  assert.equal(esc("<&>"), "&lt;&amp;&gt;");
});

test("bad rows never throw: no id and duplicate id are skipped with a note", () => {
  const c = cat(
    "A-1,One,d,t1,e,https://example.org/1,r",
    ",NoId,d,t1,e,https://example.org/2,r",
    "A-1,Dup,d,t1,e,https://example.org/3,r",
  );
  assert.equal(c.rows.length, 1);
  assert.equal(c.get("A-1").name, "One");
  assert.equal(c.problems.length, 2);
});

test("a row with no tags is kept but reported", () => {
  const c = cat("A-1,Name,d,,e,https://example.org/1,r");
  assert.equal(c.rows.length, 1);
  assert.match(c.problems[0], /no matching_tags/);
});

test("unusable files throw clear errors", () => {
  assert.throws(() => buildCatalog(""), /empty/);
  assert.throws(() => buildCatalog("resource_name,description\nx,y"), /resource_id/);
  assert.throws(() => buildCatalog("resource_id,resource_name\nx,y"), /matching_tags/);
});

test("a missing optional column is reported and the rest still works", () => {
  const c = buildCatalog(
    "resource_id,resource_name,matching_tags,resource_url\nA,N,t1,https://example.org/",
  );
  assert.ok(c.problems.some((p) => p.includes('"region"')));
  assert.equal(c.get("A").region, "");
});

test("matchTags: shared tags select rows, more shared tags rank first, catalog order breaks ties", () => {
  const c = buildCatalog(REAL);
  const hit = matchTags(c, ["medical_bills", "payment_difficulty", "payment_plans"]);
  assert.deepEqual(
    hit.map((h) => h.id),
    ["FIN-08", "FIN-01"],
    "FIN-08 shares 3 tags, FIN-01 shares 2",
  );
  assert.deepEqual(matchTags(c, ["no_such_tag"]), []);
  assert.deepEqual(
    matchTags(c, ["Payment Difficulty"]).map((h) => h.id),
    ["FIN-01", "FIN-08"],
  );
  assert.equal(normTag(" Type-2 Diabetes "), "type_2_diabetes");
});
