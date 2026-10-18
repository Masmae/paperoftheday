# Paper of the Day

One genuinely interesting paper every morning: AI for transcriptomics and multiomics, general AI with clear uses in biology, and landmark biotech (AlphaFold-level).

**Read it:** https://masmae.github.io/paperoftheday/. On iPhone, open it in Safari, then tap Share → Add to Home Screen.

## How it works

- **When:** every day at 13:00 UTC (6 AM Pacific), [`.github/workflows/daily.yml`](.github/workflows/daily.yml) runs on GitHub's machines.
- **Collect:** it gathers recent papers from **bioRxiv/medRxiv** (last 7 days), **arXiv** (ML and quantitative biology, last 10 days) and **PubMed** (top journals, last 30 days). All are free public APIs, and no keys are needed.
- **Classics:** **OpenAlex** (free, no key) adds highly cited AI × omics papers from 2016 onward, such as single-cell and spatial deep learning, multiomics, protein models and genome language models. A classic gets a citation bonus, is labelled "Classic · year · citations", and can win at most once every few days.
- **Pool:** papers go into a rolling **3-week pool** (`data/pool.json`), so the pick doesn't have to come from today's batch.
- **Score:** papers need an AI angle together with omics or biotech; landmark biotech counts even without AI. A top journal helps only if the paper has real AI content.
- **Quality rules:**
  - Rewarded: released code, scale, generalization, independent or wet-lab validation, genuinely new methods.
  - Penalized: reviews and meta-analyses, nomograms and radiomics, hub-gene and signature studies, database and web-server papers, narrow clinical prediction.
  - Variety: a paper loses points if it's too similar to the last 3 picks.
- **Pick:** the best-ranked paper wins.
- **Optional, the AI curator:** add an `OPENCODE_API_KEY` repository secret (Settings → Secrets and variables → Actions). A model from the OpenCode Go plan then reads the top 25 candidates, picks the most interesting one and writes a short "why it matters".
  - **How it judges:** it scores each candidate on novelty, generality, rigor, relevance and impact.
  - **Models:** cheap GLM-5.3-Flash, with Qwen3.8-Flash as backup. Both work with a region-restricted workspace.
  - **Usage:** about 12K tokens, one request a day.
- **AI summary:** the pick and the three "Also worth a look" papers each get their own page with a structured summary of about 300–400 words: TL;DR, background, what they did, key findings, why it matters, and limitations.
  - Summaries are written **only from the open full text**, never from the abstract alone. Sources: bioRxiv/medRxiv XML, falling back to the PDF and then to older versions; arXiv HTML, falling back to the PDF; and Europe PMC open access. PDFs are read with `pdftotext`, which the workflow installs.
  - Papers with free full text are preferred. If the curator's choice has none, the next-best paper that does is picked instead. A paper with no free full text shows no summary.
  - About 15K tokens per summary on the same flash model, so roughly 60–75K tokens a day in total.
  - **Backfill:** on the Actions tab, choose **Run workflow** and tick "backfill". This adds missing summaries to days that are already published. It runs on GitHub, never on your device.
- **Publish:** it writes `data/<date>.json` and `data/index.json`, commits them, and redeploys Pages. Papers are never repeated.

## Watching and Learn

Both keep your data in **`data/me.json`**: watch rules, and which lessons you've finished. The app writes it, and the daily run reads it.

- **Connect a device (once):** open **⚙ Settings** in the app and paste a GitHub **fine-grained token**. Give it access only to this repository, with **Contents: Read and write** and nothing else.
  - The token is stored only in that browser, never in the repo.
  - Without a token, everything still works, but it stays on that device and the daily run can't see it.
- **Watching** (`scripts/watch.mjs`): new papers from the last 60 days that match your rules: a journal plus title keywords, authors or labs, or keywords in any venue.
  - It uses the free Europe PMC API, which covers journals and preprints. No AI and no tokens.
  - Edit the rules in the app with **Edit what to watch**.
- **Learn** (`scripts/learn.mjs`): two tracks.
  - **Biology:** systematic, from the foundations up to omics technologies.
  - **AI/ML:** research level.
  - The syllabus is fixed, in `learn/curriculum.json`. Each daily run writes lessons up to 3 ahead of your progress (at most 4 per track per run, about 7K tokens each) into `data/learn/`. Each lesson has key ideas, an "In your data" section, and a 4-question quiz.
  - Finishing the quiz marks the lesson done. Questions then come back for spaced review, which is kept on each device.

### On demand: write it now

- **What:** on a lesson that isn't written yet, tap **Write this lesson now**. On a Watching paper, tap **AI summary from the full text**.
- **How it works:**
  - The app asks GitHub to run `.github/workflows/ondemand.yml`, using the token from ⚙ Settings. That token needs **Contents: Read and write**, nothing else.
  - The job writes the file (`data/learn/<id>.json` or `data/summaries/<key>.json`) with the OpenCode key from the repo secrets.
  - The app reads the new file straight from the repo, so it doesn't wait for the site to redeploy.
- **Wait:** usually about 2 minutes.
- **Results are kept,** so each one costs tokens only once and shows on every device.
- **Summaries come only from free full text.** Paywalled papers get "No free full text" and use no tokens.
- **More lessons:** each unit in a track's lesson list has **+ Add 3 more advanced lessons**.
  - The model sees every lesson already in that unit and writes outlines for 3 that go deeper. They're saved in `data/learn/extras.json` and appear at the end of the unit, marked "added".
  - Each one is then written like any other lesson: on demand, or by the daily run when you reach it.
  - These runs are queued one at a time.

## Run it locally

```sh
node scripts/fetch-papers.mjs --dry-run          # show today's pick without saving
node scripts/fetch-papers.mjs --date 2026-10-15  # pick for a past day
node scripts/watch.mjs --dry-run                 # what the watch rules would find
node scripts/learn.mjs --dry-run                 # which lessons would be written next
```

The web app (`index.html`, `app.js`, `style.css`) has no build step and no external requests. Saved papers stay in your browser.

**Listen** reads either the **AI summary** or the **abstract** aloud with your device's built-in voice. It's free and works offline, and nothing runs unless you tap it. An AI voice would need the API key inside this public web page, where anyone could take it.
