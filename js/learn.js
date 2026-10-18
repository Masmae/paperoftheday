// Learn: two tracks (Biology, AI/ML) from learn/curriculum.json. Lessons are written ahead of
// your progress by the daily run (data/learn/<id>.json). Finishing a lesson's quiz marks it
// done (saved to data/me.json, so the next lessons get written); missed and answered questions
// come back for review on a spaced schedule (kept on this device).
import { h, store, getJSON, masthead, kids } from "./dom.js";
import { speech, speak, stopSpeaking, isSpeaking } from "./speech.js";
import { writeControl, loadGenerated, runningSince } from "./ondemand.js";

const INTERVALS = [1, 3, 7, 16, 35, 90];          // days until the next review, by box
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
let base = null, curriculum = null, written = null;

async function loadAll(sync) {
  base ??= await getJSON("learn/curriculum.json");
  // Lessons added to units later ("+ Add more advanced lessons"), appended to the end of their unit.
  const extras = (await loadGenerated(sync, "data/learn/extras.json"))?.units ?? {};
  curriculum = { ...base, tracks: base.tracks.map((t) => ({ ...t, units: t.units.map((u) => ({ ...u, lessons: [...u.lessons, ...(extras[u.id] ?? []).map((l) => ({ ...l, extra: true }))] })) })) };
  // Published index + lessons this device saw written on demand (before the index catches up).
  written = { ...(await getJSON("data/learn/index.json").catch(() => ({ lessons: {} }))).lessons, ...store.get("readyLessons", {}) };
}
const flat = (track) => track.units.flatMap((u) => u.lessons.map((l) => ({ ...l, unit: u })));
const findLesson = (id) => { for (const t of curriculum.tracks) for (const l of flat(t)) if (l.id === id) return { track: t, lesson: l }; return null; };
const doneSet = (sync, trackId) => new Set(sync.getMe().learn?.[trackId]?.done ?? []);
const srs = () => store.get("srs", {});
const dueCards = () => Object.entries(srs()).filter(([, c]) => c.due <= today());

export async function showLearn(ctx, arg, sub) {
  const { view, sync } = ctx;
  try { await loadAll(sync); } catch {
    view.replaceChildren(...kids(masthead("Learn", "", sync.getStatus()), h("p", { class: "empty" }, "Couldn't load the course. Check your connection.")));
    return;
  }
  // Sub-pages get a Back button in the header: track → Learn, lesson → its track, review → Learn.
  const lessonTrack = arg === "lesson" ? findLesson(sub)?.track : null;
  const back = lessonTrack ? { href: `#/learn/track/${lessonTrack.id}`, label: lessonTrack.title }
    : arg === "track" || arg === "review" || arg === "lesson" ? { href: "#/learn", label: "Learn" } : null;
  view.replaceChildren(...kids(masthead("Learn", "", sync.getStatus(), back)));
  if (arg === "review") return review(ctx);
  if (arg === "lesson" && sub) return lessonPage(ctx, sub);
  if (arg === "track" && sub) return trackPage(ctx, sub);
  overview(ctx);
}

function overview({ view, sync }) {
  const due = dueCards().length;
  view.append(...kids(
    due ? h("a", { class: "card review-card", href: "#/learn/review" }, h("b", {}, `Review · ${due} question${due === 1 ? "" : "s"} due`), h("span", {}, "Spaced repetition of past quizzes")) : null,
    ...curriculum.tracks.map((t) => {
      const lessons = flat(t), done = doneSet(sync, t.id);
      const next = lessons.find((l) => !done.has(l.id));
      const pct = Math.round((100 * done.size) / lessons.length);
      const bar = h("div", { class: "bar" }, h("i", {}));
      bar.firstChild.style.width = `${pct}%`;
      return h("section", { class: "card track" },
        h("div", { class: "kicker" }, h("span", {}, t.title), h("span", { class: "pre" }, `${done.size}/${lessons.length} lessons`)),
        h("p", {}, t.blurb), bar,
        next ? h("div", { class: "actions" },
          written[next.id] ? h("a", { class: "btn primary", href: `#/learn/lesson/${next.id}` }, done.size ? "Continue" : "Start")
            : h("a", { class: "btn primary", href: `#/learn/lesson/${next.id}` }, runningSince(`lesson:${next.id}`) ? "Being written…" : "Write it now"),
          h("a", { class: "btn", href: `#/learn/track/${t.id}` }, "All lessons")) : h("p", {}, "Track complete 🎉"),
        next ? h("p", { class: "note" }, `Next: ${next.title} · ${next.unit.title}`) : null);
    }),
    sync.getToken() ? null : h("p", { class: "warn" }, "Connect GitHub in ", h("a", { href: "#/settings" }, "Settings"), " so the daily run knows how far you are and writes the next lessons.")));
}

function trackPage(ctx, trackId) {
  const { view, sync } = ctx;
  const t = curriculum.tracks.find((x) => x.id === trackId);
  if (!t) return overview({ view, sync });
  const done = doneSet(sync, t.id);
  view.append(...kids(h("h2", { class: "title" }, t.title)));
  for (const u of t.units) {
    view.append(...kids(h("div", { class: "section-title" }, u.title),
      ...u.lessons.map((l) => written[l.id]
        ? h("a", { class: "item", href: `#/learn/lesson/${l.id}` }, h("div", { class: "t" }, done.has(l.id) ? "✓ " : "", l.title, l.extra ? h("span", { class: "added" }, "added") : null), h("div", { class: "m" }, l.focus))
        : h("a", { class: "item locked", href: `#/learn/lesson/${l.id}` }, h("div", { class: "t" }, l.title, l.extra ? h("span", { class: "added" }, "added") : null),
          h("div", { class: "m" }, runningSince(`lesson:${l.id}`) ? "Being written…" : "Not written yet · tap to write it now"))),
      moreControl(ctx, t, u),
      u.resources?.length ? h("div", { class: "resources" }, "Read more: ", u.resources.map((r, i) => [i ? " · " : "", h("a", { href: r.url, target: "_blank", rel: "noopener noreferrer" }, r.title)])) : null));
  }
}

/** "+ Add 3 more advanced lessons" for a unit (GitHub Actions writes the outlines, ~1–2 minutes). */
function moreControl(ctx, track, unit) {
  const before = unit.lessons.filter((l) => l.extra).length;
  return h("div", { class: "more-lessons" }, writeControl(ctx.sync, {
    kind: "extend", id: unit.id, path: "data/learn/extras.json", label: "+ Add 3 more advanced lessons",
    done: (f) => (f?.units?.[unit.id]?.length ?? 0) > before,
    onReady: () => showLearn(ctx, "track", track.id),
  }));
}

/** Tiny safe renderer: paragraphs, "- " bullets, **bold**, `code`. Builds DOM nodes, never HTML strings. */
function rich(text) {
  const inline = (s) => s.split(/(\*\*[^*]+\*\*|`[^`]+`)/).filter(Boolean).map((part) =>
    part.startsWith("**") && part.endsWith("**") ? h("b", {}, part.slice(2, -2)) : part.startsWith("`") && part.endsWith("`") ? h("code", {}, part.slice(1, -1)) : part);
  return text.split(/\n\s*\n/).map((block) => {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length && lines.every((l) => /^[-•*] /.test(l))) return h("ul", {}, lines.map((l) => h("li", {}, inline(l.replace(/^[-•*] /, "")))));
    return h("p", {}, inline(lines.join(" ")));
  });
}
const plain = (s) => s.replace(/\*\*|`/g, "");

async function lessonPage(ctx, id) {
  const { view, sync } = ctx;
  const found = findLesson(id);
  let L;
  if (!found) { view.append(...kids(h("p", { class: "empty" }, "There's no such lesson."))); return; }
  L = await loadGenerated(sync, `data/learn/${id}.json`);
  if (!L) {
    // Not written yet: offer to write it now (GitHub Actions, about 2 minutes).
    const { track: tr, lesson: le } = found;
    view.append(...kids(
      h("div", { class: "kicker" }, h("span", {}, tr.title), h("span", { class: "pre" }, le.unit.title)),
      h("h2", { class: "title" }, le.title),
      h("p", { class: "tldr" }, le.focus),
      writeControl(sync, {
        kind: "lesson", id, path: `data/learn/${id}.json`, label: "Write this lesson now",
        onReady: () => { store.set("readyLessons", { ...store.get("readyLessons", {}), [id]: new Date().toISOString().slice(0, 10) }); showLearn(ctx, "lesson", id); },
      }),
      h("p", { class: "note" }, "Lessons are normally written a few ahead of where you are, during the daily run.")));
    return;
  }
  const { track, lesson } = found;
  const lessons = flat(track), i = lessons.findIndex((l) => l.id === id), next = lessons[i + 1];

  const listen = h("div", { class: "listen" });
  const text = [L.title + ".", L.summary, ...L.sections.flatMap((s) => [s.heading + ".", plain(s.body)]), "Key ideas. " + L.keyIdeas.join(" ")];
  const drawListen = () => {
    if (!speech) return listen.replaceChildren();
    if (isSpeaking()) return listen.replaceChildren(h("button", { class: "btn on", onclick: () => { stopSpeaking(); drawListen(); } }, "■ Stop"));
    listen.replaceChildren(h("button", { class: "btn", onclick: () => { speak(text, drawListen); drawListen(); } }, "▶ Listen to this lesson"));
  };
  drawListen();

  const quizBox = h("div", { class: "quiz" });
  const answers = new Array(L.quiz.length).fill(null);
  const finish = h("div", {});
  const drawFinish = () => {
    if (answers.some((a) => a === null)) return finish.replaceChildren();
    const right = answers.filter((a, k) => a === L.quiz[k].answer).length;
    sync.update((m) => {
      m.learn ??= {}; m.learn[track.id] ??= { done: [] };
      if (!m.learn[track.id].done.includes(id)) m.learn[track.id].done.push(id);
    }, `Learn: finished ${id}`);
    finish.replaceChildren(h("p", { class: "result" }, `${right}/${L.quiz.length} correct. Lesson done${right < L.quiz.length ? "; the ones you missed come back tomorrow" : ""}.`),
      h("div", { class: "actions" },
        next ? h("a", { class: "btn primary", href: `#/learn/lesson/${next.id}` }, `Next: ${next.title}`) : h("span", { class: "note" }, "That's the last lesson of this track."),
        h("a", { class: "btn", href: "#/learn" }, "Back to Learn")));
  };
  L.quiz.forEach((q, k) => quizBox.append(question(q, `${id}#${k}`, (choice) => { answers[k] = choice; drawFinish(); })));

  view.append(...kids(
    h("div", { class: "kicker" }, h("span", {}, track.title), h("span", { class: "pre" }, lesson.unit.title)),
    h("h2", { class: "title" }, L.title),
    h("p", { class: "tldr" }, L.summary),
    listen,
    ...L.sections.flatMap((s) => [h("h3", { class: "lesson-h" }, s.heading), ...rich(s.body)]),
    h("section", { class: "summary" }, h("div", { class: "summary-head" }, h("b", {}, "Key ideas")), h("ul", {}, L.keyIdeas.map((k) => h("li", {}, k)))),
    L.inYourData ? h("div", { class: "why" }, h("b", {}, "In your data"), h("p", {}, L.inYourData)) : null,
    h("div", { class: "section-title" }, "Check yourself"),
    quizBox, finish,
    lesson.unit.resources?.length ? [h("div", { class: "section-title" }, "Read more"), h("div", { class: "resources" }, lesson.unit.resources.map((r) => h("a", { class: "item", href: r.url, target: "_blank", rel: "noopener noreferrer" }, h("div", { class: "t" }, r.title, " ↗"))))] : null,
    h("p", { class: "note" }, `Written by AI (${L.model}) from a hand-made syllabus. For anything important, check the sources above.`)));
}

/** One multiple-choice question; records the result for spaced review. */
function question(q, cardId, onAnswer) {
  const box = h("div", { class: "q" });
  const explain = h("p", { class: "explain", hidden: true }, q.explain ?? "");
  const opts = q.options.map((o, j) => h("button", { class: "opt", onclick: () => {
    if (box.dataset.answered) return;
    box.dataset.answered = "1";
    opts.forEach((b, k) => { b.disabled = true; if (k === q.answer) b.classList.add("right"); });
    if (j !== q.answer) opts[j].classList.add("wrong");
    explain.hidden = false;
    grade(cardId, q, j === q.answer);
    onAnswer(j);
  } }, o));
  box.append(h("p", { class: "qtext" }, q.q), ...opts, explain);
  return box;
}

function grade(cardId, q, right) {
  const all = srs();
  const c = all[cardId] ?? { box: 0, q };
  c.box = right ? Math.min(INTERVALS.length - 1, c.box + 1) : 0;
  c.due = addDays(right ? INTERVALS[c.box] : 1);
  c.q = q;
  all[cardId] = c;
  store.set("srs", all);
}

function review({ view }) {
  const due = dueCards().sort(() => Math.random() - 0.5).slice(0, 15);
  view.append(...kids(h("h2", { class: "title" }, "Review")));
  if (!due.length) { view.append(...kids(h("p", { class: "empty" }, "Nothing due. Nice!"))); return; }
  let left = due.length;
  const done = h("div", {});
  view.append(...kids(h("p", { class: "note" }, `${due.length} question${due.length === 1 ? "" : "s"}. Right answers come back later each time; misses come back tomorrow.`),
    ...due.map(([id, c]) => question(c.q, id, () => { if (--left === 0) done.replaceChildren(h("p", { class: "result" }, "Review done."), h("a", { class: "btn", href: "#/learn" }, "Back to Learn")); })),
    done));
}
