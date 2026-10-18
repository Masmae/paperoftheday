// Small shared helpers for the views.
export const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem("potd." + k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem("potd." + k, JSON.stringify(v)); } catch { /* ignore */ } },
};
export const h = (tag, attrs = {}, ...kids) => {
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
export const fmtDate = (d) => new Date(d + "T12:00:00Z").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
export const authorLine = (p) => p.authors.length ? p.authors.slice(0, 6).join(", ") + (p.authorCount > 6 ? ` +${p.authorCount - 6} more` : "") : "";
export const getJSON = async (path) => { const r = await fetch(path, { cache: "no-cache" }); if (!r.ok) throw new Error(r.status); return r.json(); };

export const fmtShort = (d) => new Date(d + "T12:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
export const paperKey = (p) => (p.doi ?? p.url ?? p.title).toLowerCase();

/** Page header with a settings link; the dot shows whether your data is syncing to GitHub. */
export function masthead(title, sub, status) {
  const dot = status ? h("span", { class: `sync ${status.state}`, title: { synced: "Synced to GitHub", saving: "Saving…", error: `Not saved: ${status.message}`, local: "Saved on this device only" }[status.state] }) : null;
  return h("header", { class: "masthead" }, h("h1", {}, title), sub ? h("span", { class: "date" }, sub) : null,
    h("a", { class: "gear", href: "#/settings", "aria-label": "Settings" }, dot, "⚙"));
}

/** Children for append/replaceChildren: flattens nested arrays and drops null/false (which would print as "null"). */
export const kids = (...xs) => xs.flat(3).filter((x) => x != null && x !== false);
