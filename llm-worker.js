import { MODEL_ID, extractAssistantText, progressText } from "./llm.js";

let generator = null;
let TextStreamerClass = null;
let currentModelId = MODEL_ID;
let loadingPromise = null;

function progress(id, message) {
  self.postMessage({ type: "progress", id, message: String(message || "Обработка модели…") });
}

async function loadModel(id, requestedModelId = MODEL_ID) {
  if (generator && requestedModelId === currentModelId) return generator;
  if (loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    progress(id, "Подключаю Transformers.js…");
    const { pipeline, env, TextStreamer } = await import("https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1");
    TextStreamerClass = TextStreamer || null;
    if (env) {
      env.allowLocalModels = false;
      env.allowRemoteModels = true;
      // Pin the ONNX Runtime build required by Transformers.js 3.8.1.
      // Use the matching CDN directory rather than a Pages-relative dynamic import.
      env.backends.onnx.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0-dev.20250409-89f8206ba4/dist/";
      // Static Pages does not set COOP/COEP headers, so force the compatible
      // single-threaded WASM runtime instead of requiring SharedArrayBuffer.
      env.backends.onnx.wasm.numThreads = 1;
    }
    const hasGpu = typeof navigator !== "undefined" && Boolean(navigator.gpu);
    const devices = hasGpu ? ["webgpu", "wasm"] : ["wasm"];
    let lastError;
    for (const device of devices) {
      try {
        progress(id, device === "webgpu"
          ? "Пробую ускорение WebGPU на видеокарте…"
          : "Перехожу на совместимый CPU/WASM-режим…");
        const dtype = device === "webgpu" ? "q4f16" : "q4";
        const loaded = await pipeline("text-generation", requestedModelId, {
          device,
          dtype,
          progress_callback: (event) => progress(id, progressText(event))
        });
        generator = loaded;
        currentModelId = requestedModelId;
        self.postMessage({ type: "model-loaded", id, modelId: currentModelId });
        return generator;
      } catch (error) {
        lastError = error;
        if (device !== "webgpu") break;
        progress(id, "WebGPU не запустился. Перехожу на CPU/WASM без перезагрузки страницы…");
      }
    }
    throw lastError || new Error("Не удалось загрузить модель.");
  })().catch((error) => {
    loadingPromise = null;
    generator = null;
    throw error;
  }).finally(() => {
    if (generator) loadingPromise = null;
  });
  return loadingPromise;
}

self.addEventListener("message", async (event) => {
  const data = event.data || {};
  const { id, type } = data;
  if (!Number.isInteger(id)) return;
  try {
    const model = await loadModel(id, data.modelId || MODEL_ID);
    if (type === "load") {
      self.postMessage({ type: "ready", id, modelId: data.modelId || MODEL_ID });
      return;
    }
    if (type !== "generate") throw new Error("Неизвестная операция локальной модели.");
    progress(id, "Генерирую ответ на устройстве…");
    const options = { ...(data.options || { max_new_tokens: 256 }) };
    if (TextStreamerClass && model.tokenizer) {
      options.streamer = new TextStreamerClass(model.tokenizer, {
        skip_prompt: true,
        skip_special_tokens: true,
        callback_function: (piece) => {
          if (piece) self.postMessage({ type: "token", id, text: String(piece) });
        }
      });
    }
    const output = await model(data.messages || [], options);
    const text = extractAssistantText(output);
    if (!text) throw new Error("Модель не вернула текст. Попробуй сформулировать запрос иначе.");
    self.postMessage({ type: "done", id, text });
  } catch (error) {
    self.postMessage({ type: "error", id, message: String(error?.message || error || "Ошибка локальной модели.") });
  }
});
