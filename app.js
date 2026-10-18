// Paper of the Day — reads data/index.json and data/<date>.json (built daily by GitHub Actions).
const view = document.getElementById("view");
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem("potd." + k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem("potd." + k, JSON.stringify(v)); } catch { /* ignore */ } },
};
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
};
const fmtDate = (d) => new Date(d + "T12:00:00Z").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
const authorLine = (p) => p.authors.length ? p.authors.slice(0, 6).join(", ") + (p.authorCount > 6 ? ` +${p.authorCount - 6} more` : "") : "";
const getJSON = async (path) => { const r = await fetch(path, { cache: "no-cache" }); if (!r.ok) throw new Error(r.status); return r.json(); };

let index = { days: [] };
const saved = () => store.get("saved", []);
function toggleSave(entry) {
  const list = saved();
  const i = list.findIndex((s) => s.url === entry.url);
  if (i >= 0) list.splice(i, 1); else list.unshift(entry);
  store.set("saved", list);
}

function paperView(rec) {
  const p = rec.paper;
  const isSaved = () => saved().some((s) => s.url === p.url);
  const saveBtn = h("button", { class: "btn" + (isSaved() ? " on" : ""), onclick: () => {
    toggleSave({ url: p.url, title: p.title, venue: p.venue, date: rec.date });
    saveBtn.className = "btn" + (isSaved() ? " on" : ""); saveBtn.textContent = isSaved() ? "★ Saved" : "☆ Save";
  } }, isSaved() ? "★ Saved" : "☆ Save");
  const abstract = h("p", { class: "abstract clamp" }, p.abstract);
  const more = h("button", { class: "link", onclick: () => { abstract.classList.remove("clamp"); more.remove(); } }, "Read full abstract");
  return [
    h("div", { class: "kicker" }, h("span", {}, p.venue), p.preprint ? h("span", { class: "pre" }, "Preprint") : null, h("span", { class: "pre" }, p.date)),
    h("h2", { class: "title" }, p.title),
    h("div", { class: "authors" }, authorLine(p)),
    p.why ? h("div", { class: "why" }, h("b", {}, "Why it matters"), h("p", {}, p.why)) : null,
    p.tldr ? h("p", { class: "tldr" }, p.tldr) : null,
    abstract, p.abstract.length > 700 ? more : null,
    p.reasons?.length ? h("div", { class: "chips" }, p.reasons.map((r) => h("span", { class: "chip" }, r))) : null,
    h("div", { class: "actions" },
      h("a", { class: "btn primary", href: p.url, target: "_blank", rel: "noopener noreferrer" }, "Read the paper ↗"),
      saveBtn,
      navigator.share ? h("button", { class: "btn", onclick: () => navigator.share({ title: p.title, url: p.url }).catch(() => {}) }, "Share") : null),
    rec.also?.length ? [h("div", { class: "section-title" }, "Also worth a look"),
      rec.also.map((a) => h("a", { class: "item", href: a.url, target: "_blank", rel: "noopener noreferrer" }, h("div", { class: "t" }, a.title), h("div", { class: "m" }, `${a.venue}${a.preprint ? " · preprint" : ""}`)))] : null,
    h("p", { class: "note" }, rec.pickedBy === "claude" ? `Picked by Claude from ${rec.candidates} candidates.` : `Picked by relevance score from ${rec.candidates} candidates.`),
  ];
}

async function showDay(date) {
  view.replaceChildren(h("header", { class: "masthead" }, h("h1", {}, "Paper of the Day"), h("span", { class: "date" }, date ? fmtDate(date) : "")));
  if (!date) { view.append(h("p", { class: "empty" }, "No paper yet — the first one arrives with the next daily run.")); return; }
  try { view.append(...paperView(await getJSON(`data/${date}.json`)).flat(3).filter(Boolean)); }
  catch { view.append(h("p", { class: "empty" }, "Couldn't load this day. Check your connection.")); }
}

function showList(title, items, emptyText) {
  view.replaceChildren(h("header", { class: "masthead" }, h("h1", {}, title)));
  if (!items.length) { view.append(h("p", { class: "empty" }, emptyText)); return; }
  for (const d of items) view.append(h("a", { class: "item", href: d.href }, h("div", { class: "t" }, d.title), h("div", { class: "m" }, d.meta)));
}

async function route() {
  const [, page, arg] = (location.hash || "#/").split("/");
  document.querySelectorAll(".tabs a").forEach((a) => (a.dataset.tab === (page || "today") || (a.dataset.tab === "archive" && page === "day")) ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
  window.scrollTo(0, 0);
  if (page === "archive") return showList("Archive", index.days.map((d) => ({ href: `#/day/${d.date}`, title: d.title, meta: `${fmtDate(d.date)} · ${d.venue}` })), "Nothing here yet.");
  if (page === "saved") return showList("Saved", saved().map((s) => ({ href: `#/day/${s.date}`, title: s.title, meta: `${s.venue} · ${fmtDate(s.date)}` })), "Tap ☆ Save on a paper to keep it here.");
  if (page === "day" && arg) return showDay(arg);
  return showDay(index.days[0]?.date);
}

window.addEventListener("hashchange", route);
getJSON("data/index.json").then((i) => { index = i; }).catch(() => {}).finally(route);
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) navigator.serviceWorker.register("sw.js").catch(() => {});
