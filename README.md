# Paper of the Day

One genuinely interesting paper every morning: AI for transcriptomics and multiomics, general AI with clear uses in biology, and landmark biotech (AlphaFold-level).

**Read it:** https://masmae.github.io/paperoftheday/. On iPhone, open it in Safari, then tap Share → Add to Home Screen.

## How it works

- **When:** every day at 13:00 UTC (6 AM Pacific), [`.github/workflows/daily.yml`](.github/workflows/daily.yml) runs on GitHub's machines.
- **Collect:** it gathers recent papers from **bioRxiv/medRxiv** (preprints), **arXiv** (ML and quantitative biology) and **PubMed** (top journals). All are free public APIs, and no keys are needed.
- **Score:** papers need an AI angle together with omics or biotech; landmark biotech counts even without AI. A top journal helps only if the paper has real AI content.
- **Pick:** the best-scoring paper wins.
- **Optional, the Claude curator:** add an `ANTHROPIC_API_KEY` repository secret (Settings → Secrets and variables → Actions). Claude then reads the top 25 candidates, picks the most interesting one and writes a short "why it matters". It uses `claude-opus-5-5`, roughly $0.05–0.10 a day.
- **Publish:** it writes `data/<date>.json` and `data/index.json`, commits them, and redeploys Pages. Papers are never repeated.

## Run it locally

```sh
node scripts/fetch-papers.mjs --dry-run          # show today's pick without saving
node scripts/fetch-papers.mjs --date 2026-10-15  # pick for a past day
```

The web app (`index.html`, `app.js`, `style.css`) has no build step and no external requests. Saved papers stay in your browser.
