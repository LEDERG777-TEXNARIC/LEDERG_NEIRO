import test from "node:test";
import assert from "node:assert/strict";
import { SYSTEM_PROMPT, MODEL_ID, MODEL_SIZE_HINT, detectReplyLanguage, buildChatMessages, extractAssistantText, createLanguageModelClient } from "../llm.js";

test("model size hint matches the q4 weight variant", () => {
  assert.match(MODEL_SIZE_HINT, /800/);
});

test("system prompt sets identity, accuracy, web honesty and privacy boundaries", () => {
  assert.match(SYSTEM_PROMPT, /LEDERG NEIRO/);
  assert.match(SYSTEM_PROMPT, /Never fabricate facts/i);
  assert.match(SYSTEM_PROMPT, /Do not reveal private chain-of-thought/i);
  assert.match(SYSTEM_PROMPT, /untrusted data/i);
});
test("chat messages include system prompt, bounded history and retrieved context", () => {
  const list = buildChatMessages({
    history: [{role:"user",content:"привет"},{role:"assistant",content:"здравствуйте"}],
    query: "объясни attention",
    knowledgeContext: "Attention позволяет сопоставлять элементы последовательности.",
    webContext: "Статья: attention в трансформерах."
  });
  assert.equal(list[0].role, "system");
  assert.match(list[0].content, /LEDERG NEIRO/);
  assert.match(list[0].content, /MANDATORY RESPONSE LANGUAGE: Russian/);
  assert.equal(list[1].content, "привет");
  assert.match(list.at(-1).content, /attention/);
  assert.match(list.at(-1).content, /LIVE SEARCH RESULTS/);
});
test("generated response parser supports chat and plain text formats", () => {
  assert.equal(extractAssistantText([{generated_text:[{role:"user",content:"привет"},{role:"assistant",content:"Здравствуйте!"}]}]), "Здравствуйте!");
  assert.equal(extractAssistantText([{generated_text:"Прямой ответ"}]), "Прямой ответ");
});
test("client loads a pinned public model and can generate through an injected test pipeline", async () => {
  let config;
  const client=createLanguageModelClient({
    modelId: "test/public-model",
    getDevice:()=> "webgpu",
    pipelineFactory:async(task,model,options)=>{
      config={task,model,options};
      return async(messages,generationOptions)=>[{generated_text:[...messages,{role:"assistant",content:"Сгенерированный ответ"}]}];
    }
  });
  const result=await client.generate([{role:"user",content:"тест"}]);
  assert.equal(result,"Сгенерированный ответ");
  assert.equal(config.task,"text-generation");
  assert.equal(config.model,"test/public-model");
  assert.equal(config.options.device,"webgpu");
  assert.equal(config.options.dtype,"q4f16");
});

test("dedicated worker handles model requests without blocking the page", async () => {
  const progress = [];
  const worker = {
    onmessage: null,
    onerror: null,
    postMessage(message) {
      queueMicrotask(() => this.onmessage({ data: { type: "progress", id: message.id, message: "Загружаю модель…" } }));
      queueMicrotask(() => this.onmessage({ data: { type: "done", id: message.id, text: "Ответ из worker" } }));
    }
  };
  const client = createLanguageModelClient({ workerFactory: () => worker });
  const response = await client.generate([{ role: "user", content: "тест" }], { onProgress: (value) => progress.push(value) });
  assert.equal(response, "Ответ из worker");
  assert.ok(progress.includes("Загружаю модель…"));
});

test("worker pins the matching ONNX Runtime WASM CDN build", async () => {
  const { readFile } = await import("node:fs/promises");
  const worker = await readFile(new URL("../llm-worker.js", import.meta.url), "utf8");
  assert.match(worker, /env\.backends\.onnx\.wasm\.wasmPaths\s*=/);
  assert.match(worker, /onnxruntime-web@1\.22\.0-dev\.20250409-89f8206ba4\/dist\//);
  assert.doesNotMatch(worker, /vendor\/onnxruntime/);
});

test("inference tries WebGPU first when available and falls back to single-threaded WASM", async () => {
  const { readFile } = await import("node:fs/promises");
  const adapter = await readFile(new URL("../llm.js", import.meta.url), "utf8");
  const worker = await readFile(new URL("../llm-worker.js", import.meta.url), "utf8");
  assert.match(adapter, /const devices = hasGpu \? \["webgpu", "wasm"\]/);
  assert.match(worker, /const devices = hasGpu \? \["webgpu", "wasm"\]/);
  assert.match(adapter, /device === "webgpu" \? "q4f16" : "q4"/);
  assert.match(worker, /device === "webgpu" \? "q4f16" : "q4"/);
  assert.match(worker, /numThreads = 1/);
});

test("worker streams tokens and cache-busts updated worker code", async () => {
  const { readFile } = await import("node:fs/promises");
  const worker = await readFile(new URL("../llm-worker.js", import.meta.url), "utf8");
  const adapter = await readFile(new URL("../llm.js", import.meta.url), "utf8");
  assert.match(worker, /const dtype = "q4"/);
  assert.match(worker, /const devices = \["wasm"\]/);
  assert.doesNotMatch(worker, /const devices = hasGpu/);
  assert.doesNotMatch(worker, /q4f16/);
  assert.match(adapter, /llm-worker\.js\?build=/);
});


test("language detector follows common user languages instead of forcing Russian", () => {
  assert.equal(detectReplyLanguage("Hello, can you help me?").code, "en");
  assert.equal(detectReplyLanguage("Привет, помоги мне с проектом").code, "ru");
  assert.equal(detectReplyLanguage("Будь ласка, поясни це").code, "uk");
  assert.equal(detectReplyLanguage("Hallo, ich brauche Hilfe").code, "de");
  assert.equal(detectReplyLanguage("Hola, ¿puedes ayudarme?").code, "es");
  assert.equal(detectReplyLanguage("Bonjour, peux-tu m'aider ?").code, "fr");
  assert.equal(detectReplyLanguage("こんにちは").code, "ja");
  assert.equal(detectReplyLanguage("你好").code, "zh");
});

test("memory context is included as reference data and does not override language lock", () => {
  const list = buildChatMessages({ query: "How are you?", memoryContext: "USER MEMORY: Prefers concise answers." });
  assert.match(list[0].content, /MANDATORY RESPONSE LANGUAGE: English/);
  assert.match(list.at(-1).content, /USER MEMORY/);
  assert.match(list.at(-1).content, /Prefers concise answers/);
});

test("worker token messages reach onToken callback", async () => {
  const seen = [];
  const worker = {
    onmessage: null, onerror: null,
    postMessage(message) {
      queueMicrotask(() => this.onmessage({ data: { type: "token", id: message.id, text: "Live " } }));
      queueMicrotask(() => this.onmessage({ data: { type: "done", id: message.id, text: "Live answer" } }));
    }
  };
  const client = createLanguageModelClient({ workerFactory: () => worker });
  const result = await client.generate([{ role: "user", content: "test" }], { onToken: (text) => seen.push(text) });
  assert.equal(result, "Live answer");
  assert.deepEqual(seen, ["Live "]);
});
