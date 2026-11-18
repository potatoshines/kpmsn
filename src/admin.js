// Admin console. Live agent calls cost credits, so the testing tools are behind an admin code that the
// SERVER checks (POST /auth). Nothing in this public repo can unlock them: a wrong or missing code gets a
// plain refusal from the service, and the page never calls the agent without one.
//
// Unlocked state lives in this tab only (sessionStorage), so closing the tab locks it again.
const KEY = "kp_admin_code";
const mem = { v: "" };
const store = {
  get() {
    try {
      return sessionStorage.getItem(KEY) || "";
    } catch {
      return mem.v;
    }
  },
  set(v) {
    mem.v = v;
    try {
      v ? sessionStorage.setItem(KEY, v) : sessionStorage.removeItem(KEY);
    } catch {
      /* private mode: the in-memory copy still works for this page */
    }
  },
};
export const REASONS = {
  wrong: "That code was not accepted.",
  locked: "Too many wrong codes. Try again in a few minutes.",
  unconfigured: "The agent service has no admin code set yet.",
  network: "Could not reach the agent service.",
  no_url: "No agent service is configured in src/config.js.",
};

// agent: the client from agent-client.js (verify, budget). setCode: tells the client which code to send.
export function createAdmin({ agent, setCode, onChange = () => {}, doc = document }) {
  const $ = (s) => doc.querySelector(s);
  let unlocked = false,
    mode = "recorded",
    saveFn = () => {};
  const msg = (t) => ($("#admmsg").textContent = t || "");

  function paint() {
    doc.body.classList.toggle("is-admin", unlocked);
    $("#admbtn").textContent = unlocked ? "🔓 Admin" : "🔒 Admin";
    $("#admlock").classList.toggle("hide", unlocked);
    $("#admon").classList.toggle("hide", !unlocked);
    $("#adm").classList.toggle("live", unlocked && mode === "live");
    meter();
  }
  function meter() {
    const b = agent.budget,
      el = $("#admmeter");
    if (!el) return;
    if (!b) {
      el.hidden = true;
      $("#admmeterT").textContent = "Agent calls today: not used yet";
      return;
    }
    const used = Math.max(0, b.limit - b.remaining);
    el.hidden = false;
    el.max = b.limit;
    el.value = used;
    $("#admmeterT").textContent = `Agent calls today: ${used} of ${b.limit}`;
    $("#adm").classList.toggle("low", b.remaining <= Math.ceil(b.limit * 0.1));
  }
  function open(on) {
    const p = $("#adm");
    p.classList.toggle("hide", !on);
    $("#admbtn").setAttribute("aria-expanded", String(on));
    if (on) ($("#admcode").offsetParent ? $("#admcode") : $("#amode")).focus();
    else $("#admbtn").focus();
  }
  async function unlock(code, { silent = false } = {}) {
    const go = $("#admgo");
    go.disabled = true;
    go.textContent = "Checking…";
    const r = await agent.verify(code);
    go.disabled = false;
    go.textContent = "Unlock";
    if (!r.ok) {
      if (!silent) msg(REASONS[r.reason] || REASONS.network);
      else store.set("");
      return false;
    }
    setCode(String(code).trim());
    store.set(String(code).trim());
    unlocked = true;
    mode = "recorded"; // always start in the free mode; live is an explicit choice
    $("#amode").value = mode;
    $("#admcode").value = "";
    msg("");
    paint();
    onChange();
    return true;
  }
  function lock(why) {
    unlocked = false;
    mode = "recorded";
    setCode("");
    store.set("");
    paint();
    msg(why || "");
    onChange();
  }

  $("#admbtn").onclick = () => open($("#adm").classList.contains("hide"));
  $("#admclose").onclick = () => open(false);
  doc.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("#adm").classList.contains("hide")) open(false);
  });
  $("#admlock").onsubmit = (e) => {
    e.preventDefault();
    unlock($("#admcode").value);
  };
  $("#alock").onclick = () => lock("Locked.");
  $("#amode").onchange = (e) => {
    mode = e.target.value === "live" ? "live" : "recorded";
    paint();
    onChange();
  };
  $("#asave").onclick = () => saveFn();
  paint();
  const saved = store.get();
  if (saved) unlock(saved, { silent: true });

  return {
    get unlocked() {
      return unlocked;
    },
    get mode() {
      return mode;
    },
    lock,
    refreshMeter: meter,
    onSave: (fn) => (saveFn = fn),
    setSave(enabled, hint) {
      $("#asave").disabled = !enabled;
      $("#asavemsg").textContent = hint || "";
    },
  };
}
