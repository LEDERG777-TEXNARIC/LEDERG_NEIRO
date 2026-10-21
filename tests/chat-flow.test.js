import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
const page = await readFile(new URL("../index.html", import.meta.url), "utf8");
test("chat request counter is initialized before use", () => {
  assert.match(source, /\brequestCounter\s*=\s*0\b/);
});
test("every response clears the pending indicator in finally", () => {
  assert.match(source, /finally\s*\{[\s\S]{0,500}setPending\(false\)/);
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
