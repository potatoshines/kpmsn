// Keyword tagger. It stands in for the tagging agent when none is configured (src/config.js) and is the
// fallback when the agent cannot be reached. The profile tags (tagProfile) always come from here: they
// read structured fields, so they need no model.
//
// It does what the agent will do: read a member line or the member record and return tags, each one
// with the evidence it came from. Everything after that (matching tags to catalog rows, cards,
// follow-up) works on these items and does not care who produced them:
//
//   { tag: "payment_difficulty", source: "transcript", turn: 2, evidence: "the member's words" }
//   { tag: "outstanding_balance", source: "profile", evidence: "Balance on record: $412.60 ..." }
//
// Tags must come from the catalog's matching_tags vocabulary (tests/tag-rules.test.js checks this).

export const RULES = [
  { re: /afford|can.t pay|cannot pay|struggl|owe/i, tags: ["payment_difficulty"] },
  { re: /bill/i, tags: ["medical_bills"] },
  {
    re: /payment plan|monthly|installment|over time/i,
    tags: ["payment_plans", "installment_payments"],
  },
  { re: /\brent\b|housing|evict|landlord/i, tags: ["rent_assistance", "housing_insecurity"] },
  {
    re: /food|groceries|hungry|pantry/i,
    tags: ["food_assistance", "food_insecurity", "grocery_access"],
  },
  { re: /electric|utilit|heating/i, tags: ["utility_assistance", "utility_bills"] },
  { re: /childcare|daycare/i, tags: ["childcare_assistance", "childcare_access"] },
  {
    re: /refill|pharmacy|prescription|delivery/i,
    tags: ["prescription_refills", "prescription_delivery"],
  },
  { re: /diabet|blood sugar/i, tags: ["diabetes_education", "diabetes_support"] },
  { re: /smok|vaping|tobacco|nicotine/i, tags: ["tobacco_cessation", "quit_smoking"] },
  { re: /pregnan|prenatal/i, tags: ["pregnancy_support"] },
  { re: /caregiver|caring for my/i, tags: ["caregiver_support"] },
];

export const tagText = (text) => [
  ...new Set(RULES.filter((r) => r.re.test(text)).flatMap((r) => r.tags)),
];

export const tagLine = (text, turn) =>
  tagText(text).map((tag) => ({ tag, source: "transcript", turn, evidence: text }));

export function tagProfile(m) {
  const out = [],
    add = (tags, evidence) => tags.forEach((tag) => out.push({ tag, source: "profile", evidence }));
  if (m.due > 0)
    add(["outstanding_balance"], `Balance on record: $${m.due.toFixed(2)} due ${m.dd}`);
  if (m.sn) {
    const why = `Social-needs screening on record: ${m.sn}`;
    if (/food/i.test(m.sn)) add(["food_insecurity"], why);
    else if (/hous|rent|shelter/i.test(m.sn)) add(["housing_insecurity"], why);
    else if (/utilit|electric/i.test(m.sn)) add(["utility_assistance"], why);
    else add(["community_resource_navigation"], why);
  }
  if (/diabet/i.test(m.cond || ""))
    add(["type_2_diabetes", "living_with_diabetes"], `Condition on record: ${m.cond}`);
  return out;
}

// One line of context from the member record to show under a detected concern. The app adds this
// itself from the record; the agent does not need to return it.
export function recordContext(tags, m) {
  const has = (re) => tags.some((t) => re.test(t));
  if (has(/bill|payment|balance|installment|cost/))
    return m.due ? `On record: $${m.due.toFixed(2)} due ${m.dd}` : "On record: no amount due";
  if (has(/prescription|refill|medication|pharmacy|delivery/)) return `On record: ${m.meds}`;
  if (has(/diabet/)) return `On record: ${m.cond}`;
  return `On record: ${m.plan}`;
}
