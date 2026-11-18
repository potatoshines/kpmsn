// Member Service Navigator: workspace, profile and the one-way member follow-up message.
// Member lines are tagged by the tagging agent (agent-client.js, settings in config.js); with no agent
// configured, or when it cannot be reached, the keyword rules in data/tag-rules.js answer instead.
// Resources come from data/kp_resource_opportunity_catalog.csv.
import { M, SC } from "./data/members.js";
import { loadCatalog, emptyCatalog, matchTags, normTag, humanTag } from "./data/catalog.js";
import { RULES, tagLine, tagProfile, tagText, recordContext } from "./data/tag-rules.js";
import { esc, escAttr, nameOf, isFlagged, cardParts } from "./card.js";
import { createAgent } from "./agent-client.js";

const agent = createAgent();
let m = null,
  i = 0,
  tm = null,
  txt = [],
  sug = {},
  sel = new Set(),
  dr = null,
  flt = "all";
const $ = (s) => document.querySelector(s);
// The resource catalog (src/data/kp_resource_opportunity_catalog.csv). If it cannot be loaded the rest
// of the app still works and the suggestions area says what went wrong.
let catalog = emptyCatalog(),
  catalogError = "";
try {
  catalog = await loadCatalog();
  if (catalog.problems.length) console.warn("Resource catalog:\n" + catalog.problems.join("\n"));
} catch (e) {
  catalogError = e.message;
}
function show(v) {
  document.querySelectorAll("nav button").forEach((x) => {
    if (x.dataset.v == v) x.setAttribute("aria-current", "page");
    else x.removeAttribute("aria-current");
  });
  ["ws", "pf", "mb"].forEach((id) => $("#" + id).classList.toggle("hide", id != v));
  if (v == "pf") prof();
}
document.querySelectorAll("nav button").forEach((b) => (b.onclick = () => show(b.dataset.v)));
// Any element with data-go switches page; data-at names the element to scroll to and focus.
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-go]");
  if (!b) return;
  show(b.dataset.go);
  const el = $("#" + (b.dataset.at || b.dataset.go));
  if (!el) return;
  const calm = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ block: "start", behavior: calm ? "auto" : "smooth" });
  el.setAttribute("tabindex", "-1");
  el.focus({ preventScroll: true });
});
$("#samp").innerHTML =
  `<option value="">Member’s sample</option><option value="x">Sample: unrelated call</option>`;
function find() {
  const id = $("#qid").value.trim().toUpperCase(),
    n = $("#qn").value.trim().toLowerCase(),
    d = $("#qd").value,
    o = $("#lmsg");
  if (!id && !n && !d) {
    o.textContent = "Enter a member ID, name, or date of birth.";
    return;
  }
  const r = M.find(
    (x) => (!id || x.id == id) && (!n || x.name.toLowerCase().includes(n)) && (!d || x.dob == d),
  );
  if (!r) {
    o.textContent = "No fictional member matches. Check the entry, or try KP-100234 or KP-100871.";
    return;
  }
  m = r;
  o.textContent = "Member found (fictional record).";
  rst();
  $("#sum").dataset.i = r.name
    .split(" ")
    .map((w) => w[0])
    .join("");
  $("#sum").classList.remove("hide");
  $("#sum").innerHTML =
    `<h2>${r.name} <span class="tag g">Recorded</span></h2><div class="row mut"><span>ID ${r.id}</span><span>Plan: ${r.plan}</span><span>PCP: ${r.pcp}</span><span>Language: ${r.lang}</span>${r.due ? `<span class="tag v">⚠ Amount due $${r.due.toFixed(2)} by ${r.dd}</span>` : ""}</div><div class="more" role="group" aria-label="More member details"><button class="sm" data-go="pf">More details</button><span class="mut">Jump to</span><button class="ghost" data-go="pf" data-at="pf-cover">Coverage</button><button class="ghost" data-go="pf" data-at="pf-appt">Appointments</button><button class="ghost" data-go="pf" data-at="pf-bill">Billing</button><button class="ghost" data-go="pf" data-at="pf-hist">Past interactions</button></div>`;
  $("#hist").innerHTML = r.hist
    .map((h) => {
      const t = h.slice(11),
        rel = matchTags(catalog, tagText(t)).map((x) => nameOf(catalog.get(x.id)));
      return `<div class="ent"><div class="d">${h.slice(0, 10)}</div><div><b>${t}</b><p>Recorded interaction${rel.length ? " · Related: " + rel.map(esc).join(", ") : ""}</p><p>Status: Closed</p></div></div>`;
    })
    .join("");
  txt = r.tr.slice();
  $("#tr").innerHTML = '<span class="mut">Transcript loaded. Press Play or Step.</span>';
  presets();
}
function hl(s) {
  let o = esc(s);
  RULES.forEach((r) => {
    o = o.replace(new RegExp(r.re.source, "gi"), (x) => `<mark>${x}</mark>`);
  });
  return o;
}
function line() {
  if (!m || i >= txt.length) {
    clearInterval(tm);
    tm = null;
    $("#play").textContent = "▶ Play";
    return;
  }
  const [w, t] = txt[i++];
  if (i == 1) $("#tr").innerHTML = "";
  $("#tr").insertAdjacentHTML("beforeend", `<p class="ln"><b>${w}:</b> ${hl(t)}</p>`);
  $("#tr").scrollTop = 1e5;
  if (w == "Member") {
    queueTagging(t);
  }
}
// Member lines go to the agent one at a time, in order, so cards keep the first line that produced
// them. `gen` changes on every reset, so a slow answer for an old transcript is dropped.
let gen = 0,
  chain = Promise.resolve();
const STATUS = {
  agent: "Tagging: Gemini agent",
  rules: "Tagging: simulated keyword rules",
  fallback: "Tagging: keyword rules (agent unavailable for some lines)",
};
function queueTagging(t) {
  const g = gen,
    mm = m,
    turn = i,
    lines = txt.slice(0, i);
  chain = chain
    .then(() => agent.tagMemberLine(lines, turn, mm))
    .then(({ items, mode }) => {
      if (g !== gen) return;
      applyTags(items);
      const st = $("#agentst");
      if (st && (mode === "fallback" || !st.dataset.mode || st.dataset.mode === "agent"))
        ((st.dataset.mode = mode), (st.textContent = STATUS[mode]));
      draw();
    })
    .catch((e) => console.warn("Tagging failed:", e));
}
// The seam for the tagging agent. `items` is what the agent returns:
//   [{ tag, source: "transcript" | "profile", turn?, evidence }]
// Tags are matched to catalog rows (matchTags). A card keeps the first transcript line that produced
// it (`tr` quote, `at` line number, `tt` that line's tags) and its profile evidence (`pf`).
function applyTags(items) {
  const groups = new Map();
  for (const it of items) {
    const key = it.source == "profile" ? "pf" : "tr" + it.turn;
    (groups.get(key) || groups.set(key, []).get(key)).push(it);
  }
  for (const [key, g] of groups)
    for (const hit of matchTags(
      catalog,
      g.map((x) => x.tag),
    )) {
      const why = g.find((x) => hit.tags.includes(normTag(x.tag))),
        s = sug[hit.id] || (sug[hit.id] = {});
      if (key == "pf") {
        if (!s.pf) s.pf = why.evidence;
      } else if (!s.tr) Object.assign(s, { tr: why.evidence, at: why.turn, tt: hit.tags });
    }
}
function draw() {
  const ks = Object.keys(sug),
    tk = ks.filter((k) => sug[k].tr),
    np = ks.filter((k) => sug[k].pf).length;
  const cnt = { all: ks.length, tr: tk.length, pf: np };
  document.querySelectorAll("#sgf button").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.flt == flt));
    b.querySelector(".n").textContent = cnt[b.dataset.flt];
  });
  const shown = ks.filter((k) => flt == "all" || sug[k][flt]);
  $("#sugs").innerHTML = catalogError
    ? `<p class="err">${esc(catalogError)} Resource suggestions are unavailable. If you opened index.html directly, run npm start instead.</p>`
    : shown.length
      ? shown
          .map((k) => {
            const s = sug[k],
              on = sel.has(k),
              { title, body, flagged } = cardParts(catalog.get(k));
            return `<div class="card sug ${on ? "sel" : ""}">${title}<div class="tags">${s.tr ? '<span class="tag">Call transcript</span>' : ""}${s.pf ? '<span class="tag pf">Member profile</span>' : ""}<span class="tag ${flagged ? "v" : ""}">${flagged ? "⚠ Incomplete catalog data" : on ? "✔ Selected for follow-up" : "● Potentially relevant"}</span></div>${body}<div class="row"><button data-s="${escAttr(k)}" aria-pressed="${on}"${flagged ? " disabled" : ""}>${on ? "Remove from follow-up" : "Select for follow-up"}</button><button data-x="${escAttr(k)}">Dismiss</button></div></div>`;
          })
          .join("")
      : `<p class="mut">${ks.length ? "No suggestions from the " + (flt == "tr" ? "call transcript" : "member profile") + " yet." : "No relevant resource found yet. Keep listening or ask the assistant."}</p>`;
  // One concern per member line that produced a suggestion, in call order.
  const lines = new Map();
  tk.forEach((k) => {
    const s = sug[k],
      g = lines.get(s.at) || lines.set(s.at, { quote: s.tr, tags: new Set(), ids: [] }).get(s.at);
    s.tt.forEach((t) => g.tags.add(t));
    g.ids.push(k);
  });
  $("#conc").innerHTML = lines.size
    ? [...lines]
        .sort((a, b) => a[0] - b[0])
        .map(([, g], n) => {
          const tags = [...g.tags];
          return `<div class="ent"><div class="d"><span class="tag ${n ? "v" : ""}">${n ? "Also raised" : "Main concern"}</span></div><div><b>${esc(tags.slice(0, 3).map(humanTag).join(" · "))}</b><p>“${esc(g.quote)}”</p><p>${esc(recordContext(tags, m))}</p><p>Related resources: ${g.ids.map((k) => esc(nameOf(catalog.get(k)))).join("; ")}</p></div></div>`;
        })
        .join("")
    : "None yet.";
  $("#pend").innerHTML = sel.size
    ? "<ul>" + [...sel].map((k) => `<li>${esc(nameOf(catalog.get(k)))}</li>`).join("") + "</ul>"
    : "Nothing selected.";
  $("#prev").disabled = $("#rv").disabled = $("#send").disabled = !sel.size;
}
$("#sgf").onclick = (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  flt = b.dataset.flt;
  draw();
};
$("#sugs").onclick = (e) => {
  const s = e.target.dataset.s,
    x = e.target.dataset.x;
  if (s && !isFlagged(catalog.get(s))) sel.has(s) ? sel.delete(s) : sel.add(s);
  if (x) {
    delete sug[x];
    sel.delete(x);
  }
  draw();
  if (!$("#rev").classList.contains("hide")) sel.size ? review("sync") : closeRev();
};
// Start over for the current transcript: profile-based suggestions come back, call-based ones clear.
function clr() {
  gen++;
  i = 0;
  const st = $("#agentst");
  if (st) ((st.dataset.mode = ""), (st.textContent = agent.enabled ? "" : STATUS.rules));
  sug = {};
  sel = new Set();
  dr = null;
  closeRev();
  if (!m) return;
  applyTags(tagProfile(m));
}
function rst() {
  clearInterval(tm);
  tm = null;
  $("#play").textContent = "▶ Play";
  $("#ferr").textContent = "";
  $("#prevbox").textContent = "";
  if (m) txt = m.tr.slice();
  clr();
  draw();
  $("#tr").innerHTML = '<span class="mut">Transcript reset.</span>';
}
$("#find").onclick = find;
$("#mock").innerHTML =
  '<p class="mut" style="margin:12px 0 4px">Sample members (fictional) — select Use to fill the lookup</p><table><tr><th>ID</th><th>Name</th><th>DOB</th><th>Plan</th><th>Call scenario</th><th></th></tr>' +
  M.map(
    (x) =>
      `<tr><td>${x.id}</td><td>${x.name}</td><td>${x.dob}</td><td>${x.plan}</td><td>${SC[x.id]}</td><td><button data-u="${x.id}" aria-label="Use ${x.name}">Use</button></td></tr>`,
  ).join("") +
  "</table>";
$("#mock").innerHTML =
  '<span class="mut sm">Try a sample:</span> ' +
  M.map(
    (x) => `<button class="ghost" data-u="${x.id}" title="${SC[x.id]}">${x.name}</button>`,
  ).join(" ");
$("#mock").onclick = (e) => {
  const u = e.target.dataset.u;
  if (u) {
    const x = M.find((y) => y.id == u);
    $("#qid").value = x.id;
    $("#qn").value = x.name;
    $("#qd").value = x.dob;
    find();
  }
};
$("#rst").onclick = rst;
$("#step").onclick = () => (m ? line() : ($("#ferr").textContent = "Look up a member first."));
$("#play").onclick = () => {
  if (!m) {
    $("#ferr").textContent = "Look up a member first.";
    return;
  }
  if (tm) {
    clearInterval(tm);
    tm = null;
    $("#play").textContent = "▶ Play";
  } else {
    $("#play").textContent = "❚❚ Pause";
    tm = setInterval(line, 1600);
  }
};
$("#samp").onchange = (e) => {
  if (!m) {
    $("#ferr").textContent = "Look up a member first.";
    return;
  }
  clr();
  txt =
    e.target.value == "x"
      ? [
          ["Rep", "How can I help?"],
          ["Member", "I just want to update my phone number."],
        ]
      : m.tr.slice();
  draw();
  $("#tr").innerHTML = '<span class="mut">Sample loaded. Press Play.</span>';
};
$("#file").onchange = (e) => {
  const f = e.target.files[0];
  $("#ferr").textContent = "";
  if (!f) return;
  if (!m) {
    $("#ferr").textContent = "Look up a member first.";
    return;
  }
  if (!/\.txt$/i.test(f.name)) {
    $("#ferr").textContent = "Unsupported file type. Please use a .txt sample file.";
    return;
  }
  f.text().then((t) => {
    const ls = t
      .split(/\r?\n/)
      .map((l) => l.match(/^(Rep|Member):\s*(.+)$/i))
      .filter(Boolean);
    if (!ls.length) {
      $("#ferr").textContent = "No “Rep:” or “Member:” lines found. Check the file format.";
      return;
    }
    txt = ls.map((x) => [x[1][0].toUpperCase() == "R" ? "Rep" : "Member", x[2]]);
    clr();
    draw();
    $("#tr").innerHTML =
      '<span class="mut">Loaded ' +
      txt.length +
      " lines. Suggestions will update on playback.</span>";
  });
};
function presets() {
  $("#presets").innerHTML = [
    "Summarize the call",
    "Suggest next steps",
    "What needs verification?",
    "Billing summary",
  ]
    .map((p) => `<button>${p}</button>`)
    .join("");
  $("#ac").innerHTML = "";
}
function ans(q) {
  q = q.toLowerCase();
  const ks = Object.keys(sug);
  if (!m) return "Look up a member first.";
  if (/summar/.test(q))
    return ks.length
      ? `Simulated summary (generated, not recorded): suggested resources so far are ${ks.map((k) => nameOf(catalog.get(k))).join("; ")}. ${i < txt.length ? "The call is still in progress." : ""}`
      : "Nothing in the transcript yet to summarize.";
  if (/next|step/.test(q))
    return ks.length
      ? ks
          .map((k) => {
            const r = catalog.get(k);
            return `${nameOf(r)}: ${r.eligibility ? "check eligibility, then " : ""}${r.url ? "review the program link with the member." : "no link available in the catalog."}`;
          })
          .join(" • ")
      : "No suggestions yet. Play the transcript.";
  if (/verif/.test(q))
    return ks.length
      ? ks
          .map(
            (k) =>
              `${nameOf(catalog.get(k))}: ${catalog.get(k).eligibility || "no eligibility note in the catalog."}`,
          )
          .join(" • ")
      : "Nothing to verify yet.";
  if (/bill|due|balance/.test(q))
    return m.due
      ? `Recorded: $${m.due.toFixed(2)} due ${m.dd}. See the Member profile page for transactions.`
      : "Recorded: no amount due.";
  if (/medic|allerg|appoint/.test(q))
    return `Recorded: medications ${m.meds}; allergies ${m.al}; next appointment ${m.ap}. Clinical questions go to the care team.`;
  return "I can only use this member’s mock profile, transcript and resource list. Try a preset prompt.";
}
function ask(q) {
  if (!q) return;
  $("#ac").insertAdjacentHTML(
    "beforeend",
    `<div class="b me">${esc(q)}</div><div class="b">${esc(ans(q))}</div>`,
  );
  $("#ac").scrollTop = 1e5;
}
$("#presets").onclick = (e) => e.target.tagName == "BUTTON" && ask(e.target.textContent);
$("#ask").onclick = () => {
  ask($("#ai").value.trim());
  $("#ai").value = "";
};
const nl = (t) => esc(t).replace(/\n/g, "<br>");
// The assistant's draft of the follow-up. Representative edits live here until the message is sent.
function mkDraft() {
  const old = dr;
  dr = {
    intro: old
      ? old.intro
      : `Hi ${m.name.split(" ")[0]}, here is a follow-up from your call today. These are options your representative reviewed with you. None is a guarantee of approval or coverage.`,
    // The member's message carries only each resource's description and link. Eligibility is shown
    // on the representative's cards and nowhere on the member side.
    items: Object.fromEntries(
      [...sel].map((k) => [k, (old && old.items[k]) || { d: catalog.get(k).description }]),
    ),
    note: old
      ? old.note
      : m.ap
        ? `Reminder: your record lists “${m.ap}”. Nothing was booked on this call.`
        : "",
  };
}
const hidden = (id) => $(id).classList.contains("hide");
function closeRev(back) {
  $("#rev").classList.add("hide");
  $("#rev").innerHTML = "";
  $("#rv").setAttribute("aria-expanded", "false");
  if (back) $("#rv").focus();
}
// Floating editor. mode: "open" focuses the first field, "sync" re-renders without moving focus,
// "stay" re-renders and keeps focus inside the panel.
function review(mode = "open") {
  mkDraft();
  const fld = (lab, f, v, rows, k) =>
    `<label>${lab}<textarea rows="${rows}" data-f="${f}"${k ? ` data-k="${k}"` : ""}>${esc(v)}</textarea></label>`;
  const top = hidden("#rev") ? 0 : $("#rev .rv-b").scrollTop;
  $("#rev").classList.remove("hide");
  $("#rv").setAttribute("aria-expanded", "true");
  $("#rev").innerHTML =
    `<div class="rv-h"><h3>Review and edit</h3><button class="ghost" data-act="close" aria-label="Close editor">Close ✕</button></div><div class="rv-b"><p class="mut">The assistant drafted this message. Edit any text; the member receives exactly what is shown here. Resource names and program links stay as approved.</p>` +
    fld("Opening message", "intro", dr.intro, 3) +
    [...sel]
      .map(
        (k) =>
          `<fieldset><legend>${esc(nameOf(catalog.get(k)))}</legend>${fld("Description", "d", dr.items[k].d, 3, k)}<button data-rm="${k}">Remove from follow-up</button></fieldset>`,
      )
      .join("") +
    fld("Closing note (optional)", "note", dr.note, 2) +
    `</div><div class="rv-f"><button data-act="reset">Restore assistant draft</button><button class="p" data-act="close">Done</button></div>`;
  $("#rev .rv-b").scrollTop = top;
  if (mode == "open") $("#rev textarea").focus();
  else if (mode == "stay") $("#rev").focus();
}
$("#rev").oninput = (e) => {
  const t = e.target,
    f = t.dataset.f;
  if (!dr || !f) return;
  if (t.dataset.k) dr.items[t.dataset.k][f] = t.value;
  else dr[f] = t.value;
};
$("#rev").onclick = (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.rm) {
    sel.delete(b.dataset.rm);
    draw();
    sel.size ? review("stay") : closeRev(true);
  } else if (b.dataset.act == "reset") {
    dr = null;
    review("stay");
  } else if (b.dataset.act == "close") closeRev(true);
};
$("#rev").onkeydown = (e) => e.key == "Escape" && closeRev(true);
$("#rv").onclick = () => {
  if (!sel.size) return;
  hidden("#rev") ? review() : closeRev();
};
// The follow-up exactly as it will be delivered: edited text, trimmed, empty parts left out.
function final() {
  const t = (x) => x.trim();
  return {
    intro: t(dr.intro),
    items: [...sel].map((k) => {
      const r = catalog.get(k);
      return { k, n: r.name, u: r.url, d: t(dr.items[k].d) };
    }),
    note: t(dr.note),
  };
}
function fuHtml(f) {
  return (
    (f.intro ? `<div class="b">${nl(f.intro)}</div>` : "") +
    f.items
      .map(
        (x) =>
          `<div class="b"><b>${esc(x.n)}</b>${x.d ? "<br>" + nl(x.d) : ""}${x.u ? `<br><a href="${escAttr(x.u)}" target="_blank" rel="noopener">Open program link</a>` : ""}</div>`,
      )
      .join("") +
    (f.note ? `<div class="b">${nl(f.note)}</div>` : "")
  );
}
// Preview: a temporary window showing the member chat as it will look after sending.
const pv = $("#pvd");
const pvClose = () => (pv.close ? pv.close() : pv.removeAttribute("open"));
$("#prev").onclick = () => {
  if (!sel.size) return;
  mkDraft();
  $("#pvc").innerHTML = fuHtml(final());
  if (pv.showModal) pv.showModal();
  else pv.setAttribute("open", "");
};
$("#pvx").onclick = pvClose;
pv.onclick = (e) => e.target == pv && pvClose();
$("#send").onclick = () => sel.size && sendFollowUp();
function sendFollowUp() {
  if (!sel.size) return;
  mkDraft();
  const f = final();
  $("#mc").innerHTML = fuHtml(f);
  dr = null;
  closeRev();
  $("#prevbox").textContent = "Sent (simulated) as a one-way message to the member.";
  show("mb");
}
$("#ai").onkeydown = (e) => e.key == "Enter" && $("#ask").click();
function prof() {
  const p = $("#pf");
  if (!m) {
    p.innerHTML =
      '<div class="card"><h2>Member profile</h2><p class="mut">No member selected. Go to the workspace and look up a fictional member.</p></div>';
    return;
  }
  const t = (a, b, id) =>
    `<div class="card"${id ? ` id="${id}"` : ""}><h2>${a}</h2>${
      /<(table|ul)/.test(b)
        ? b
        : b
            .split("<br>")
            .map((l) => {
              const i = l.indexOf(": ");
              return i > 0 && i < 22
                ? `<div class="fl"><span>${l.slice(0, i)}</span>${l.slice(i + 2)}</div>`
                : `<div class="fl">${l}</div>`;
            })
            .join("")
    }</div>`;
  p.innerHTML =
    `<div class="row"><button class="ghost" data-go="ws">← Back to workspace</button></div><p class="eb">Records / Active member</p><div class="pt">Member profile</div><p class="ps">Recorded details used during the call.</p><div class="grid"><section class="ph"><i>${m.name
      .split(" ")
      .map((w) => w[0])
      .join("")}</i><div><b>${m.name}</b><span>${m.id} · ${m.plan}</span></div></section><div>` +
    t("Personal details", `${m.name}<br>DOB ${m.dob}<br>Language: ${m.lang}`, "pf-personal") +
    t(
      "Membership and coverage",
      `ID ${m.id}<br>Plan: ${m.plan}<br>${m.cov}<br>PCP: ${m.pcp}`,
      "pf-cover",
    ) +
    t("Appointments and procedures", `Next: ${m.ap}<br>Procedures: ${m.sx}`, "pf-appt") +
    t(
      "Care and support flags",
      `Care gaps: ${(m.cg || []).join("; ") || "None"}<br>Social needs: ${m.sn || "None flagged"}`,
      "pf-flags",
    ) +
    `</div><div>` +
    t(
      "Billing",
      m.due ? `Amount due: <b>$${m.due.toFixed(2)}</b> by ${m.dd}` : "No amount due.",
      "pf-bill",
    ) +
    t(
      "Transaction history",
      `<table><tr><th>Date</th><th>Item</th><th>Amount</th></tr>${m.tx.map((x) => `<tr><td>${x[0]}</td><td>${x[1]}</td><td>${x[2]}</td></tr>`).join("")}</table>`,
    ) +
    t("Past interactions", `<ul>${m.hist.map((h) => `<li>${h}</li>`).join("")}</ul>`, "pf-hist") +
    `</div></div>`;
}
prof();
