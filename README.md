# LEDERG NEIRO 0.3

LEDERG NEIRO is a browser-based AI experiment published using GitHub Pages. The user interface is intentionally a chat only.

## What works in this version

- **172+ curated knowledge cards** in Russian covering AI/ML, JavaScript/TypeScript, web development, GitHub, security, networking, computers, mathematics, physics, biology, geography, history, learning, and general concepts.
- **Multi-card retrieval:** finds a relevant answer, may add a closely related card, and shows direct source links.
- **Moscow date and time** using the IANA time zone `Europe/Moscow` (the displayed value depends on the device clock).
- **Safe arithmetic calculator** and **unit conversion**, processed locally without evaluating user-supplied JavaScript.
- **Live weather** through Open-Meteo, with a public source link.
- **Live Wikipedia search** through the MediaWiki API, plus direct links to general search engines when broader results are needed.
- **Optional concise explanation mode** which describes the answer method and limitations instead of exposing a private internal chain of thought.
- **Chat-only UI:** no developer training lab, feature panels, or settings screen. Chat history remains in local browser storage.

## How the answer flow works

1. Recognize dedicated tool requests (time, arithmetic, unit conversion, weather, web search).
2. Search the curated knowledge base and rank matching entries.
3. If the query is unclear, return a limited capability response rather than inventing a factual answer.
4. Show links to supporting sources when available.

## Architecture

- `index.html` — one chat interface.
- `styles.css` — responsive black-and-red LEDERG UI.
- `app.js` — request lifecycle, timeout fallback, tool routing, knowledge retrieval, citation display, local chat history.
- `model.js` — handwritten MLP intent classifier (tanh hidden layer, softmax output, backpropagation).
- `knowledge.js` — curated cards with category, title, keywords, answer, and source URL.
- `tools.js` — time-zone handling, arithmetic, unit conversions, Wikipedia search, weather retrieval.
- `tests/` — regression tests for the classifier, search tools, database retrieval, and UI flow.
- `.github/workflows/pages.yml` — tests before GitHub Pages deployment.

## Important limitations

This project is **not yet a full generative LLM**. The MLP classifies intents; the curated knowledge base retrieves known answers; separate utilities perform deterministic calculations; Wikipedia and Open-Meteo provide live external data. The general search links open search engines in a new tab — the page does not claim to read every page in the full web index.

A real LLM-like system needs a pretrained or trained generative language model with learned token-generation weights. Increasing a FAQ database alone cannot give a classifier the broad reasoning or free-form generation of such a model. Browser-only inference may be possible with a compact quantized model and compatible WebGPU, but model size, device performance, and download cost need to be evaluated before adding it.

Requests to search and weather services go to those external services. Do not send passwords, API keys, or private data to them. Chat history is stored only in localStorage in the current browser and does not sync across devices.

## Local tests

Requires Node.js 20+. No dependencies need to be installed:

```bash
npm test
```

For a local preview, run a static server from the repository root, e.g. `python -m http.server 8080`, then open `http://localhost:8080`. Do not open `index.html` via `file://`, because browsers may restrict JavaScript modules and cross-origin requests.

## Deployment

The GitHub Actions workflow runs `npm test` on pushes to `main`. If the tests pass, it deploys the static files using GitHub Pages.
