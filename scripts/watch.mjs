// Watching: new papers matching the rules in data/me.json → data/watch.json.
//
//   node scripts/watch.mjs [--dry-run]
//
// Rules (edited in the app's Watching tab):
//   authors:  ["Fabian Theis", ...]                        any venue, preprints included
//   journals: [{ name: "Nature Methods", keywords: [...] }] that journal, a keyword in the title (no keywords = everything)
//   keywords: ["perturbation", ...]                         a keyword in the title, any venue
// One free API (Europe PMC) covers journals and preprints (bioRxiv, medRxiv, arXiv…). No keys, no AI.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const DATA = new URL("../data/", import.meta.url);
const DRY = process.argv.includes("--dry-run");
const LOOKBACK_DAYS = 14;        // search window each run (catches late indexing)
const KEEP_DAYS = 60;            // how long a match stays in the feed
const MAX_ITEMS = 500;
const today = new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const DEFAULT_WATCH = {
  authors: [],
  journals: ["Nature", "Science", "Cell", "Nature Methods", "Nature Biotechnology", "Nature Genetics", "Nature Machine Intelligence", "Cell Systems", "Genome Biology"]
    .map((name) => ({ name, keywords: ["single-cell", "single cell", "spatial", "transcriptom", "multiomic", "multi-omic", "foundation model", "deep learning", "language model", "machine learning", "transformer"] })),
  keywords: [],
};

const me = existsSync(new URL("me.json", DATA)) ? JSON.parse(readFileSync(new URL("me.json", DATA), "utf8")) : {};
const watch = me.watch ?? DEFAULT_WATCH;

const q = (s) => `"${String(s).replace(/"/g, "")}"`;
// Europe PMC matches whole words; a trailing "transcriptom" style stem becomes a wildcard.
const titleTerm = (k) => (/[a-z]$/i.test(k) && k.length >= 6 && !/\s/.test(k) && !/(ic|al|el|ed|ing|s|y|e)$/i.test(k) ? `TITLE:${k.replace(/[^\w-]/g, "")}*` : `TITLE:${q(k)}`);
const anyTitle = (kws) => `(${kws.map(titleTerm).join(" OR ")})`;

const rules = [
  ...watch.authors.filter(Boolean).map((a) => ({ label: a, kind: "author", query: `AUTH:${q(a)}` })),
  ...watch.journals.filter((j) => j?.name).map((j) => ({
    label: j.name,
    kind: "journal",
    query: `JOURNAL:${q(j.name)}${j.keywords?.length ? ` AND ${anyTitle(j.keywords)}` : ""}`,
  })),
  ...watch.keywords.filter(Boolean).map((k) => ({ label: `“${k}”`, kind: "keyword", query: titleTerm(k) })),
];

async function search(query, dates) {
  const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?format=json&resultType=core&pageSize=100&sort=P_PDATE_D%20desc&query=${encodeURIComponent(`(${query}) AND ${dates}`)}`;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "paperoftheday (github.com/Masmae/paperoftheday)" } });
      if (res.ok) return (await res.json()).resultList?.result ?? [];
      if (res.status < 500 && res.status !== 429) throw new Error(`${res.status}`);
    } catch (e) { if (i === 2) throw e; }
    await sleep(2000 * (i + 1));
  }
  return [];
}

const strip = (s) => (s ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
function toItem(r) {
  const doi = r.doi?.toLowerCase();
  const venue = r.journalInfo?.journal?.title ? (r.journalInfo.journal.medlineAbbreviation || r.journalInfo.journal.title)
    : r.bookOrReportDetails?.publisher ?? (r.source === "PPR" ? "Preprint" : "");
  return {
    key: doi ?? `${r.source}:${r.id}`,
    title: strip(r.title).replace(/\.$/, ""),
    authors: (r.authorList?.author ?? []).slice(0, 8).map((a) => a.fullName).filter(Boolean),
    authorCount: r.authorList?.author?.length ?? 0,
    venue,
    preprint: r.source === "PPR",
    date: r.firstPublicationDate ?? today,
    url: doi ? `https://doi.org/${doi}` : `https://europepmc.org/article/${r.source}/${r.id}`,
    abstract: strip(r.abstractText).slice(0, 2500),
  };
}

const feedUrl = new URL("watch.json", DATA);
const feed = existsSync(feedUrl) ? JSON.parse(readFileSync(feedUrl, "utf8")) : { items: [] };
const byKey = new Map(feed.items.map((it) => [it.key, it]));
// First run (or new rules): look back over the whole feed window so the tab isn't empty.
const known = new Set(feed.rules?.map((r) => r.label) ?? []);
const datesFor = (rule) => `FIRST_PDATE:[${daysAgo(known.has(rule.label) ? LOOKBACK_DAYS : KEEP_DAYS)} TO ${today}]`;
let fresh = 0;
for (const rule of rules) {
  try {
    const hits = await search(rule.query, datesFor(rule));
    for (const r of hits) {
      if (!r.title) continue;
      const it = toItem(r);
      const old = byKey.get(it.key);
      if (old) { if (!old.rules.includes(rule.label)) old.rules.push(rule.label); continue; }
      byKey.set(it.key, { ...it, rules: [rule.label], firstSeen: today });
      fresh++;
    }
    console.log(`${rule.label}: ${hits.length}`);
  } catch (e) { console.warn(`${rule.label}: failed (${e.message})`); }
  await sleep(300);
}

const cutoff = daysAgo(KEEP_DAYS);
const items = [...byKey.values()].filter((it) => (it.firstSeen ?? it.date) >= cutoff)
  .sort((a, b) => (b.firstSeen ?? "").localeCompare(a.firstSeen ?? "") || (b.date ?? "").localeCompare(a.date ?? ""))
  .slice(0, MAX_ITEMS);
console.log(`watch: ${rules.length} rules, ${fresh} new, ${items.length} in feed`);
if (!DRY) writeFileSync(feedUrl, JSON.stringify({ updated: today, rules: rules.map((r) => ({ label: r.label, kind: r.kind })), items }));
