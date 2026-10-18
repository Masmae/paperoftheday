// Paper of the Day — reads data/index.json and data/<date>.json (built daily by GitHub Actions).
const view = document.getElementById("view");
import { store, h, fmtDate, authorLine, getJSON, masthead } from "./js/dom.js";
import * as sync from "./js/sync.js";
import { showWatching } from "./js/watch.js";
import { showLearn } from "./js/learn.js";
import { showSettings } from "./js/settings.js";
import { speech, speak, stopSpeaking, isSpeaking } from "./js/speech.js";

let index = { days: [] };

const saved = () => store.get("saved", []);
function toggleSave(entry) {
  const list = saved();
  const i = list.findIndex((s) => s.url === entry.url);
  if (i >= 0) list.splice(i, 1); else list.unshift(entry);
  store.set("saved", list);
}

// `which` is null for the day's pick, or the index of a runner-up ("Also worth a look").
function paperView(rec, which = null) {
  const p = which === null ? rec.paper : rec.also[which];
  const href = (i) => `#/day/${rec.date}${i === null ? "" : `/${i}`}`;
  const isSaved = () => saved().some((s) => s.url === p.url);
  const saveBtn = h("button", { class: "btn" + (isSaved() ? " on" : ""), onclick: () => {
    toggleSave({ url: p.url, title: p.title, venue: p.venue, date: rec.date, href: href(which) });
    saveBtn.className = "btn" + (isSaved() ? " on" : ""); saveBtn.textContent = isSaved() ? "★ Saved" : "☆ Save";
  } }, isSaved() ? "★ Saved" : "☆ Save");
  const abstract = h("p", { class: "abstract clamp" }, p.abstract);
  const sm = p.summary;
  const summaryText = sm ? [p.title + ".", sm.tldr, "Background. " + sm.background, "What they did. " + sm.approach,
    "Key findings. " + sm.findings.join(" "), "Why it matters. " + sm.why, "Limitations. " + sm.limitations] : null;
  const abstractText = [p.title + ".", "Abstract. " + p.abstract];
  const listenRow = h("div", { class: "listen" });
  const drawListen = () => {
    if (!speech) return listenRow.replaceChildren();
    if (isSpeaking()) return listenRow.replaceChildren(h("button", { class: "btn on", onclick: () => { stopSpeaking(); drawListen(); } }, "■ Stop"));
    const play = (parts) => { speak(parts, drawListen); drawListen(); };
    listenRow.replaceChildren(...[h("span", { class: "label" }, "▶ Listen:"),
      sm ? h("button", { class: "btn", onclick: () => play(summaryText) }, "AI summary") : null,
      h("button", { class: "btn", onclick: () => play(abstractText) }, "Abstract")].filter(Boolean));
  };
  drawListen();
  const others = [{ q: rec.paper, i: null }, ...(rec.also ?? []).map((q, i) => ({ q, i }))].filter(({ i }) => i !== which);
  const more = h("button", { class: "link", onclick: () => { abstract.classList.remove("clamp"); more.remove(); } }, "Read full abstract");
  return [
    which !== null ? h("a", { class: "back", href: href(null) }, "‹ Paper of the Day") : null,
    h("div", { class: "kicker" }, which !== null ? h("span", { class: "classic" }, "Also worth a look") : null, p.classic ? h("span", { class: "classic" }, "Classic") : null, h("span", {}, p.venue),
      p.preprint ? h("span", { class: "pre" }, "Preprint") : null,
      h("span", { class: "pre" }, p.classic ? `${p.year} · ${p.citations.toLocaleString()} citations` : p.date)),
    h("h2", { class: "title" }, p.title),
    h("div", { class: "authors" }, authorLine(p)),
    sm ? h("section", { class: "summary" },
      h("div", { class: "summary-head" }, h("b", {}, "AI summary"), h("span", { class: "src" }, sm.source === "abstract only" ? "from the abstract" : `from the ${sm.source}`)),
      h("p", { class: "tldr" }, sm.tldr),
      h("h4", {}, "Background"), h("p", {}, sm.background),
      h("h4", {}, "What they did"), h("p", {}, sm.approach),
      h("h4", {}, "Key findings"), h("ul", {}, sm.findings.map((f) => h("li", {}, f))),
      h("h4", {}, "Why it matters"), h("p", {}, sm.why),
      h("h4", {}, "Limitations"), h("p", {}, sm.limitations))
    : [h("p", { class: "note" }, "No free full text for this paper, so there's no AI summary."), p.why ? h("div", { class: "why" }, h("b", {}, "Why it matters"), h("p", {}, p.why)) : null, p.tldr ? h("p", { class: "tldr" }, p.tldr) : null],
    listenRow,
    h("div", { class: "section-title" }, "Abstract"),
    abstract, p.abstract.length > 700 ? more : null,
    p.reasons?.length ? h("div", { class: "chips" }, p.reasons.map((r) => h("span", { class: "chip" }, r))) : null,
    h("div", { class: "actions" },
      h("a", { class: "btn primary", href: p.url, target: "_blank", rel: "noopener noreferrer" }, "Read the paper ↗"),
      saveBtn,
      navigator.share ? h("button", { class: "btn", onclick: () => navigator.share({ title: p.title, url: p.url }).catch(() => {}) }, "Share") : null),
    others.length ? [h("div", { class: "section-title" }, which === null ? "Also worth a look" : "More from this day"),
      others.map(({ q, i }) => h("a", { class: "item", href: href(i) }, h("div", { class: "t" }, q.title),
        h("div", { class: "m" }, [i === null ? "Paper of the Day" : null, q.venue, q.preprint ? "preprint" : null, q.summary ? "AI summary" : null].filter(Boolean).join(" · "))))] : null,
    which !== null ? null : h("p", { class: "note" }, rec.pickedBy === "score" ? `Picked by relevance score from ${rec.candidates} candidates.` : `Picked by AI (${rec.pickedBy}) from ${rec.candidates} candidates.`),
  ];
}

async function showDay(date, which = null) {
  view.replaceChildren(masthead("Paper of the Day", date ? fmtDate(date) : "", sync.getStatus()));
  if (!date) { view.append(h("p", { class: "empty" }, "No paper yet — the first one arrives with the next daily run.")); return; }
  try { view.append(...paperView(await (async () => { const rec = await getJSON(`data/${date}.json`); if (which !== null && !rec.also?.[which]) which = null; return rec; })(), which).flat(3).filter(Boolean)); }
  catch { view.append(h("p", { class: "empty" }, "Couldn't load this day. Check your connection.")); }
}

function showList(title, items, emptyText) {
  view.replaceChildren(masthead(title, "", sync.getStatus()));
  if (!items.length) { view.append(h("p", { class: "empty" }, emptyText)); return; }
  for (const d of items) view.append(h("a", { class: "item", href: d.href }, h("div", { class: "t" }, d.title), h("div", { class: "m" }, d.meta)));
}

async function route() {
  const [, page, arg, sub] = (location.hash || "#/").split("/");
  document.querySelectorAll(".tabs a").forEach((a) => (a.dataset.tab === (page || "today") || (a.dataset.tab === "archive" && page === "day")) ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
  window.scrollTo(0, 0);
  const ctx = { view, sync };
  if (page === "watching") return showWatching(ctx);
  if (page === "learn") return showLearn(ctx, arg, sub);
  if (page === "settings") return showSettings(ctx);
  if (page === "archive") return showList("Archive", index.days.map((d) => ({ href: `#/day/${d.date}`, title: d.title, meta: `${fmtDate(d.date)} · ${d.venue}` })), "Nothing here yet.");
  if (page === "saved") return showList("Saved", saved().map((s) => ({ href: s.href ?? `#/day/${s.date}`, title: s.title, meta: `${s.venue} · ${fmtDate(s.date)}` })), "Tap ☆ Save on a paper to keep it here.");
  if (page === "day" && arg) return showDay(arg, /^\d$/.test(sub ?? "") ? Number(sub) : null);
  return showDay(index.days[0]?.date);
}

window.addEventListener("hashchange", route);
getJSON("data/index.json").then((i) => { index = i; }).catch(() => {}).finally(route);
// Your data loads in the background; only the sync dot needs refreshing when it arrives.
sync.onChange((_, st) => document.querySelectorAll(".gear .sync").forEach((d) => { d.className = `sync ${st.state}`; }));
sync.load();
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) navigator.serviceWorker.register("sw.js").catch(() => {});
