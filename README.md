# LEDERG NEIRO

LEDERG NEIRO is a browser-local AI chat experiment published on GitHub Pages. The chat UI stays responsive by running inference in a dedicated Web Worker.

## Model and performance

- **Model:** [Qwen2.5-0.5B-Instruct, ONNX Community](https://huggingface.co/onnx-community/Qwen2.5-0.5B-Instruct).
- **Runtime:** Transformers.js 3.8.1, loaded from a pinned public CDN URL.
- **Backends:** try WebGPU when the browser exposes it; fall back to single-threaded WASM/CPU if GPU initialization fails.
- **Quantization:** `q4f16` for WebGPU and `q4` for WASM.
- **Streaming:** Transformers.js `TextStreamer` sends generated text fragments to the UI as they become available.
- **First run:** downloads model files from Hugging Face (roughly 800 MB in this build, depending on runtime and cached assets). Weights are cached by the browser where possible.
- **Device support:** WebGPU support depends on browser, driver, operating system and device; CPU fallback is more compatible but slower. Mobile devices with little free memory may still fail to load the model.

A stronger prompt improves instruction following, but it cannot turn a 0.5B-parameter model into a large server-side model. LEDERG NEIRO performs a compact internal quality check and provides a concise explanation when useful; it does not expose hidden chain-of-thought.

## Chat features

- Multiple browser-local chats: create, select, rename and delete conversations.
- Edit a prior user message and regenerate from that point; following messages in that conversation are discarded.
- Copy assistant answers and download code blocks as files where a language extension can be inferred.
- Responsive black-and-red UI for desktop and mobile.
- Moscow time, local arithmetic, unit conversion, and current weather from Open-Meteo.
- Curated retrieval from `knowledge.js`.
- Explicit personal memory: say **“запомни: …”** or **“remember that …”**, or open the Memory panel. Notes can be viewed, edited and cleared.
- Language lock: the newest user message is classified into a supported language, and that language is appended to the system instruction. Language identification is heuristic, especially for short or closely related languages.

## Internet search and sources

The application performs live searches using public Wikimedia/Wikipedia APIs with browser CORS support, then fetches article extracts as context for the model. It also displays Google and DuckDuckGo links. **The model does not read those search-engine pages just because their links are shown.** Full general-web search requires an authenticated search API or a server-side proxy; do not put private API keys in this public repository's JavaScript.

External search snippets and memory are treated as untrusted data rather than instructions. The assistant must not invent source contents, successful searches, or actions that were not performed.

## GitHub code generation

The assistant can generate code in chat and download an answer/code block as a local file. The repository link in the sidebar opens this project on GitHub. A static public GitHub Pages site does not have write permissions to a repository by default; direct commits or branch creation require a real sign-in/authorization flow or a protected server-side integration. **Never embed a personal access token or client secret in frontend code.**

## Storage and privacy

- Conversations and memory use `localStorage` in the current browser profile. They are not synced to another browser or device.
- Search queries are sent to Wikimedia; weather requests are sent to Open-Meteo.
- The model and prompts run on the device after model weights are downloaded, except requests explicitly routed to the public search and weather services.
- Do not store secrets or sensitive personal information in browser memory.

## Files

- `index.html`, `styles.css` — responsive chat UI, history drawer and memory dialog.
- `app.js` — chat orchestration, tool routing, live search, streaming and source display.
- `llm.js` — system prompt, language detector, context budgets and inference client.
- `llm-worker.js` — model loading, GPU fallback and streamed tokens.
- `chat-store.js`, `memory.js` — validated browser-local chat and memory stores.
- `knowledge.js`, `tools.js` — curated knowledge, Wikimedia search/extracts, weather, time, calculation and unit conversion.
- `tests/` — unit and regression coverage.
- `.github/workflows/pages.yml` — run tests, stage compatible ONNX runtime assets, then deploy the root directory to Pages.

## Tests and deployment

Requires Node.js 20+:

```bash
npm test
```

A push to `main` runs the tests, prepares the Pages artifact, and deploys it only after the test job succeeds. During troubleshooting, check the Actions result before assuming that the latest commit is live.
