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
  - Summaries are written **only from the open full text** (bioRxiv/medRxiv, arXiv HTML, or Europe PMC open access), never from the abstract alone.
  - Papers with free full text are preferred. If the curator's choice has none, the next-best paper that does is picked instead. A paper with no free full text shows no summary.
  - About 15K tokens per summary on the same flash model, so roughly 60–75K tokens a day in total.
  - **Backfill:** on the Actions tab, choose **Run workflow** and tick "backfill". This adds missing summaries to days that are already published. It runs on GitHub, never on your device.
- **Publish:** it writes `data/<date>.json` and `data/index.json`, commits them, and redeploys Pages. Papers are never repeated.

## Run it locally

```sh
node scripts/fetch-papers.mjs --dry-run          # show today's pick without saving
node scripts/fetch-papers.mjs --date 2026-10-15  # pick for a past day
```

The web app (`index.html`, `app.js`, `style.css`) has no build step and no external requests. Saved papers stay in your browser.

**Listen** reads either the **AI summary** or the **abstract** aloud with your device's built-in voice. It's free and works offline, and nothing runs unless you tap it. An AI voice would need the API key inside this public web page, where anyone could take it.
