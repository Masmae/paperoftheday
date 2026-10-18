// Things written on demand by GitHub Actions: start a job, remember it's running (so leaving the
// page and coming back still shows "Writing…"), and poll the repo until the file appears.
import { h, store, getJSON } from "./dom.js";

const MAX_WAIT = 12 * 60 * 1000;          // give up waiting after this
const POLL_MS = 8000;

/** The published file, or (if just written and the site hasn't redeployed yet) the repo copy. */
export async function loadGenerated(sync, path) {
  try { return await getJSON(path); } catch { /* not published (yet) */ }
  try { return await sync.repoJSON(path); } catch { return null; }
}

const pending = () => store.get("pending", {});
export function runningSince(key) {
  const t = pending()[key];
  return t && Date.now() - t < MAX_WAIT ? t : null;
}
function setPending(key, t) {
  const p = pending();
  if (t) p[key] = t; else delete p[key];
  store.set("pending", p);
}

const clock = (ms) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

/**
 * A "Write it now" control. Shows a button, or "Writing… m:ss" while a job runs; polls `path`
 * until `done(file, requestedAt)` and then calls `onReady(file)`. Stops by itself when it leaves the page.
 */
export function writeControl(sync, { kind, id, path, label, done = (x) => !!x, onReady }) {
  const key = `${kind}:${id}`;
  const box = h("div", { class: "ondemand" });
  const msg = h("p", { class: "note" });
  const showButton = (note = "") => {
    if (!sync.getToken()) {
      box.replaceChildren(h("p", { class: "note" }, "To write it now, connect GitHub in ", h("a", { href: "#/settings" }, "Settings"), "."));
      return;
    }
    box.replaceChildren(h("button", { class: "btn primary", onclick: async (e) => {
      e.target.disabled = true;
      try { await sync.requestWrite(kind, id); setPending(key, Date.now()); poll(); }
      catch (err) { showButton(`Couldn't start: ${err.message}.`); }
    } }, label), note ? h("p", { class: "note" }, note) : null);
  };
  async function poll() {
    const since = runningSince(key);
    if (!since) return showButton();
    box.replaceChildren(h("p", { class: "writing" }, h("span", { class: "spinner", "aria-hidden": "true" }), h("span", { class: "t" }, `Writing… ${clock(Date.now() - since)}`)),
      h("p", { class: "note" }, "On GitHub, usually about 2 minutes. You can leave this page and come back."), msg);
    while (box.isConnected || !box.parentNode) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      if (!box.isConnected) return;                      // left the page; it resumes when you come back
      const t = box.querySelector(".writing .t");
      if (t) t.textContent = `Writing… ${clock(Date.now() - since)}`;
      let file = null;
      try { file = await sync.repoJSON(path); } catch { /* try again next time */ }
      if (done(file, since)) { setPending(key, null); onReady(file); return; }
      if (Date.now() - since > MAX_WAIT) { setPending(key, null); return showButton("That took too long. Try again, or check the Actions tab on GitHub."); }
    }
  }
  if (runningSince(key)) queueMicrotask(poll); else showButton();
  return box;
}
