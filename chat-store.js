export const CHAT_STORAGE_KEY = "lederg-neiro-chats-v1";
export const LEGACY_HISTORY_KEY = "lederg-neiro-chat-v3";
export const MAX_CHATS = 50;
export const MAX_MESSAGES_PER_CHAT = 80;

function defaultStorage() {
  try { return typeof localStorage === "undefined" ? null : localStorage; }
  catch { return null; }
}

function makeId() {
  try {
    if (globalThis.crypto?.randomUUID) return "chat-" + globalThis.crypto.randomUUID();
  } catch { /* Some embedded browsers restrict crypto access. */ }
  return "chat-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

export function deriveChatTitle(text, maxLength = 44) {
  const compact = String(text ?? "").replace(/\s+/gu, " ").trim();
  if (!compact) return "Новый чат";
  return compact.length > maxLength ? compact.slice(0, maxLength - 1).trimEnd() + "…" : compact;
}

export function createChat({ id = makeId(), title = "Новый чат", now = Date.now(), messages = [] } = {}) {
  return normalizeChat({ id, title, createdAt: now, updatedAt: now, messages });
}

export function normalizeMessage(message) {
  if (!message || !["user", "assistant"].includes(message.role) || typeof message.content !== "string") return null;
  const timestamp = Number(message.timestamp);
  const sources = Array.isArray(message.sources) ? message.sources.slice(0, 8).map((source) => {
    if (!source || typeof source.url !== "string") return null;
    try {
      const url = new URL(source.url);
      if (!["https:", "http:"].includes(url.protocol)) return null;
      return { title: String(source.title || url.hostname).slice(0, 160), url: url.href };
    } catch { return null; }
  }).filter(Boolean) : [];
  return {
    role: message.role,
    content: message.content.slice(0, 12000),
    timestamp: Number.isFinite(timestamp) && timestamp > 0 ? timestamp : Date.now(),
    sources
  };
}

export function normalizeChat(chat) {
  if (!chat || typeof chat !== "object" || typeof chat.id !== "string" || !chat.id.trim()) return null;
  const createdAt = Number(chat.createdAt);
  const updatedAt = Number(chat.updatedAt);
  const messages = Array.isArray(chat.messages) ? chat.messages.map(normalizeMessage).filter(Boolean).slice(-MAX_MESSAGES_PER_CHAT) : [];
  const firstUser = messages.find((item) => item.role === "user");
  const title = String(chat.title || (firstUser ? deriveChatTitle(firstUser.content) : "Новый чат")).trim().slice(0, 80) || "Новый чат";
  return {
    id: chat.id.slice(0, 120),
    title,
    createdAt: Number.isFinite(createdAt) && createdAt > 0 ? createdAt : Date.now(),
    updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : Date.now(),
    messages
  };
}

export function normalizeChats(chats) {
  if (!Array.isArray(chats)) return [];
  const seen = new Set();
  return chats
    .map(normalizeChat)
    .filter((chat) => {
      if (!chat || seen.has(chat.id)) return false;
      seen.add(chat.id);
      return true;
    })
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_CHATS);
}

export function loadChatStore(storage = defaultStorage()) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(CHAT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.chats)) return null;
    const chats = normalizeChats(parsed.chats);
    const activeChatId = chats.some((chat) => chat.id === parsed.activeChatId) ? parsed.activeChatId : chats[0]?.id ?? null;
    return { chats, activeChatId };
  } catch {
    return null;
  }
}

export function saveChatStore(chats, activeChatId = null, storage = defaultStorage()) {
  const normalized = normalizeChats(chats);
  const active = normalized.some((chat) => chat.id === activeChatId) ? activeChatId : normalized[0]?.id ?? null;
  if (storage) {
    try { storage.setItem(CHAT_STORAGE_KEY, JSON.stringify({ chats: normalized, activeChatId: active })); }
    catch { /* Storage can be full or unavailable; keep the live session usable. */ }
  }
  return { chats: normalized, activeChatId: active };
}

export function upsertChat(chats, chat) {
  const normalized = normalizeChat(chat);
  if (!normalized) return normalizeChats(chats);
  return normalizeChats([normalized, ...(Array.isArray(chats) ? chats.filter((item) => item?.id !== normalized.id) : [])]);
}

export function renameChat(chats, chatId, title, now = Date.now()) {
  const cleaned = String(title ?? "").replace(/\s+/gu, " ").trim().slice(0, 80);
  if (!cleaned) return normalizeChats(chats);
  return normalizeChats((Array.isArray(chats) ? chats : []).map((chat) =>
    chat?.id === chatId ? { ...chat, title: cleaned, updatedAt: now } : chat
  ));
}

export function deleteChat(chats, chatId) {
  return normalizeChats((Array.isArray(chats) ? chats : []).filter((chat) => chat?.id !== chatId));
}
