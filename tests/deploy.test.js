import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Pages deployment runs tests before publishing", async () => {
  const workflow = await readFile(new URL("../.github/workflows/pages.yml", import.meta.url), "utf8");
  assert.match(workflow, /- run: npm test/);
  assert.match(workflow, /deploy:\s*\n\s+needs: test/);
  assert.equal(workflow.split("uses: actions/deploy-pages@v4").length - 1, 1);
  assert.match(workflow, /uses: actions\/upload-pages-artifact@v4/);
});

test("Pages stages only the ONNX Runtime variants required by old cached workers", async () => {
  const workflow = await readFile(new URL("../.github/workflows/pages.yml", import.meta.url), "utf8");
  assert.ok(workflow.includes(String.raw`grep -E '^package/dist/ort-wasm-simd-threaded(\.jsep)?\.(wasm|mjs)
  for (const name of [
    "ort-wasm-simd-threaded.jsep.wasm",
    "ort-wasm-simd-threaded.jsep.mjs",
    "ort-wasm-simd-threaded.wasm",
    "ort-wasm-simd-threaded.mjs"
  ]) {
    assert.match(workflow, new RegExp("test -s vendor/onnxruntime/" + name.replaceAll(".", "\\.")));
  }
  assert.doesNotMatch(workflow, /asyncify|jspi/);
});
`));
  for (const name of [
    "ort-wasm-simd-threaded.jsep.wasm",
    "ort-wasm-simd-threaded.jsep.mjs",
    "ort-wasm-simd-threaded.wasm",
    "ort-wasm-simd-threaded.mjs"
  ]) {
    assert.match(workflow, new RegExp("test -s vendor/onnxruntime/" + name.replaceAll(".", "\\.")));
  }
  assert.doesNotMatch(workflow, /asyncify|jspi/);
});
