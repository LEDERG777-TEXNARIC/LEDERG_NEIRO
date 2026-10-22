import test from "node:test";
import assert from "node:assert/strict";
import {
  CHAT_STORAGE_KEY, createChat, deriveChatTitle, loadChatStore, saveChatStore,
  upsertChat, renameChat, deleteChat, normalizeChat
} from "../chat-store.js";

function fakeStorage() {
  const items = new Map();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => items.set(key, String(value))
  };
}

test("chat titles are derived from the first user message and shortened safely", () => {
  assert.equal(deriveChatTitle("  Build   a chat   UI "), "Build a chat UI");
  assert.equal(deriveChatTitle("x".repeat(60)).length, 44);
  assert.equal(deriveChatTitle(""), "Новый чат");
});

test("chat store saves and restores the selected chat", () => {
  const storage = fakeStorage();
  const first = createChat({ id: "a", now: 100, messages: [{ role: "user", content: "Hello", timestamp: 100 }] });
  const second = createChat({ id: "b", now: 200 });
  const saved = saveChatStore([first, second], "a", storage);
  const loaded = loadChatStore(storage);
  assert.equal(storage.getItem(CHAT_STORAGE_KEY) !== null, true);
  assert.equal(loaded.activeChatId, "a");
  assert.equal(loaded.chats.length, 2);
  assert.equal(saved.chats.find((chat) => chat.id === "a").messages[0].content, "Hello");
});

test("chat CRUD helpers rename, update and delete without mutating input", () => {
  const chats = [createChat({ id: "a", now: 10 }), createChat({ id: "b", now: 20 })];
  const renamed = renameChat(chats, "a", "  Project   plan ", 30);
  assert.equal(renamed.find((chat) => chat.id === "a").title, "Project plan");
  assert.equal(chats.find((chat) => chat.id === "a").title, "Новый чат");
  assert.deepEqual(deleteChat(renamed, "b").map((chat) => chat.id), ["a"]);
  assert.deepEqual(upsertChat(renamed, createChat({ id: "a", title: "Updated", now: 40 })).map((chat) => chat.id), ["a", "b"]);
});

test("normalization rejects unsafe source URLs and malformed messages", () => {
  const chat = normalizeChat({
    id: "safe",
    messages: [
      { role: "system", content: "not a user message" },
      { role: "assistant", content: "Answer", sources: [
        { title: "unsafe", url: "javascript:alert(1)" },
        { title: "good", url: "https://example.com" }
      ]}
    ]
  });
  assert.equal(chat.messages.length, 1);
  assert.equal(chat.messages[0].sources.length, 1);
  assert.equal(chat.messages[0].sources[0].url, "https://example.com/");
});
