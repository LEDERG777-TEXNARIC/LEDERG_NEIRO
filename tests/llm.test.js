import test from "node:test";
import assert from "node:assert/strict";
import { SYSTEM_PROMPT, MODEL_ID, buildChatMessages, extractAssistantText, createLanguageModelClient } from "../llm.js";

test("system prompt sets identity, accuracy, web honesty and privacy boundaries", () => {
  assert.match(SYSTEM_PROMPT, /LEDERG NEIRO/);
  assert.match(SYSTEM_PROMPT, /Не выдумывай факты/);
  assert.match(SYSTEM_PROMPT, /не показывай скрытые внутренние рассуждения/i);
  assert.match(SYSTEM_PROMPT, /внешние данные/i);
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
  assert.equal(list[1].content, "привет");
  assert.match(list.at(-1).content, /attention/);
  assert.match(list.at(-1).content, /РЕЗУЛЬТАТЫ ПОИСКА/);
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
