import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
const page = await readFile(new URL("../index.html", import.meta.url), "utf8");
test("chat request counter is initialized before use", () => {
  assert.match(source, /\brequestCounter\s*=\s*0\b/);
});
test("every response clears the pending indicator in finally", () => {
  assert.match(source, /finally\s*\{[\s\S]*?setPending\(false\)/);
});
test("developer training panel is not exposed on the user page", () => {
  assert.doesNotMatch(page, /id="lab"|trainform|Обучение модели/);
  assert.match(page, /id="chat-form"/);
});
test("chat supports time, knowledge retrieval, web search and weather", () => {
  assert.match(source, /getMoscowTime/);
  assert.match(source, /searchKnowledge/);
  assert.match(source, /searchWeb/);
  assert.match(source, /getWeather/);
});

test("chat exposes only a user-facing optional explanation control",()=>{assert.match(page,/id="detail-mode"/);assert.doesNotMatch(page,/id="lab"|trainform|Обучение модели/)});


test("local LLM generation uses a worker to keep the chat responsive", async () => {
  const worker = await readFile(new URL("../llm-worker.js", import.meta.url), "utf8");
  const llm = await readFile(new URL("../llm.js", import.meta.url), "utf8");
  assert.match(llm, /new Worker\(new URL\("\.\/llm-worker\.js", import\.meta\.url\)/);
  assert.match(worker, /self\.addEventListener\("message"/);
  assert.match(worker, /type: "done"/);
});
