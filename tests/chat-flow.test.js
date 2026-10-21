import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
test("chat request counter is declared before it is incremented", () => {
  assert.match(source, /\brequestCounter\s*=\s*0\b/, "requestCounter must be initialized; otherwise send() throws before finally can clear the loading indicator");
});
test("assistant response always clears pending state in finally", () => {
  assert.match(source, /finally\s*\{[\s\S]{0,400}typing\.classList\.add\("hidden"\)/);
});