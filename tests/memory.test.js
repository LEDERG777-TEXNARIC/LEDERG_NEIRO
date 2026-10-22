import test from "node:test";
import assert from "node:assert/strict";
import { MEMORY_STORAGE_KEY, addMemory, formatMemoryContext, loadMemory, normalizeMemory, parseRememberCommand, saveMemory } from "../memory.js";

function fakeStorage() {
  const items = new Map();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => items.set(key, String(value))
  };
}

test("memory normalizes, deduplicates, and bounds notes", () => {
  const notes = normalizeMemory(["  Prefers black UI ", "prefers black ui", "", "x".repeat(900)]);
  assert.equal(notes.length, 2);
  assert.equal(notes[0], "Prefers black UI");
  assert.equal(notes[1].length, 400);
});

test("memory survives reload using browser-local storage", () => {
  const storage = fakeStorage();
  saveMemory(["prefers concise answers"], storage);
  addMemory("works on Windows", storage);
  assert.equal(storage.getItem(MEMORY_STORAGE_KEY) !== null, true);
  assert.deepEqual(loadMemory(storage), ["prefers concise answers", "works on Windows"]);
});

test("only explicit remember commands create memory notes", () => {
  assert.equal(parseRememberCommand("запомни: предпочитаю чёрно-красный интерфейс"), "предпочитаю чёрно-красный интерфейс");
  assert.equal(parseRememberCommand("Remember that I use Windows"), "I use Windows");
  assert.equal(parseRememberCommand("Can you remember this?"), null);
});

test("memory context marks stored notes as data and handles empty memory", () => {
  assert.equal(formatMemoryContext([]), "");
  assert.match(formatMemoryContext(["Prefers dark mode"]), /USER MEMORY/);
  assert.match(formatMemoryContext(["Prefers dark mode"]), /Prefers dark mode/);
  assert.match(formatMemoryContext(["Prefers dark mode"]), /not instructions/);
});
