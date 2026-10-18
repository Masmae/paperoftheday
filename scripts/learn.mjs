// Learn: writes the next lessons of each track (learn/curriculum.json) a few steps ahead of
// your progress (data/me.json → learn.<track>.done), into data/learn/<lesson-id>.json.
//
//   node scripts/learn.mjs [--dry-run] [--only bio-001]
//   node scripts/learn.mjs --extend bio-u05      add 3 more advanced lessons (outlines) to a unit
//
// Uses a cheap model from the OpenCode Go plan (OPENCODE_API_KEY). Each lesson ≈ 6–9K tokens.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";

const ROOT = new URL("../", import.meta.url);
const OUT = new URL("data/learn/", ROOT);
const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const ONLY = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const EXTEND = args.includes("--extend") ? args[args.indexOf("--extend") + 1] : null;
const AHEAD = 3;                 // lessons ready beyond your furthest finished one
const MAX_PER_RUN = 4;           // per track, so a long break doesn't burn tokens in one go
const OPENCODE_URL = "https://opencode.ai/inference/go/openai/v1/chat/completions";
const MODELS = ["glm-5.3-flash", "qwen3.8-flash", "kimi-k3"];   // first that writes a complete lesson wins
// Thinking models can spend the whole budget "thinking" (drafting the lesson in their head) and
// never answer, so ask for thinking off first; if the API rejects those fields, send a plain request.
const VARIANTS = [
  { label: "thinking off", extra: { thinking: { type: "disabled" }, enable_thinking: false, reasoning_effort: "none" } },
  { label: "plain", extra: {} },
];

const curriculum = JSON.parse(readFileSync(new URL("learn/curriculum.json", ROOT), "utf8"));
// Lessons added later to a unit ("+ Add more advanced lessons" in the app): data/learn/extras.json
// = { units: { "<unit id>": [{ id, title, focus, added }] } }, appended to the end of their unit.
const extrasUrl = new URL("data/learn/extras.json", ROOT);
const extras = existsSync(extrasUrl) ? JSON.parse(readFileSync(extrasUrl, "utf8")) : { units: {} };
for (const t of curriculum.tracks) for (const u of t.units) u.lessons.push(...(extras.units[u.id] ?? []).map((l) => ({ ...l, extra: true })));
const me = (() => { try { return JSON.parse(readFileSync(new URL("data/me.json", ROOT), "utf8")); } catch { return {}; } })();
mkdirSync(OUT, { recursive: true });
const indexUrl = new URL("index.json", OUT);
// The index is rebuilt from the lesson files, so lessons written on demand (ondemand.yml, which
// only adds its one file) are picked up and the two workflows never edit the same file.
const index = { lessons: {} };
for (const f of readdirSync(OUT)) {
  const m = f.match(/^((?:bio|ml)-(?:\d{3}|u\d{2}-x\d{2}))\.json$/);
  if (m) { try { index.lessons[m[1]] = JSON.parse(readFileSync(new URL(f, OUT), "utf8")).created ?? ""; } catch { /* skip a broken file */ } }
}
if (!ONLY && !EXTEND) writeFileSync(indexUrl, JSON.stringify(index, null, 1));

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

/**
 * One streamed chat completion. Streaming keeps the connection busy, so long answers don't hit
 * Node's 5-minute wait-for-headers timeout; hidden "thinking" tokens are skipped.
 */
async function complete(model, content, key, extra = {}) {
  const res = await fetch(OPENCODE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`, "Content-Type": "application/json",
      "User-Agent": "paperoftheday/1.0 (+https://github.com/Masmae/paperoftheday)",
      "x-opencode-session": "paperoftheday-learn",
    },
    body: JSON.stringify({ model, max_tokens: 16000, stream: true, stream_options: { include_usage: true }, ...extra, messages: [{ role: "user", content }] }),
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(`${res.status} ${e.error?.message ?? ""}`); }
  let text = "", thinking = 0, finish = null, usage = null, buf = "";
  const decoder = new TextDecoder();
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      try {
        const j = JSON.parse(data);
        const d = j.choices?.[0]?.delta ?? {};
        text += d.content ?? "";
        thinking += (d.reasoning_content ?? d.reasoning ?? "").length;
        finish = j.choices?.[0]?.finish_reason ?? finish;
        usage = j.usage ?? usage;
      } catch { /* partial or keep-alive line */ }
    }
  }
  return { text, thinking, finish, usage };
}

// What failed earlier in this run, so later lessons don't pay for the same failure again.
const skip = new Set();      // "model" or "model|variant"

/**
 * Ask the models (cheapest first, thinking off when the API allows it) until one returns JSON that
 * passes `ok`. Returns { out, model, info } or null.
 */
async function ask(tag, content, ok) {
  const key = process.env.OPENCODE_API_KEY;
  if (!key) throw new Error("OPENCODE_API_KEY not set");
  for (const model of MODELS) {
    if (skip.has(model)) continue;
    for (const variant of VARIANTS) {
      if (skip.has(`${model}|${variant.label}`)) continue;
      const label = `${tag} ${model} (${variant.label})`;
      try {
        const t0 = Date.now();
        const { text, thinking, finish, usage } = await complete(model, content, key, variant.extra);
        const info = `finish: ${finish}, ${text.length} chars written, ${thinking} chars of thinking, ${usage?.total_tokens ?? "?"} tokens, ${Math.round((Date.now() - t0) / 1000)}s`;
        if (!text.includes("{")) throw new Error(`no answer (${info})`);
        let out;
        try { out = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)); }
        catch { throw new Error(`answer wasn't complete JSON (${info})`); }
        if (!ok(out)) throw new Error(`incomplete answer (${info})`);
        console.log(`${label} — ${info}`);
        return { out, model, info };
      } catch (e) {
        console.warn(`${label}: ${e.message}${e.cause ? ` (${e.cause.code ?? e.cause.message})` : ""}`);
        // A 400 usually means the API didn't accept the thinking fields: try the plain request.
        // Anything else (ran out of room, bad JSON) won't be fixed by the plain request either, so try the next model.
        if (variant.label === "thinking off" && /^400\b/.test(e.message)) { skip.add(`${model}|${variant.label}`); continue; }
        if (/no answer|wasn't complete/.test(e.message)) skip.add(model);     // runs out of room: skip it for the rest of this run
        break;
      }
    }
  }
  return null;
}

async function write(track, unit, lesson, prev, next) {
  const r = await ask(lesson.id, prompt(track, unit, lesson, prev, next), valid);
  if (!r) return null;
  console.log(`  ${lesson.title}`);
  return { id: lesson.id, track: track.id, unit: unit.id, title: lesson.title, model: r.model, created: new Date().toISOString().slice(0, 10), ...r.out };
}

// ---- "+ Add more advanced lessons": outlines for 3 new lessons at the end of a unit ----
if (EXTEND) {
  const track = curriculum.tracks.find((t) => t.units.some((u) => u.id === EXTEND));
  const unit = track?.units.find((u) => u.id === EXTEND);
  if (!unit) { console.error(`no such unit: ${EXTEND}`); process.exit(1); }
  const content = `${LEARNER}

You are extending the course "${track.title}", unit "${unit.title}". It already has these lessons, in order:
${unit.lessons.map((l, i) => `${i + 1}. ${l.title}: ${l.focus}`).join("\n")}

Propose exactly 3 NEW lessons for the end of this unit that go deeper and are more advanced than everything above: research-level details, mechanisms, quantitative aspects, current methods and open questions${track.id === "bio" ? ", and how they show up in transcriptomics/multiomics data" : ", and applications to biology (single-cell, spatial, proteins, genomics)"}. No overlap with existing lessons. Order them from less to more advanced; each should take 10-15 minutes to read.

Reply with JSON only, no other text:
{"lessons": [{"title": "<short title>", "focus": "<1-2 sentences telling a lesson writer exactly what to cover>"}, ... 3 items]}`;
  const r = DRY ? null : await ask(`extend ${unit.id}`, content, (o) => Array.isArray(o.lessons) && o.lessons.length >= 1 && o.lessons.every((l) => l.title && l.focus));
  if (!r) { if (!DRY) console.error("couldn't extend"); process.exit(DRY ? 0 : 1); }
  const list = extras.units[unit.id] ?? [];
  const today = new Date().toISOString().slice(0, 10);
  for (const l of r.out.lessons.slice(0, 3)) {
    const n = list.length + 1;
    list.push({ id: `${unit.id}-x${String(n).padStart(2, "0")}`, title: String(l.title).slice(0, 120), focus: String(l.focus).slice(0, 600), added: today });
  }
  extras.units[unit.id] = list;
  extras.at = Date.now();
  writeFileSync(extrasUrl, JSON.stringify(extras, null, 1));
  console.log(`added to ${unit.title}: ${list.slice(-3).map((l) => l.title).join(" | ")}`);
  process.exit(0);
}

for (const track of curriculum.tracks) {
  const flat = track.units.flatMap((u) => u.lessons.map((l) => ({ unit: u, lesson: l })));
  const done = new Set(me.learn?.[track.id]?.done ?? []);
  const furthest = flat.reduce((m, x, i) => (done.has(x.lesson.id) ? i : m), -1);
  const want = ONLY ? flat.filter((x) => x.lesson.id === ONLY && !index.lessons[ONLY])        // on demand: any lesson
    : flat.slice(0, furthest + 1 + AHEAD).filter((x) => !index.lessons[x.lesson.id]);
  console.log(`${track.id}: ${done.size} done, ${Object.keys(index.lessons).filter((id) => id.startsWith(track.id + "-")).length} written, ${want.length} to write`);
  for (const { unit, lesson } of want.slice(0, MAX_PER_RUN)) {
    if (DRY) { console.log(`  would write ${lesson.id}: ${lesson.title}`); continue; }
    const i = flat.findIndex((x) => x.lesson.id === lesson.id);
    const prev = flat.slice(Math.max(0, i - 6), i).map((x) => x.lesson.title);
    const out = await write(track, unit, lesson, prev, flat[i + 1]?.lesson.title);
    if (!out) continue;
    writeFileSync(new URL(`${lesson.id}.json`, OUT), JSON.stringify(out, null, 1));
    index.lessons[lesson.id] = out.created;
    if (!ONLY) writeFileSync(indexUrl, JSON.stringify(index, null, 1));
  }
}
