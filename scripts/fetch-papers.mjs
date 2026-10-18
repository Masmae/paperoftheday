// Picks the Paper of the Day.
//
//   node scripts/fetch-papers.mjs [--date YYYY-MM-DD] [--dry-run]
//
// 1. Collects recent papers from bioRxiv (preprints), arXiv (ML + quantitative
//    biology) and PubMed (top journals) — free public APIs, no keys.
// 2. Scores them for "AI x transcriptomics / multiomics / biotech" relevance.
// 3. If OPENCODE_API_KEY is set, a model from the OpenCode Go plan reads the top
//    candidates and picks the most interesting one, writing a short "why it
//    matters". Otherwise the best score wins.
// 4. Writes data/<date>.json and updates data/index.json. Never repeats a paper.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";

const args = process.argv.slice(2);
const argVal = (n) => { const i = args.indexOf(n); return i < 0 ? null : args[i + 1]; };
const DRY = args.includes("--dry-run");
const DATE = argVal("--date") ?? new Date().toISOString().slice(0, 10);
const DATA = new URL("../data/", import.meta.url);
mkdirSync(DATA, { recursive: true });

const day = (offset) => {
  const d = new Date(DATE + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clean = (s) => String(s ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

async function getText(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "paperoftheday (github.com/Masmae/paperoftheday)" } });
      if (res.ok) return await res.text();
      if (res.status < 500 && res.status !== 429) throw new Error(`${res.status} ${url}`);
    } catch (e) {
      if (i === tries - 1) throw e;
    }
    await sleep(2000 * (i + 1));
  }
  throw new Error("unreachable");
}

// ---------------------------------------------------------------- sources

const BIORXIV_CATEGORIES = new Set([
  "bioinformatics", "genomics", "systems biology", "synthetic biology", "bioengineering",
  "biophysics", "molecular biology", "genetics", "cancer biology", "immunology", "cell biology",
]);

async function fromBiorxiv() {
  const out = [];
  for (const server of ["biorxiv", "medrxiv"]) {
    for (let cursor = 0; cursor < 3000; cursor += 30) {
      let page;
      try { page = JSON.parse(await getText(`https://api.biorxiv.org/details/${server}/${day(-3)}/${day(0)}/${cursor}`)); }
      catch (e) { console.warn(`${server}: ${e.message}`); break; }
      const items = page.collection ?? [];
      for (const p of items) {
        if (server === "biorxiv" && !BIORXIV_CATEGORIES.has(String(p.category).toLowerCase())) continue;
        out.push({
          title: clean(p.title), abstract: clean(p.abstract),
          authors: clean(p.authors).split(";").map((a) => a.trim()).filter(Boolean),
          venue: server === "biorxiv" ? "bioRxiv" : "medRxiv", category: p.category, date: p.date,
          doi: p.doi, url: `https://doi.org/${p.doi}`, preprint: true,
        });
      }
      if (items.length < 30) break;
    }
  }
  return out;
}

async function fromArxiv() {
  const queries = [
    "cat:q-bio.GN OR cat:q-bio.QM OR cat:q-bio.BM OR cat:q-bio.MN",
    '(cat:cs.LG OR cat:cs.AI OR cat:stat.ML) AND (abs:"single-cell" OR abs:transcriptom* OR abs:omics OR abs:protein OR abs:genomic OR abs:biolog*)',
  ];
  const out = [];
  for (const q of queries) {
    const url = `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(q)}&sortBy=submittedDate&sortOrder=descending&max_results=150`;
    let xml;
    try { xml = await getText(url); } catch (e) { console.warn(`arXiv: ${e.message}`); continue; }
    for (const entry of xml.split("<entry>").slice(1)) {
      const tag = (t) => clean((entry.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)) ?? [])[1]);
      const published = tag("published").slice(0, 10);
      if (published < day(-4) || published > day(0)) continue;
      const id = tag("id");
      out.push({
        title: tag("title"), abstract: tag("summary"),
        authors: [...entry.matchAll(/<name>([\s\S]*?)<\/name>/g)].map((m) => clean(m[1])),
        venue: "arXiv", category: (entry.match(/term="([^"]+)"/) ?? [])[1], date: published,
        doi: null, url: id.replace("http://", "https://"), preprint: true,
      });
    }
    await sleep(3500); // arXiv asks for a pause between calls
  }
  return out;
}

const TOP_JOURNALS = [
  "Nature", "Science", "Cell", "Nat Methods", "Nat Biotechnol", "Nat Genet", "Nat Mach Intell",
  "Nat Biomed Eng", "Nat Commun", "Cell Syst", "Cell Genom", "Genome Biol", "Genome Res",
  "Nucleic Acids Res", "Bioinformatics", "Mol Syst Biol", "Sci Adv", "Proc Natl Acad Sci U S A",
];

async function fromPubmed() {
  const ai = '("deep learning"[tiab] OR "machine learning"[tiab] OR "foundation model"[tiab] OR "language model"[tiab] OR transformer[tiab] OR "neural network"[tiab] OR "artificial intelligence"[tiab] OR generative[tiab])';
  const bio = '(transcriptom*[tiab] OR "single-cell"[tiab] OR "single cell"[tiab] OR multiomic*[tiab] OR multi-omic*[tiab] OR "spatial"[tiab] OR proteom*[tiab] OR "protein structure"[tiab] OR "protein design"[tiab] OR genom*[tiab] OR "gene expression"[tiab])';
  const journals = "(" + TOP_JOURNALS.map((j) => `"${j}"[ta]`).join(" OR ") + ")";
  const term = `${ai} AND ${bio} AND ${journals}`;
  const base = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
  let ids = [];
  try {
    const s = JSON.parse(await getText(`${base}/esearch.fcgi?db=pubmed&retmode=json&retmax=120&datetype=edat&mindate=${day(-7).replaceAll("-", "/")}&maxdate=${day(0).replaceAll("-", "/")}&term=${encodeURIComponent(term)}`));
    ids = s.esearchresult?.idlist ?? [];
  } catch (e) { console.warn(`PubMed search: ${e.message}`); return []; }
  if (!ids.length) return [];
  await sleep(400);
  let xml;
  try { xml = await getText(`${base}/efetch.fcgi?db=pubmed&retmode=xml&id=${ids.join(",")}`); }
  catch (e) { console.warn(`PubMed fetch: ${e.message}`); return []; }
  const out = [];
  for (const art of xml.split("<PubmedArticle>").slice(1)) {
    const tag = (t) => clean((art.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)) ?? [])[1]);
    const abstract = [...art.matchAll(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g)].map((m) => clean(m[1])).join(" ");
    const doi = (art.match(/<ArticleId IdType="doi">([^<]+)<\/ArticleId>/) ?? [])[1] ?? null;
    const pmid = tag("PMID");
    const authors = [...art.matchAll(/<Author[^>]*>[\s\S]*?<LastName>([^<]+)<\/LastName>[\s\S]*?(?:<Initials>([^<]+)<\/Initials>)?[\s\S]*?<\/Author>/g)]
      .map((m) => `${m[1]}${m[2] ? " " + m[2] : ""}`);
    if (!abstract) continue;
    out.push({
      title: tag("ArticleTitle"), abstract, authors,
      venue: tag("ISOAbbreviation") || tag("Title"), category: null, date: DATE,
      doi, url: doi ? `https://doi.org/${doi}` : `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`, preprint: false,
    });
  }
  return out;
}

// ---------------------------------------------------------------- scoring

// [pattern, weight, label shown on the paper]
const AI_TERMS = [
  [/foundation model/i, 4, "foundation model"], [/large language model|\bLLMs?\b|language model/i, 3, "language model"],
  [/transformer/i, 2, "transformer"], [/deep learning|deep neural|neural network/i, 2, "deep learning"],
  [/generative|diffusion model|flow matching/i, 2, "generative model"], [/graph neural|GNN/i, 2, "graph neural network"],
  [/contrastive|self-supervised|representation learning/i, 2, "representation learning"],
  [/machine learning|artificial intelligence|\bAI\b/i, 1, "AI"], [/agent(ic)?s?\b/i, 1, "AI agents"], [/zero-shot|in-context/i, 2, "zero-shot"],
];
const BIO_TERMS = [
  [/single[- ]cell/i, 3, "single-cell"], [/transcriptom/i, 3, "transcriptomics"], [/multi-?omic|multimodal omics/i, 3, "multiomics"],
  [/spatial (transcriptom|omics)/i, 3, "spatial omics"], [/perturb/i, 2, "perturbation"], [/gene regulatory|regulatory network/i, 2, "gene regulation"],
  [/chromatin|ATAC|epigenom/i, 2, "epigenomics"], [/proteom/i, 2, "proteomics"],
  [/protein (structure|design|language)|AlphaFold|RoseTTAFold|ESM/i, 3, "proteins"], [/virtual cell|cell atlas/i, 3, "cell atlas"],
  [/CRISPR/i, 1, "CRISPR"], [/RNA-seq|scRNA/i, 2, "RNA-seq"], [/genom/i, 1, "genomics"], [/drug (discovery|design)|molecule generation/i, 2, "drug discovery"],
];
const VENUE_BONUS = { Nature: 5, Science: 5, Cell: 5, "Nat Methods": 4, "Nat Biotechnol": 4, "Nat Genet": 4, "Nat Mach Intell": 4, "Nat Biomed Eng": 3, "Cell Syst": 3, "Cell Genom": 3, "Genome Biol": 3, "Nat Commun": 2, "Sci Adv": 2 };
const DOWNWEIGHT = [[/\b(review|survey|perspective|commentary|protocol)\b/i, -4], [/case report|erratum|correction/i, -8]];

function score(p) {
  const text = `${p.title} ${p.title} ${p.abstract}`;   // title counts double
  const hits = (terms) => terms.filter(([re]) => re.test(text));
  const ai = hits(AI_TERMS), bio = hits(BIO_TERMS);
  const sum = (list) => list.reduce((s, [, w]) => s + w, 0);
  let s = Math.min(sum(ai), 8) + Math.min(sum(bio), 8);
  const landmark = /AlphaFold|RoseTTAFold|protein design|de novo (protein|binder|enzyme)|virtual cell|foundation model/i.test(text);
  if (ai.length && bio.length) s += 4;                    // the sweet spot: AI *and* omics/biotech
  else if (!ai.length && !landmark) s -= 10;              // no AI angle and not landmark biotech: out
  s += Math.min(VENUE_BONUS[p.venue] ?? 0, Math.max(0, sum(ai)));   // a big journal helps only if there's AI in it
  for (const [re, w] of DOWNWEIGHT) if (re.test(p.title)) s += w;
  if (p.abstract.length < 400) s -= 3;
  const reasons = [...ai, ...bio].map(([, , label]) => label);
  return { score: s, reasons: [...new Set(reasons)].slice(0, 6) };
}

// ---------------------------------------------------------------- AI curator (optional)
//
// With an OPENCODE_API_KEY secret, a model from the OpenCode Go plan reads the
// shortlist, picks the most interesting paper and writes "why it matters".
// One small request a day, identified with its own user agent and a stable
// session id as OpenCode asks. Without a key, the best score wins.
const OPENCODE_URL = "https://opencode.ai/inference/go/openai/v1/chat/completions";
// Go-plan models that work with a region-restricted workspace (DeepSeek needs "Global").
const CURATOR_MODELS = ["glm-5.3", "kimi-k3"];   // first that answers wins

async function curate(candidates) {
  const key = process.env.OPENCODE_API_KEY;
  if (!key) return null;
  const list = candidates.map((p, i) => `[${i}] ${p.title}\nVenue: ${p.venue}${p.preprint ? " (preprint)" : ""}\nAbstract: ${p.abstract.slice(0, 2200)}`).join("\n\n");
  const system = "You curate a daily 'Paper of the Day' for a researcher who applies AI to transcriptomics and multiomics. They also love general AI advances with clear biological applications and landmark biotech work (think AlphaFold-level). Choose the single paper they would find most genuinely exciting: new capability, surprising result, or a method they might use. Prefer substance over hype; skip incremental benchmarks, reviews and narrow clinical studies unless remarkable. Answer with JSON only.";
  const user = `Today's candidates:\n\n${list}\n\nReply with JSON only, no other text:\n{"pick": <index>, "why": "<2-3 plain-language sentences on why it matters>", "tldr": "<one sentence: what they did and found>", "runner_ups": [<3 indices>]}`;
  for (const model of CURATOR_MODELS) {
    try {
      const res = await fetch(OPENCODE_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "User-Agent": "paperoftheday/1.0 (+https://github.com/Masmae/paperoftheday)",
          "x-opencode-session": "paperoftheday-daily-curator",
        },
        body: JSON.stringify({ model, max_tokens: 4000, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { console.warn(`curator ${model}: ${res.status} ${data.error?.message ?? ""}`); continue; }
      const text = data.choices?.[0]?.message?.content ?? "";
      const out = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
      if (!Number.isInteger(out.pick) || !candidates[out.pick]) throw new Error("bad pick");
      out.runner_ups = (out.runner_ups ?? []).filter((i) => Number.isInteger(i) && candidates[i] && i !== out.pick);
      console.log(`curator: ${model} (${data.usage?.total_tokens ?? "?"} tokens)`);
      return { ...out, model };
    } catch (e) { console.warn(`curator ${model}: ${e.message}`); }
  }
  return null;
}

// ---------------------------------------------------------------- main

const indexUrl = new URL("index.json", DATA);
const index = existsSync(indexUrl) ? JSON.parse(readFileSync(indexUrl, "utf8")) : { days: [] };
const seen = new Set(index.days.flatMap((d) => [d.key, ...(d.also ?? [])]));
const keyOf = (p) => (p.doi ?? p.url).toLowerCase();

const [bx, ax, pm] = await Promise.all([fromBiorxiv(), fromArxiv(), fromPubmed()]);
console.log(`candidates: bioRxiv/medRxiv ${bx.length}, arXiv ${ax.length}, PubMed ${pm.length}`);
const byKey = new Map();
for (const p of [...pm, ...bx, ...ax]) if (p.title && p.abstract && !byKey.has(keyOf(p)) && !seen.has(keyOf(p))) byKey.set(keyOf(p), p);
const ranked = [...byKey.values()].map((p) => ({ ...p, ...score(p) })).filter((p) => p.score > 6).sort((a, b) => b.score - a.score);
if (!ranked.length) { console.error("no suitable papers found"); process.exit(1); }

const shortlist = ranked.slice(0, 25);
const curated = await curate(shortlist).catch((e) => { console.warn(`curator failed: ${e.message}`); return null; });
const pick = curated ? shortlist[curated.pick] : shortlist[0];
const also = (curated ? curated.runner_ups.map((i) => shortlist[i]).filter(Boolean) : shortlist.slice(1, 4)).filter((p) => p !== pick).slice(0, 3);

const slim = (p) => ({ title: p.title, authors: p.authors.slice(0, 12), authorCount: p.authors.length, venue: p.venue, preprint: p.preprint, date: p.date, doi: p.doi, url: p.url, abstract: p.abstract, reasons: p.reasons, score: p.score });
const record = {
  date: DATE,
  pickedBy: curated ? curated.model : "score",
  paper: { ...slim(pick), tldr: curated?.tldr ?? null, why: curated?.why ?? null },
  also: also.map(slim),
  candidates: ranked.length,
};

console.log(`\n${DATE} — ${record.pickedBy}: ${pick.title} (${pick.venue}, score ${pick.score})`);
for (const a of also) console.log(`   also: ${a.title} (${a.venue})`);
if (DRY) process.exit(0);

writeFileSync(new URL(`${DATE}.json`, DATA), JSON.stringify(record, null, 1));
index.days = [{ date: DATE, title: pick.title, venue: pick.venue, key: keyOf(pick), also: also.map(keyOf) }, ...index.days.filter((d) => d.date !== DATE)]
  .sort((a, b) => b.date.localeCompare(a.date));
writeFileSync(indexUrl, JSON.stringify(index, null, 1));
console.log("saved.");
