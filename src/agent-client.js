// Client for the tagging agent. Sends one new member line (plus a little context) to POST {url}/tag and
// returns the tags in the shape applyTags() expects:
//   { tag, source: "transcript", turn, evidence }
// The agent costs money per call, so it is only used with the admin code (sent as x-admin-code and
// checked by the server). With no code, nothing is ever sent. Nothing here throws: if the agent is off,
// slow, refused or returns something unusable, the keyword rules in tag-rules.js answer instead, and
// `mode` says which one produced the result.
//   mode "agent"    the agent answered
//   mode "rules"    no agent available (no URL or no admin code)
//   mode "fallback" the agent could not be used for this line; `reason` is "unauthorized" (the server
//                   refused the code), "limit" (daily or page limit), or "error"

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

export function createAgent({
  cfg = AGENT,
  fetchFn = (...a) => fetch(...a),
  getCode = () => "",
} = {}) {
  const cache = new Map();
  let calls = 0,
    budget = null; // { remaining, limit, model } from the server's last reply
  const base = () => String(cfg.url || "").replace(/\/+$/, "");
  const enabled = () => !!cfg.url && !!getCode();
  const note = (b) => {
    if (b && typeof b.remaining === "number")
      budget = { remaining: b.remaining, limit: b.limit, model: b.model || budget?.model || "" };
  };
  async function post(path, payload, code) {
    const ctl = new AbortController(),
      timer = setTimeout(() => ctl.abort(), cfg.timeoutMs ?? 8000);
    try {
      return await fetchFn(base() + path, {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-code": code },
        body: payload ? JSON.stringify(payload) : undefined,
        signal: ctl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  // Checks an admin code with the server. Costs nothing: no model call is made.
  async function verify(code) {
    if (!cfg.url) return { ok: false, reason: "no_url" };
    if (!String(code || "").trim()) return { ok: false, reason: "wrong" };
    try {
      const res = await post("/auth", null, String(code).trim());
      if (res.status === 401) return { ok: false, reason: "wrong" };
      if (res.status === 429) return { ok: false, reason: "locked" };
      if (res.status === 503) return { ok: false, reason: "unconfigured" };
      if (!res.ok) return { ok: false, reason: "network" };
      const b = await res.json();
      note(b);
      return { ok: true, ...(budget || {}) };
    } catch {
      return { ok: false, reason: "network" };
    }
  }

  // lines: [[speaker, text], ...] with the new line last; turn: that line's number (1-based).
  async function tagMemberLine(lines, turn, member) {
    const text = lines[lines.length - 1][1];
    const rules = (mode, reason) => ({ items: tagLine(text, turn), mode, reason });
    if (!enabled()) return rules("rules");
    const first = Math.max(0, lines.length - 1 - (cfg.contextLines ?? 2));
    const send = lines.slice(first).map(([w, t], k) => ({
      turn: turn - (lines.length - 1 - (first + k)),
      speaker: String(w).toLowerCase() === "member" ? "member" : "representative",
      text: redact(t, member),
    }));
    const key = JSON.stringify([send, turn]);
    if (cache.has(key)) return { items: cache.get(key).map((x) => ({ ...x })), mode: "agent" };
    if (calls >= (cfg.maxCalls ?? 150)) return rules("fallback", "limit");
    calls++;
    try {
      const res = await post("/tag", { transcript: send, profile: {} }, getCode());
      if (res.status === 401 || res.status === 503) return rules("fallback", "unauthorized");
      if (res.status === 429) return rules("fallback", "limit");
      if (!res.ok) throw new Error("HTTP " + res.status);
      const body = await res.json();
      if (!body || !Array.isArray(body.items)) throw new Error("unexpected response");
      note(body);
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
      return rules("fallback", "error");
    }
  }
  return {
    tagMemberLine,
    verify,
    get enabled() {
      return enabled();
    },
    get calls() {
      return calls;
    },
    get budget() {
      return budget;
    },
  };
}
