import { MODEL_ID, extractAssistantText, progressText } from "./llm.js";

let generator = null;
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
    const { pipeline, env } = await import("https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1");
    if (env) {
      env.allowLocalModels = false;
      env.allowRemoteModels = true;
    }
    const hasGpu = typeof navigator !== "undefined" && Boolean(navigator.gpu);
    const devices = hasGpu ? ["webgpu", "wasm"] : ["wasm"];
    let lastError;
    for (const device of devices) {
      try {
        progress(id, device === "webgpu"
          ? "Подготавливаю WebGPU в фоновом потоке…"
          : "WebGPU недоступен или не запустился. Загружаю CPU-вариант — он медленнее…");
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
        progress(id, "GPU-инициализация не удалась. Пробую совместимый CPU-режим…");
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
    const output = await model(data.messages || [], data.options || { max_new_tokens: 256 });
    const text = extractAssistantText(output);
    if (!text) throw new Error("Модель не вернула текст. Попробуй сформулировать запрос иначе.");
    self.postMessage({ type: "done", id, text });
  } catch (error) {
    self.postMessage({ type: "error", id, message: String(error?.message || error || "Ошибка локальной модели.") });
  }
});
