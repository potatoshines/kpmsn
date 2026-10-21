// Member Service Navigator: workspace, profile and member follow-up chat logic.
// Analysis is simulated: keyword rules in data/resources.js stand in for a model.
import { R, L, CL } from "./data/resources.js";
import { M, SC } from "./data/members.js";

let m = null,
  i = 0,
  tm = null,
  txt = [],
  sug = {},
  sel = new Set(),
  sent = [];
const $ = (s) => document.querySelector(s),
  esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
document.querySelectorAll("nav button").forEach(
  (b) =>
    (b.onclick = () => {
      document.querySelectorAll("nav button").forEach((x) => x.removeAttribute("aria-current"));
      b.setAttribute("aria-current", "page");
      ["ws", "pf", "mb"].forEach((v) => $("#" + v).classList.toggle("hide", v != b.dataset.v));
      if (b.dataset.v == "pf") prof();
    }),
);
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
    `<h2>${r.name} <span class="tag g">Recorded</span></h2><div class="row mut"><span>ID ${r.id}</span><span>Plan: ${r.plan}</span><span>PCP: ${r.pcp}</span><span>Language: ${r.lang}</span><span>Phone: ${r.ph}</span>${r.due ? `<span class="tag v">⚠ Amount due $${r.due.toFixed(2)} by ${r.dd}</span>` : ""}</div>`;
  $("#hist").innerHTML = r.hist
    .map((h) => {
      const t = h.slice(11),
        rel = Object.values(R)
          .filter((x) => x.k.test(t))
          .map((x) => x.n);
      return `<div class="ent"><div class="d">${h.slice(0, 10)}</div><div><b>${t}</b><p>Recorded interaction${rel.length ? " · Related: " + rel.join(", ") : ""}</p><p>Status: Closed</p></div></div>`;
    })
    .join("");
  txt = r.tr.slice();
  $("#tr").innerHTML = '<span class="mut">Transcript loaded. Press Play or Step.</span>';
  presets();
}
function hl(s) {
  let o = esc(s);
  Object.values(R).forEach((r) => {
    o = o.replace(new RegExp(r.k.source, "gi"), (x) => `<mark>${x}</mark>`);
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
  if (w == "Member")
    Object.entries(R).forEach(([k, r]) => {
      if (!sug[k] && r.k.test(t)) {
        sug[k] = t;
        draw();
      }
    });
}
function st(k) {
  const r = R[k];
  if (k == "tr" && !m.tp)
    return ["v", "Eligibility needs verification: this plan may not include it"];
  if (k == "pv" || k == "rx") return ["v", "More information required: confirm on record"];
  return ["", "Potentially relevant"];
}
function draw() {
  const ks = Object.keys(sug);
  $("#sugs").innerHTML = ks.length
    ? ks
        .map((k) => {
          const r = R[k],
            [c, s] = st(k),
            on = sel.has(k);
          return `<div class="card sug ${on ? "sel" : ""}"><b>${r.n}</b> <span class="tag ${c}">${on ? "✔ Selected for follow-up" : "● " + s}</span><p>${r.d}</p><p class="mut"><b>Why:</b> Suggested because the member said “${esc(sug[k])}”<br><b>Eligibility:</b> ${r.e}<br><b>Next action:</b> ${r.a}<br><a href="${L}" target="_blank" rel="noopener">Program link</a></p><div class="row"><button data-s="${k}" aria-pressed="${on}">${on ? "Remove from follow-up" : "Select for follow-up"}</button><button data-x="${k}">Dismiss</button></div></div>`;
        })
        .join("")
    : '<p class="mut">No relevant resource found yet. Keep listening or ask the assistant.</p>';
  $("#conc").innerHTML = ks.length
    ? ks
        .map((k) => {
          const [c, s] = st(k);
          return `<div class="ent"><div class="d"><span class="tag ${k == ks[0] ? "" : "v"}">${k == ks[0] ? "Main concern" : "Also raised"}</span></div><div><b>${CL[k]}</b><p>“${esc(sug[k])}”</p><p>${ctx(k)}</p><p>Related resource: ${R[k].n} · ${s}</p></div></div>`;
        })
        .join("")
    : "None yet.";
  $("#pend").innerHTML = sel.size
    ? "<ul>" + [...sel].map((k) => `<li>${R[k].n}</li>`).join("") + "</ul>"
    : "Nothing selected.";
  $("#prev").disabled = $("#send").disabled = !sel.size;
}
$("#sugs").onclick = (e) => {
  const s = e.target.dataset.s,
    x = e.target.dataset.x;
  if (s) sel.has(s) ? sel.delete(s) : sel.add(s);
  if (x) {
    delete sug[x];
    sel.delete(x);
  }
  draw();
};
function rst() {
  clearInterval(tm);
  tm = null;
  i = 0;
  sug = {};
  sel = new Set();
  $("#play").textContent = "▶ Play";
  $("#ferr").textContent = "";
  $("#prevbox").textContent = "";
  if (m) txt = m.tr.slice();
  draw();
  $("#tr").innerHTML = '<span class="mut">Transcript reset.</span>';
}
$("#find").onclick = find;
const ctx = (k) =>
  k == "fa" || k == "pp"
    ? m.due
      ? `On record: $${m.due.toFixed(2)} due ${m.dd}`
      : "On record: no amount due"
    : k == "rx"
      ? `On record: ${m.meds}`
      : k == "pv"
        ? `On record: ${m.ap}`
        : `On record: ${m.plan}`;
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
  i = 0;
  sug = {};
  sel = new Set();
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
    i = 0;
    sug = {};
    sel = new Set();
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
      ? `Simulated summary (generated, not recorded): the member raised ${ks.map((k) => R[k].n.toLowerCase()).join(", ")}. ${i < txt.length ? "The call is still in progress." : ""}`
      : "Nothing in the transcript yet to summarize.";
  if (/next|step/.test(q))
    return ks.length
      ? ks.map((k) => R[k].n + ": " + R[k].a).join(" • ")
      : "No suggestions yet. Play the transcript.";
  if (/verif/.test(q))
    return ks.length ? ks.map((k) => R[k].n + ": " + R[k].e).join(" • ") : "Nothing to verify yet.";
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
$("#prev").onclick = () =>
  ($("#prevbox").innerHTML =
    "<b>Member will see:</b><br>" +
    [...sel].map((k) => `• ${R[k].n}: ${R[k].d} (not confirmed; ${R[k].e})`).join("<br>"));
$("#send").onclick = () => {
  if (!sel.size) return;
  sent = [...sel];
  const c = $("#mc");
  c.innerHTML =
    `<div class="b">Hi ${m.name.split(" ")[0]}, here is a follow-up from your call today. These are options your representative reviewed with you. None is a guarantee of approval or coverage.</div>` +
    sent
      .map(
        (k) =>
          `<div class="b"><b>${R[k].n}</b><br>${R[k].d}<br><a href="${L}" target="_blank" rel="noopener">Open program link</a><br><span class="mut">${R[k].e}</span></div>`,
      )
      .join("") +
    (m.ap
      ? `<div class="b">Reminder: your record lists “${m.ap}”. Nothing was booked on this call.</div>`
      : "");
  $("#prevbox").textContent = "Sent (simulated) to the member follow-up chat.";
  document.querySelector("nav [data-v=mb]").click();
};
function mq() {
  const q = $("#mi").value.trim();
  if (!q) return;
  $("#mi").value = "";
  let a;
  const l = q.toLowerCase();
  if (!sent.length) a = "Nothing has been shared yet.";
  else if (/dose|stop|symptom|treat|pain|medicat/.test(l))
    a =
      "That is a clinical question. Please ask your care team. I can only explain the shared resources.";
  else if (/approv|qualify|eligib|guarantee|will i/.test(l))
    a =
      "I can’t say whether you’ll qualify. The program decides after review. Items shared: " +
      sent.map((k) => R[k].n + " (" + R[k].e + ")").join(" • ");
  else if (/next|document/.test(l))
    a = sent
      .map((k) => R[k].n + ": " + R[k].e + " The program link is the place to start.")
      .join(" • ");
  else if (/what|how|explain|link/.test(l)) a = sent.map((k) => R[k].n + ": " + R[k].d).join(" • ");
  else
    a =
      "I can explain only the items your representative shared: " +
      sent.map((k) => R[k].n).join(", ") +
      ".";
  $("#mc").insertAdjacentHTML(
    "beforeend",
    `<div class="b me">${esc(q)}</div><div class="b">${esc(a)}</div>`,
  );
  $("#mc").scrollTop = 1e5;
}
$("#mask").onclick = mq;
$("#mqs").innerHTML = [
  "What is this?",
  "Will I be approved?",
  "What should I do next?",
  "Do I need any documents?",
  "Should I change my medication?",
]
  .map((q) => `<button class="chip">${q}</button>`)
  .join("");
$("#mqs").onclick = (e) => {
  if (e.target.tagName == "BUTTON") {
    $("#mi").value = e.target.textContent;
    mq();
  }
};
$("#mi").onkeydown = (e) => e.key == "Enter" && mq();
$("#ai").onkeydown = (e) => e.key == "Enter" && $("#ask").click();
function prof() {
  const p = $("#pf");
  if (!m) {
    p.innerHTML =
      '<div class="card"><h2>Member profile</h2><p class="mut">No member selected. Go to the workspace and look up a fictional member.</p></div>';
    return;
  }
  const t = (a, b) =>
    `<div class="card"><h2>${a}</h2>${
      /<(table|ul|b)/.test(b)
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
    `<p class="eb">Records / Active member</p><div class="pt">Member profile</div><p class="ps">Recorded details used during the call.</p><div class="grid"><section class="ph"><i>${m.name
      .split(" ")
      .map((w) => w[0])
      .join("")}</i><div><b>${m.name}</b><span>${m.id} · ${m.plan}</span></div></section><div>` +
    t(
      "Personal and contact",
      `${m.name}<br>DOB ${m.dob}<br>${m.addr}<br>${m.ph}<br>Language: ${m.lang}`,
    ) +
    t("Membership and coverage", `ID ${m.id}<br>Plan: ${m.plan}<br>${m.cov}<br>PCP: ${m.pcp}`) +
    t(
      "Medications, allergies, conditions",
      `Medications: ${m.meds}<br>Allergies: ${m.al}<br>Conditions: ${m.cond}`,
    ) +
    t("Appointments and procedures", `Next: ${m.ap}<br>Procedures: ${m.sx}`) +
    `</div><div>` +
    t("Billing", m.due ? `Amount due: <b>$${m.due.toFixed(2)}</b> by ${m.dd}` : "No amount due.") +
    t(
      "Transaction history",
      `<table><tr><th>Date</th><th>Item</th><th>Amount</th></tr>${m.tx.map((x) => `<tr><td>${x[0]}</td><td>${x[1]}</td><td>${x[2]}</td></tr>`).join("")}</table>`,
    ) +
    t("Past interactions", `<ul>${m.hist.map((h) => `<li>${h}</li>`).join("")}</ul>`) +
    `</div></div>`;
}
prof();
