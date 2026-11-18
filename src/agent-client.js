// Client for the tagging agent. Sends one new member line (plus a little context) to POST {url}/tag and
// returns the tags in the shape applyTags() expects:
//   { tag, source: "transcript", turn, evidence }
// Nothing here throws: if the agent is off, slow, or returns something unusable, the keyword rules in
// tag-rules.js answer instead, and `mode` says which one produced the result.
//   mode "agent"    the agent answered
//   mode "rules"    no agent configured
//   mode "fallback" the agent was configured but could not be used for this line
import { AGENT } from "./config.js";
import { tagLine } from "./data/tag-rules.js";
import { normTag } from "./data/catalog.js";

const rx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Removes what identifies the member before any text leaves the browser: name, member ID, phone,
// date of birth, address, plus any phone number or email address that appears in the words.
export function redact(text, m) {
  const ids = new Set();
  if (m) {
    ids.add(m.id).add(m.ph).add(m.dob).add(m.addr).add(m.name);
    String(m.name || "")
      .split(/\s+/)
      .forEach((p) => ids.add(p));
    String(m.addr || "")
      .split(",")
      .forEach((p) => ids.add(p));
  }
  let out = String(text);
  [...ids]
    .map((s) => String(s || "").trim())
    .filter((s) => s.length >= 3)
    .sort((a, b) => b.length - a.length)
    .forEach((s) => (out = out.replace(new RegExp(rx(s), "gi"), "[removed]")));
  return out
    .replace(/(?:\(\s*)?\b\d{3}[-.\s)]*\d{3}[-.\s]?\d{4}\b/g, "[removed]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[removed]");
}

export function createAgent({ cfg = AGENT, fetchFn = (...a) => fetch(...a) } = {}) {
  const cache = new Map();
  let calls = 0;
  const enabled = !!cfg.url;

  // lines: [[speaker, text], ...] with the new line last; turn: that line's number (1-based).
  async function tagMemberLine(lines, turn, member) {
    const text = lines[lines.length - 1][1];
    const rules = (mode) => ({ items: tagLine(text, turn), mode });
    if (!enabled) return rules("rules");
    const first = Math.max(0, lines.length - 1 - (cfg.contextLines ?? 2));
    const send = lines.slice(first).map(([w, t], k) => ({
      turn: turn - (lines.length - 1 - (first + k)),
      speaker: String(w).toLowerCase() === "member" ? "member" : "representative",
      text: redact(t, member),
    }));
    const key = JSON.stringify([send, turn]);
    if (cache.has(key)) return { items: cache.get(key).map((x) => ({ ...x })), mode: "agent" };
    if (calls >= (cfg.maxCalls ?? 150)) return rules("fallback");
    calls++;
    const ctl = new AbortController(),
      timer = setTimeout(() => ctl.abort(), cfg.timeoutMs ?? 8000);
    try {
      const res = await fetchFn(cfg.url.replace(/\/+$/, "") + "/tag", {
        method: "POST",
        headers: { "content-type": "application/json", "x-app-secret": cfg.secret || "" },
        body: JSON.stringify({ transcript: send, profile: {} }),
        signal: ctl.signal,
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const body = await res.json();
      if (!body || !Array.isArray(body.items)) throw new Error("unexpected response");
      const seen = new Set(),
        items = [];
      for (const it of body.items) {
        const tag = normTag(it?.tag);
        // Only tags about the new line count; context lines were tagged when they played.
        if (!tag || seen.has(tag) || (it.turn != null && it.turn !== turn)) continue;
        seen.add(tag);
        items.push({ tag, source: "transcript", turn, evidence: text });
      }
      cache.set(key, items);
      return { items: items.map((x) => ({ ...x })), mode: "agent" };
    } catch (e) {
      console.warn("Tagging agent unavailable, using keyword rules:", e.message || e);
      return rules("fallback");
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    tagMemberLine,
    enabled,
    get calls() {
      return calls;
    },
  };
}
