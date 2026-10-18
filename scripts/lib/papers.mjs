// Shared by the daily pick (fetch-papers.mjs) and on-demand summaries (ondemand.mjs):
// fetching, open full text (bioRxiv/medRxiv XML or PDF, arXiv HTML or PDF, Europe PMC open
// access) and the structured AI summary (only ever from full text).
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const OPENCODE_URL = "https://opencode.ai/inference/go/openai/v1/chat/completions";
export const CURATOR_MODELS = ["glm-5.3-flash", "qwen3.8-flash"];   // first that answers wins
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function getText(url, tries = 3) {
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

// ---------------------------------------------------------------- full text + AI summary

const stripXml = (x) => x.replace(/<(script|style|ref-list|back|nav|header|footer)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();

const MIN_TEXT = 5000;                                   // shorter = only metadata or an error page
const enough = (t) => (t && t.length >= MIN_TEXT ? t : null);

/** Body text of a JATS XML file, or null (missing body, error page, metadata only). */
async function jatsText(url) {
  try {
    const xml = await getText(url);
    if (!/<article[\s>]/.test(xml)) return null;          // an HTML "not found" page
    const body = xml.match(/<body[\s\S]*<\/body>/i)?.[0];
    return body ? enough(stripXml(body)) : null;
  } catch { return null; }
}

/** Text of a PDF via pdftotext (poppler), or null. */
async function pdfText(url) {
  let dir;
  try {
    const res = await fetch(url, { headers: { "User-Agent": "paperoftheday (github.com/Masmae/paperoftheday)" } });
    if (!res.ok || !/pdf/i.test(res.headers.get("content-type") ?? "")) return null;
    dir = mkdtempSync(join(tmpdir(), "potd-"));
    const file = join(dir, "paper.pdf");
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    const text = execFileSync("pdftotext", ["-q", "-enc", "UTF-8", file, "-"], { maxBuffer: 128 * 1024 * 1024 }).toString();
    return enough(text.replace(/\s+/g, " ").trim());
  } catch (e) { console.warn(`pdf: ${e.message}`); return null; }
  finally { if (dir) rmSync(dir, { recursive: true, force: true }); }
}

/** Open full text when available: bioRxiv/medRxiv (XML, else PDF), arXiv (HTML, else PDF), or Europe PMC open access. */
export async function fullText(p) {
  try {
    // bioRxiv/medRxiv DOIs use 10.1101 (older) or 10.64898 (since late 2025).
    if (p.jatsxml || (p.doi && (/^10\.(1101|64898)\//.test(p.doi) || /^(bio|med)rxiv$/i.test(p.venue ?? "")))) {
      if (p.jatsxml) { const t = await jatsText(p.jatsxml); if (t) return { text: t, source: "bioRxiv full text" }; }
      for (const server of p.doi ? ["biorxiv", "medrxiv"] : []) {
        const versions = await getText(`https://api.biorxiv.org/details/${server}/${p.doi}`).then((x) => JSON.parse(x).collection ?? []).catch(() => []);
        if (!versions.length) continue;
        const name = server === "medrxiv" ? "medRxiv" : "bioRxiv";
        const latest = versions.at(-1);
        // The newest XML sometimes lacks the body (or isn't processed yet): fall back to its PDF, then older versions' XML.
        let t = await jatsText(latest.jatsxml);
        if (t) return { text: t, source: `${name} full text` };
        t = await pdfText(`https://www.${server}.org/content/${p.doi}v${latest.version}.full.pdf`);
        if (t) return { text: t, source: `${name} full text (PDF)` };
        for (const v of versions.slice(0, -1).reverse()) {
          t = await jatsText(v.jatsxml);
          if (t) return { text: t, source: `${name} full text (v${v.version})` };
        }
        break;
      }
    }
    // arXiv: from the abs URL, or a DataCite arXiv DOI (10.48550/arXiv.<id>, as Europe PMC lists them).
    const arxivId = p.url?.match(/arxiv\.org\/abs\/([^?#]+)/)?.[1] ?? p.doi?.match(/^10\.48550\/arxiv\.(.+)$/i)?.[1];
    if (arxivId) {
      const html = await getText(`https://arxiv.org/html/${arxivId}`).catch(() => "");
      const t = enough(stripXml(html.match(/<article[\s\S]*<\/article>/i)?.[0] ?? html));
      if (t) return { text: t, source: "arXiv full text" };
      const pdf = await pdfText(`https://arxiv.org/pdf/${arxivId}`);
      if (pdf) return { text: pdf, source: "arXiv full text (PDF)" };
    }
    if (p.doi) {
      const s = JSON.parse(await getText(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=DOI:%22${encodeURIComponent(p.doi)}%22&format=json&resultType=lite`));
      const hit = s.resultList?.result?.[0];
      if (hit?.pmcid && hit.isOpenAccess === "Y") {
        const xml = await getText(`https://www.ebi.ac.uk/europepmc/webservices/rest/${hit.pmcid}/fullTextXML`);
        const body = xml.match(/<body[\s\S]*<\/body>/i)?.[0] ?? xml;
        return { text: stripXml(body), source: "open-access full text" };
      }
    }
  } catch (e) { console.warn(`full text: ${e.message}`); }
  return null;
}

/** Structured AI summary from the paper's open full text. No full text → no summary (an abstract summary adds nothing). */
export async function summarize(p, ft = undefined) {
  const key = process.env.OPENCODE_API_KEY;
  if (!key) return null;
  if (ft === undefined) ft = await fullText(p);
  if (!ft || ft.text.length < 5000) { console.log(`no open full text: ${p.title.slice(0, 70)}`); return null; }
  const body = ft.text.slice(0, 60000);
  const source = ft.source;
  const prompt = `Summarize this paper for a researcher who works on AI for transcriptomics and multiomics, so they can understand it without reading it. Be concrete: name the model/method, data, scale, and the main numbers. Plain language, no hype. About 300-400 words in total.

Title: ${p.title}
Venue: ${p.venue}${p.classic ? ` (${p.year}, ${p.citations} citations)` : ""}
Abstract: ${p.abstract}

Full text (may be truncated):
${body}

Reply with JSON only, no other text:
{"tldr": "<one sentence>", "background": "<2 sentences: the problem and why it is hard>", "approach": "<2-4 sentences: what they built or did>", "findings": ["<3-5 key results, each one sentence, with numbers where given>"], "why": "<2 sentences: why it matters for the field / for this reader>", "limitations": "<1-2 sentences: caveats or open questions>"}`;
  for (const model of CURATOR_MODELS) {
    try {
      const res = await fetch(OPENCODE_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`, "Content-Type": "application/json",
          "User-Agent": "paperoftheday/1.0 (+https://github.com/Masmae/paperoftheday)",
          "x-opencode-session": "paperoftheday-daily-curator",
        },
        body: JSON.stringify({ model, max_tokens: 4000, messages: [{ role: "user", content: prompt }] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { console.warn(`summary ${model}: ${res.status} ${data.error?.message ?? ""}`); continue; }
      const text = data.choices?.[0]?.message?.content ?? "";
      const out = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
      if (!out.tldr || !Array.isArray(out.findings)) throw new Error("incomplete summary");
      console.log(`summary: ${model} from ${source} (${data.usage?.total_tokens ?? "?"} tokens)`);
      return { ...out, source, model, chars: ft.text.length };
    } catch (e) { console.warn(`summary ${model}: ${e.message}`); }
  }
  return null;
}

