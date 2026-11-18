// Resource catalog: reads kp_resource_opportunity_catalog.csv and turns each row into the shape the
// representative cards use. The CSV is the single source of truth; nothing from it is copied into code.
//
//   resource_id, resource_name, description, matching_tags, eligibility_description, resource_url, region
//
// Required: resource_name and resource_url. When either is missing the card says so and is flagged.
// Optional: description, eligibility_description and region. When empty the card leaves them out.
// matching_tags is what the tagging agent's tags are matched against (see matchTags).

export const CATALOG_URL = new URL("./kp_resource_opportunity_catalog.csv", import.meta.url);

const COLUMNS = [
  "resource_id",
  "resource_name",
  "description",
  "matching_tags",
  "eligibility_description",
  "resource_url",
  "region",
];
const ISSUE_TEXT = {
  name_missing: "resource_name is empty",
  link_missing: "resource_url is empty",
  link_invalid: "resource_url is not a valid http(s) link",
};

// Spreadsheet exports often write "empty" as N/A, null or nan; treat those as empty too.
const EMPTY = /^(?:|n\/a|#n\/a|nan|null|none|-|—)$/i;
const clean = (v) => {
  const s = String(v ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return EMPTY.test(s) ? "" : s;
};

// Tags compare case-insensitively with spaces and hyphens folded to underscores, so the agent may
// return "Payment Difficulty" and still match payment_difficulty.
export const normTag = (t) =>
  String(t ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
export const humanTag = (t) => {
  const s = normTag(t).replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
};

// RFC 4180: quoted cells, "" for a quote, commas and line breaks inside quotes, CRLF or LF, BOM.
export function parseCsv(text) {
  const s = String(text).replace(/^﻿/, "");
  const rows = [];
  let row = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c !== '"') cell += c;
      else if (s[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (quoted) throw new Error("The catalog file has an unterminated quote.");
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x.trim() !== ""));
}

// Only web links are allowed: a catalog cell must never become a javascript: or data: link.
export function safeUrl(v) {
  const s = clean(v);
  if (!s) return "";
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : "";
  } catch {
    return "";
  }
}

export function normalizeRow(raw) {
  const rawUrl = clean(raw.resource_url),
    url = safeUrl(rawUrl),
    name = clean(raw.resource_name),
    issues = [];
  if (!name) issues.push("name_missing");
  if (!rawUrl) issues.push("link_missing");
  else if (!url) issues.push("link_invalid");
  return {
    id: clean(raw.resource_id),
    name,
    description: clean(raw.description),
    eligibility: clean(raw.eligibility_description),
    url,
    region: clean(raw.region),
    tags: [
      ...new Set(
        String(raw.matching_tags ?? "")
          .split(/[,;|]/)
          .map(normTag)
          .filter(Boolean),
      ),
    ],
    issues,
  };
}

export function emptyCatalog() {
  return {
    rows: [],
    byId: new Map(),
    byTag: new Map(),
    order: new Map(),
    vocabulary: [],
    problems: [],
    get: () => undefined,
    idsForTag: () => [],
  };
}

// Throws when the file cannot be used at all. Row-level problems never throw: the row is kept and
// flagged (missing name or link) or skipped (no id, duplicate id), and a note goes into `problems`.
export function buildCatalog(text) {
  const table = parseCsv(text);
  if (!table.length) throw new Error("The catalog file is empty.");
  const head = table[0].map((h) => h.trim().toLowerCase());
  for (const c of ["resource_id", "matching_tags"])
    if (!head.includes(c)) throw new Error(`The catalog file has no "${c}" column.`);
  const problems = COLUMNS.filter((c) => !head.includes(c)).map((c) => `Column "${c}" is missing.`);
  const rows = [],
    byId = new Map(),
    byTag = new Map(),
    order = new Map();
  table.slice(1).forEach((cells, n) => {
    const r = normalizeRow(Object.fromEntries(head.map((h, j) => [h, cells[j] ?? ""])));
    if (!r.id) {
      problems.push(`Data row ${n + 1}: no resource_id, skipped.`);
      return;
    }
    if (byId.has(r.id)) {
      problems.push(`${r.id}: duplicate resource_id, later row skipped.`);
      return;
    }
    if (r.issues.length)
      problems.push(`${r.id}: ${r.issues.map((i) => ISSUE_TEXT[i]).join("; ")}.`);
    if (!r.tags.length) problems.push(`${r.id}: no matching_tags, so it can never be suggested.`);
    order.set(r.id, rows.length);
    rows.push(r);
    byId.set(r.id, r);
    r.tags.forEach((t) => (byTag.get(t) || byTag.set(t, []).get(t)).push(r.id));
  });
  return {
    rows,
    byId,
    byTag,
    order,
    vocabulary: [...byTag.keys()].sort(),
    problems,
    get: (id) => byId.get(id),
    idsForTag: (t) => byTag.get(normTag(t)) || [],
  };
}

export async function loadCatalog(url = CATALOG_URL) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`The catalog file could not be loaded (HTTP ${res.status}).`);
  return buildCatalog(await res.text());
}

// Which catalog rows do these tags select? A row is selected when it shares at least one tag, and
// rows sharing more tags come first (ties keep catalog order). The Python matcher uses the same rule.
export function matchTags(catalog, tags) {
  const hits = new Map();
  for (const t of tags)
    for (const id of catalog.idsForTag(t))
      (hits.get(id) || hits.set(id, new Set()).get(id)).add(normTag(t));
  return [...hits]
    .map(([id, set]) => ({ id, tags: [...set] }))
    .sort(
      (a, b) => b.tags.length - a.tags.length || catalog.order.get(a.id) - catalog.order.get(b.id),
    );
}
