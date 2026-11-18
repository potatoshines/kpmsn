// Saved ("recorded") agent runs. The public site never calls the agent; it replays one of these files,
// which an admin created by running the real agent live and saving the result. One file per member:
//
//   src/data/recorded/KP-100234.json
//   { "version": 1, "member": "KP-100234", "recordedAt": "2026-11-18T17:02:11.000Z", "model": "gemini-...",
//     "transcript": [["Rep", "..."], ["Member", "..."]],
//     "tags": { "2": ["medical_bills", "payment_difficulty"], "4": [] } }
//
// `tags` is keyed by the 1-based line number of each Member line and holds only what the agent returned.
// The cards are computed from these tags and the current catalog every time, so a catalog edit shows up
// without recording again. Anything that does not match this shape is rejected with a plain message.
import { normTag } from "./data/catalog.js";

export const RUN_VERSION = 1,
  MAX_LINES = 100,
  MAX_TEXT = 600,
  MAX_TAGS = 20;
const ID = /^[A-Za-z0-9-]{1,32}$/;

export function validateRun(raw, memberId) {
  const bad = (error) => ({ ok: false, error });
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return bad("It is not a JSON object.");
  if (raw.version !== RUN_VERSION) return bad(`Unsupported version (expected ${RUN_VERSION}).`);
  if (raw.member !== memberId) return bad(`It is for member ${raw.member}, not ${memberId}.`);
  const t = raw.transcript;
  if (!Array.isArray(t) || !t.length) return bad("The transcript is missing or empty.");
  if (t.length > MAX_LINES) return bad(`The transcript has more than ${MAX_LINES} lines.`);
  const transcript = [];
  for (const [n, line] of t.entries()) {
    if (!Array.isArray(line) || line.length !== 2)
      return bad(`Line ${n + 1} is not [speaker, text].`);
    const [who, text] = line;
    if (who !== "Rep" && who !== "Member")
      return bad(`Line ${n + 1}: speaker must be Rep or Member.`);
    if (typeof text !== "string" || !text.trim()) return bad(`Line ${n + 1} has no text.`);
    if (text.length > MAX_TEXT) return bad(`Line ${n + 1} is longer than ${MAX_TEXT} characters.`);
    transcript.push([who, text.trim()]);
  }
  if (!transcript.some(([w]) => w === "Member")) return bad("The transcript has no Member lines.");
  if (!raw.tags || typeof raw.tags !== "object" || Array.isArray(raw.tags))
    return bad("The tags are missing.");
  const tags = {};
  for (const [k, v] of Object.entries(raw.tags)) {
    const n = Number(k);
    if (!Number.isInteger(n) || n < 1 || n > transcript.length || transcript[n - 1][0] !== "Member")
      return bad(`Tags are attached to line "${k}", which is not a Member line.`);
    if (
      !Array.isArray(v) ||
      v.length > MAX_TAGS ||
      v.some((x) => typeof x !== "string" || x.length > 80)
    )
      return bad(`The tags for line ${k} are not a short list of text values.`);
    tags[n] = [...new Set(v.map(normTag).filter(Boolean))];
  }
  transcript.forEach(([w], n) => {
    if (w === "Member" && !tags[n + 1]) tags[n + 1] = null;
  });
  const missing = Object.keys(tags).filter((k) => tags[k] === null);
  if (missing.length)
    return bad(`Member line(s) ${missing.join(", ")} have no tag entry (use [] for none).`);
  const when = new Date(raw.recordedAt);
  if (typeof raw.recordedAt !== "string" || Number.isNaN(+when))
    return bad("recordedAt is not a date.");
  return {
    ok: true,
    run: {
      member: memberId,
      recordedAt: when.toISOString(),
      model: String(raw.model || "").slice(0, 80),
      transcript,
      tags,
    },
  };
}

// Builds a file from a finished live run. Refuses anything that is not a complete, clean agent run.
export function buildRun({ member, transcript, tagsByTurn, model, recordedAt = new Date() }) {
  const raw = {
    version: RUN_VERSION,
    member,
    recordedAt: new Date(recordedAt).toISOString(),
    model: model || "",
    transcript,
    tags: tagsByTurn,
  };
  const v = validateRun(JSON.parse(JSON.stringify(raw)), member);
  return v.ok ? { ok: true, run: raw, json: JSON.stringify(raw, null, 2) + "\n" } : v;
}

export async function loadRun(memberId, fetchFn = (...a) => fetch(...a)) {
  if (!ID.test(String(memberId))) return { ok: false, error: "Unknown member." };
  try {
    const res = await fetchFn(new URL(`./data/recorded/${memberId}.json`, import.meta.url));
    if (res.status === 404)
      return { ok: false, missing: true, error: "No recorded run exists for this member yet." };
    if (!res.ok)
      return { ok: false, error: `The recorded run could not be loaded (HTTP ${res.status}).` };
    let raw;
    try {
      raw = await res.json();
    } catch {
      return { ok: false, error: "The recorded run file is not valid JSON." };
    }
    const v = validateRun(raw, memberId);
    return v.ok ? v : { ok: false, error: "The recorded run file is invalid. " + v.error };
  } catch {
    return { ok: false, error: "The recorded run could not be loaded (network error)." };
  }
}

// The agent-style items for one Member line of a recorded run, as applyTags() expects.
export const runItems = (run, turn) =>
  (run.tags[turn] || []).map((tag) => ({
    tag,
    source: "transcript",
    turn,
    evidence: run.transcript[turn - 1][1],
  }));
