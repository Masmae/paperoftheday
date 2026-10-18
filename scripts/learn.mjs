// Learn: writes the next lessons of each track (learn/curriculum.json) a few steps ahead of
// your progress (data/me.json → learn.<track>.done), into data/learn/<lesson-id>.json.
//
//   node scripts/learn.mjs [--dry-run] [--only bio-001]
//
// Uses a cheap model from the OpenCode Go plan (OPENCODE_API_KEY). Each lesson ≈ 6–9K tokens.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";

const ROOT = new URL("../", import.meta.url);
const OUT = new URL("data/learn/", ROOT);
const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const ONLY = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const AHEAD = 3;                 // lessons ready beyond your furthest finished one
const MAX_PER_RUN = 4;           // per track, so a long break doesn't burn tokens in one go
const OPENCODE_URL = "https://opencode.ai/inference/go/openai/v1/chat/completions";
const MODELS = ["glm-5.3-flash", "qwen3.8-flash"];

const curriculum = JSON.parse(readFileSync(new URL("learn/curriculum.json", ROOT), "utf8"));
const me = (() => { try { return JSON.parse(readFileSync(new URL("data/me.json", ROOT), "utf8")); } catch { return {}; } })();
mkdirSync(OUT, { recursive: true });
const indexUrl = new URL("index.json", OUT);
const index = existsSync(indexUrl) ? JSON.parse(readFileSync(indexUrl, "utf8")) : { lessons: {} };

const LEARNER = `The learner has a computer science degree and has passed advanced CS and machine-learning courses (linear algebra, probability, optimization, classic ML, deep learning). They have worked for a few years in bioinformatics, applying AI to transcriptomics and multiomics, so they know biology concepts loosely but never studied biology systematically.`;
const STYLE = {
  bio: `Teach biology systematically and precisely, like an excellent textbook chapter compressed for a sharp reader: mechanisms, not just vocabulary. Define every term the first time. Give concrete numbers and examples (sizes, rates, counts, named genes/proteins). Where natural, use analogies to computing, but never at the cost of accuracy. End sections by connecting to what this looks like in omics data when relevant.`,
  ml: `Teach at research level: skip basics the learner knows. Be mathematically precise using plain-text/Unicode math (e.g. softmax(QKᵀ/√d)V, ∇θ L, p(x|z)); no LaTeX. Explain why methods work, their assumptions, failure modes and trade-offs, and name the key papers (authors, year) in prose. Connect to biological applications (single-cell, spatial, proteins, genomics) where it fits.`,
};

function prompt(track, unit, lesson, prev, next) {
  return `${LEARNER}

${STYLE[track.id]}

Write one lesson (about 1000-1400 words of body text) for the course "${track.title}".
Unit: ${unit.title}
Lesson: ${lesson.title}
What it must cover: ${lesson.focus}
${prev.length ? `Already covered in earlier lessons (build on these, don't repeat): ${prev.join("; ")}` : "This is the first lesson of the course."}
${next ? `The next lesson will be: ${next}` : ""}

Accuracy matters more than anything: state only well-established facts; if something is debated or uncertain, say so. Do not invent citations, numbers or URLs.

Body text format: paragraphs separated by blank lines; "- " for bullet points; **bold** for key terms on first use; \`backticks\` for formulas, gene names or code. No headings inside a section body, no tables, no LaTeX.

Reply with JSON only, no other text:
{"summary": "<2 sentences: what this lesson teaches and why it matters>",
 "sections": [{"heading": "<short>", "body": "<text>"}, ... 3-6 sections],
 "keyIdeas": ["<4-6 one-sentence takeaways>"],
 "inYourData": "<2-4 sentences: how this shows up in transcriptomics/multiomics work or ML-for-biology practice>",
 "quiz": [{"q": "<question testing understanding, not recall of trivia>", "options": ["<4 options>"], "answer": <index 0-3>, "explain": "<1-2 sentences why>"}, ... 4 questions]}`;
}

function valid(o) {
  return o && typeof o.summary === "string" && Array.isArray(o.sections) && o.sections.length >= 2
    && o.sections.every((s) => s.heading && typeof s.body === "string" && s.body.length > 150)
    && Array.isArray(o.keyIdeas) && Array.isArray(o.quiz) && o.quiz.length >= 3
    && o.quiz.every((q) => q.q && Array.isArray(q.options) && q.options.length >= 3 && Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.options.length);
}

async function write(track, unit, lesson, prev, next) {
  const key = process.env.OPENCODE_API_KEY;
  if (!key) throw new Error("OPENCODE_API_KEY not set");
  for (const model of MODELS) {
    try {
      const res = await fetch(OPENCODE_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`, "Content-Type": "application/json",
          "User-Agent": "paperoftheday/1.0 (+https://github.com/Masmae/paperoftheday)",
          "x-opencode-session": "paperoftheday-learn",
        },
        body: JSON.stringify({ model, max_tokens: 6000, messages: [{ role: "user", content: prompt(track, unit, lesson, prev, next) }] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { console.warn(`${lesson.id} ${model}: ${res.status} ${data.error?.message ?? ""}`); continue; }
      const text = data.choices?.[0]?.message?.content ?? "";
      const out = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
      if (!valid(out)) throw new Error("incomplete lesson");
      console.log(`${lesson.id} ${model} (${data.usage?.total_tokens ?? "?"} tokens): ${lesson.title}`);
      return { id: lesson.id, track: track.id, unit: unit.id, title: lesson.title, model, created: new Date().toISOString().slice(0, 10), ...out };
    } catch (e) { console.warn(`${lesson.id} ${model}: ${e.message}`); }
  }
  return null;
}

for (const track of curriculum.tracks) {
  const flat = track.units.flatMap((u) => u.lessons.map((l) => ({ unit: u, lesson: l })));
  const done = new Set(me.learn?.[track.id]?.done ?? []);
  const furthest = flat.reduce((m, x, i) => (done.has(x.lesson.id) ? i : m), -1);
  const want = flat.slice(0, furthest + 1 + AHEAD).filter((x) => ONLY ? x.lesson.id === ONLY : !index.lessons[x.lesson.id]);
  console.log(`${track.id}: ${done.size} done, ${Object.keys(index.lessons).filter((id) => id.startsWith(track.id + "-")).length} written, ${want.length} to write`);
  for (const { unit, lesson } of want.slice(0, MAX_PER_RUN)) {
    if (DRY) { console.log(`  would write ${lesson.id}: ${lesson.title}`); continue; }
    const i = flat.findIndex((x) => x.lesson.id === lesson.id);
    const prev = flat.slice(Math.max(0, i - 6), i).map((x) => x.lesson.title);
    const out = await write(track, unit, lesson, prev, flat[i + 1]?.lesson.title);
    if (!out) continue;
    writeFileSync(new URL(`${lesson.id}.json`, OUT), JSON.stringify(out, null, 1));
    index.lessons[lesson.id] = out.created;
    writeFileSync(indexUrl, JSON.stringify(index, null, 1));
  }
}
