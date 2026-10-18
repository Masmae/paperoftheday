// On-demand AI summary of a Watching paper, started from the app (ondemand.yml).
//
//   node scripts/ondemand.mjs summary "<paper key from data/watch.json>"
//
// Writes data/summaries/<safe key>.json with { status: "ok" | "nofulltext" | "failed", ... }.
// Summaries come only from open full text (never the abstract). Lessons on demand use
// scripts/learn.mjs --only <id>.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fullText, summarize } from "./lib/papers.mjs";

const [kind, key] = process.argv.slice(2);
if (kind !== "summary" || !key) { console.error("usage: ondemand.mjs summary <key>"); process.exit(2); }

const DATA = new URL("../data/", import.meta.url);
const OUT = new URL("summaries/", DATA);
mkdirSync(OUT, { recursive: true });
/** Same rule as the app (js/watch.js): the file name for a paper key. */
export const summaryFile = (k) => k.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 120) + ".json";

const feed = JSON.parse(readFileSync(new URL("watch.json", DATA), "utf8"));
const item = feed.items.find((it) => it.key === key);
if (!item) { console.error(`not in the Watching feed: ${key}`); process.exit(1); }
const out = new URL(summaryFile(key), OUT);
if (existsSync(out) && JSON.parse(readFileSync(out, "utf8")).status === "ok") { console.log("already summarized"); process.exit(0); }

const base = { key, title: item.title, created: new Date().toISOString().slice(0, 10), at: Date.now() };
const ft = await fullText(item);
if (!ft || ft.text.length < 5000) {
  writeFileSync(out, JSON.stringify({ ...base, status: "nofulltext" }));
  console.log(`no open full text: ${item.title}`);
  process.exit(0);
}
const summary = await summarize(item, ft).catch((e) => { console.warn(e.message); return null; });
writeFileSync(out, JSON.stringify(summary ? { ...base, status: "ok", summary } : { ...base, status: "failed" }));
console.log(summary ? `summarized from ${summary.source}: ${item.title}` : `summary failed: ${item.title}`);
