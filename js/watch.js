// Watching: papers matching your rules (authors, journals + title keywords, keywords),
// collected by the daily run into data/watch.json. Rules are edited here and saved to data/me.json.
import { h, store, getJSON, fmtShort, masthead, kids, goBack } from "./dom.js";

let filter = "all";

export async function showWatching(ctx, arg) {
  const { view, sync } = ctx;
  if (arg === "edit") return editRules(ctx);
  view.replaceChildren(...kids(masthead("Watching", "", sync.getStatus())));
  let feed;
  try { feed = await getJSON("data/watch.json"); } catch { feed = { items: [], rules: [] }; }
  const lastSeen = store.get("watchSeen", "");
  store.set("watchSeen", feed.updated ?? "");
  const isNew = (it) => lastSeen && (it.firstSeen ?? "") > lastSeen;

  const counts = {};
  for (const it of feed.items) for (const r of it.rules) counts[r] = (counts[r] ?? 0) + 1;
  const labels = (feed.rules ?? []).map((r) => r.label).filter((l) => counts[l]);
  if (filter !== "all" && !counts[filter]) filter = "all";

  const list = h("div", {});
  const draw = () => {
    const items = feed.items.filter((it) => filter === "all" || it.rules.includes(filter));
    list.replaceChildren(...(items.length ? items.map((it) => item(it, isNew(it)))
      : [h("p", { class: "empty" }, feed.items.length ? "Nothing for this rule yet." : "No matches yet. They arrive with the next daily run.")]));
  };
  const chips = h("div", { class: "chips filter" });
  const drawChips = () => chips.replaceChildren(
    ...[["all", `All ${feed.items.length}`], ...labels.map((l) => [l, `${l} ${counts[l]}`])].map(([key, text]) =>
      h("button", { class: "chip" + (filter === key ? " on" : ""), onclick: () => { filter = key; drawChips(); draw(); } }, text)));
  drawChips(); draw();

  const fresh = feed.items.filter(isNew).length;
  view.append(...kids(
    h("p", { class: "note" }, `${fresh ? `${fresh} new since your last visit · ` : ""}Updated ${feed.updated ? fmtShort(feed.updated) : "—"} · last 60 days`),
    h("div", { class: "actions" }, h("a", { class: "btn", href: "#/watching/edit" }, "Edit what to watch")),
    labels.length ? chips : null,
    list));
}

function item(it, fresh) {
  const detail = h("div", { class: "detail", hidden: true },
    it.authors?.length ? h("div", { class: "authors" }, it.authors.join(", ") + (it.authorCount > it.authors.length ? ` +${it.authorCount - it.authors.length} more` : "")) : null,
    it.abstract ? h("p", { class: "abstract" }, it.abstract) : null,
    h("div", { class: "actions" }, h("a", { class: "btn primary", href: it.url, target: "_blank", rel: "noopener noreferrer" }, "Read the paper ↗")));
  const head = h("button", { class: "item-head", "aria-expanded": "false", onclick: () => {
    detail.hidden = !detail.hidden; head.setAttribute("aria-expanded", String(!detail.hidden));
  } },
    h("div", { class: "t" }, fresh ? h("span", { class: "new" }, "New") : null, it.title),
    h("div", { class: "m" }, [it.venue, it.preprint && it.venue !== "Preprint" ? "preprint" : null, it.date ? fmtShort(it.date) : null].filter(Boolean).join(" · ")),
    h("div", { class: "rules" }, it.rules.map((r) => h("span", { class: "rule" }, r))));
  return h("div", { class: "item watch" }, head, detail);
}

function editRules(ctx) {
  const { view, sync } = ctx;
  const w = structuredClone(sync.getMe().watch ?? { authors: [], journals: [], keywords: [] });
  const lines = (s) => s.split(/\n|;/).map((x) => x.trim()).filter(Boolean);
  const commas = (s) => s.split(",").map((x) => x.trim()).filter(Boolean);
  const authors = h("textarea", { class: "field", rows: "4", placeholder: "Fabian Theis\nAviv Regev" });
  authors.value = w.authors.join("\n");
  const keywords = h("textarea", { class: "field", rows: "3", placeholder: "perturbation\nvirtual cell" });
  keywords.value = w.keywords.join("\n");
  const rows = h("div", {});
  const journalRow = (j) => {
    const name = h("input", { class: "field", placeholder: "Journal, e.g. Nature Methods", "aria-label": "Journal" }); name.value = j.name ?? "";
    const kws = h("input", { class: "field", placeholder: "title keywords, comma-separated (empty = all papers)", "aria-label": "Keywords" }); kws.value = (j.keywords ?? []).join(", ");
    const row = h("div", { class: "jrow" }, name, kws, h("button", { class: "link", onclick: () => row.remove() }, "Remove"));
    row.read = () => ({ name: name.value.trim(), keywords: commas(kws.value) });
    return row;
  };
  rows.append(...w.journals.map(journalRow));
  const msg = h("p", { class: "note" });
  view.replaceChildren(...kids(
    masthead("What to watch", "", sync.getStatus(), { href: "#/watching", label: "Watching" }),
    sync.getToken() ? null : h("p", { class: "warn" }, "This device isn't connected to GitHub, so the daily run won't see these changes. Connect it in ", h("a", { href: "#/settings" }, "Settings"), "."),
    h("div", { class: "section-title" }, "Journals + title keywords"),
    h("p", { class: "note" }, "A paper matches if it's in the journal and its title contains any keyword. Use the journal's full name, like “Nature Biotechnology”."),
    rows,
    h("button", { class: "btn", onclick: () => rows.append(journalRow({})) }, "+ Add journal"),
    h("div", { class: "section-title" }, "Authors and labs"),
    h("p", { class: "note" }, "One per line, full name (“Fabian Theis”). Any journal or preprint."),
    authors,
    h("div", { class: "section-title" }, "Keywords anywhere"),
    h("p", { class: "note" }, "One per line. Matches titles in any journal or preprint server, so keep these specific."),
    keywords,
    h("div", { class: "actions" },
      h("button", { class: "btn primary", onclick: async () => {
        const next = { authors: lines(authors.value), keywords: lines(keywords.value), journals: [...rows.children].map((r) => r.read()).filter((j) => j.name) };
        msg.textContent = "Saving…";
        await sync.update((m) => { m.watch = next; }, "Update watch rules from the app");
        const st = sync.getStatus();
        msg.textContent = st.state === "error" ? `Not saved to GitHub: ${st.message}` : "Saved. New rules are searched in the next daily run (back 60 days).";
      } }, "Save"),
      h("button", { class: "btn", onclick: () => goBack("#/watching") }, "Back")),
    msg));
}
