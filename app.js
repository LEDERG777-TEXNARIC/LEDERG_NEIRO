import { searchKnowledgeMany } from "./knowledge.js";
import { calculateExpression, convertUnit, detectToolRequest, getMoscowTime, getWeather, searchWikipedia } from "./tools.js";
import { buildChatMessages, detectReplyLanguage, languageModel, MODEL_ID, MODEL_REPOSITORY } from "./llm.js";
import { CHAT_STORAGE_KEY, LEGACY_HISTORY_KEY, createChat, deleteChat, deriveChatTitle, loadChatStore, renameChat, saveChatStore, upsertChat } from "./chat-store.js";
import { addMemory, formatMemoryContext, loadMemory, parseRememberCommand, saveMemory as persistMemory } from "./memory.js";

const $ = (selector) => document.querySelector(selector);
const nodes = {
  chat: $("#chat"), welcome: $("#welcome"), form: $("#chat-form"),
  input: $("#message-input"), send: $("#send-button"), clock: $("#moscow-clock"),
  counter: $("#counter"), typing: $("#typing"), reset: $("#new-chat"),
  detail: $("#detail-mode"), status: $("#model-status"),
  quick: document.querySelectorAll("[data-prompt]"),
  toggleChats: $("#toggle-chats"), closeChats: $("#close-chats"),
  sidebar: $("#chat-sidebar"), sidebarBackdrop: $("#sidebar-backdrop"),
  addChat: $("#add-chat"), chatList: $("#chat-list"),
  memoryOpen: $("#memory-open"), memoryDialog: $("#memory-dialog"),
  memoryInput: $("#memory-input"), memorySave: $("#memory-save"),
  memoryClose: $("#memory-close"), memoryClear: $("#memory-clear"),
  memoryCount: $("#memory-count")
};
const STORAGE_KEY = LEGACY_HISTORY_KEY;
let chats = [];
let activeChatId = null;
let messages = [];
let requestCounter = 0;
let pending = false;
let detailedMode = false;
let streamingRow = null;
let streamingBody = null;
let streamedTokenCount = 0;

function formatNumber(value) { return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 8 }).format(value); }
function formatTime(timestamp = Date.now()) {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(timestamp));
}
function updateClock() {
  const now = new Date();
  const date = new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", weekday: "short", day: "numeric", month: "short" }).format(now);
  nodes.clock.textContent = "МСК " + formatTime(now) + " · " + date;
  nodes.clock.dateTime = now.toISOString();
}
function showProgress(text) {
  if (nodes.typing) nodes.typing.textContent = "LEDERG NEIRO · " + String(text || "Думаю…");
  if (nodes.status && /готова к генерации|генер(?:ирует|ирую) ответ|формирует ответ/i.test(text)) {
    nodes.status.textContent = "МОДЕЛЬ ГОТОВА";
    nodes.status.classList.add("ready");
  }
}
function setPending(value) {
  pending = Boolean(value);
  nodes.send.disabled = pending || !nodes.input.value.trim();
  nodes.typing.hidden = !pending;
  if (pending) showProgress("готовлю ответ…");
}
function applyChatState(nextChats, nextActiveChatId = activeChatId) {
  const state = saveChatStore(nextChats, nextActiveChatId);
  chats = state.chats;
  activeChatId = state.activeChatId;
  const active = chats.find((chat) => chat.id === activeChatId);
  messages = active ? active.messages : [];
  renderChatList();
}

function saveHistory() {
  if (!activeChatId || !chats.some((chat) => chat.id === activeChatId)) {
    const created = createChat();
    chats = upsertChat(chats, created);
    activeChatId = created.id;
  }
  const active = chats.find((chat) => chat.id === activeChatId);
  const firstUser = messages.find((item) => item.role === "user");
  const title = active?.title === "Новый чат" && firstUser ? deriveChatTitle(firstUser.content) : (active?.title || "Новый чат");
  const updated = { ...(active || createChat()), title, messages: messages.slice(-80), updatedAt: Date.now() };
  const next = upsertChat(chats, updated);
  const state = saveChatStore(next, activeChatId);
  chats = state.chats;
  activeChatId = state.activeChatId;
  messages = chats.find((chat) => chat.id === activeChatId)?.messages || [];
  renderChatList();
}

function loadHistory() {
  const stored = loadChatStore();
  if (stored?.chats?.length) {
    chats = stored.chats;
    activeChatId = stored.activeChatId || chats[0].id;
    messages = chats.find((chat) => chat.id === activeChatId)?.messages || [];
    renderChatList();
    return;
  }

  let legacyMessages = [];
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    if (Array.isArray(saved)) {
      legacyMessages = saved.filter((item) => item && ["user", "assistant"].includes(item.role) && typeof item.content === "string").slice(-80);
    }
  } catch { legacyMessages = []; }

  const firstUser = legacyMessages.find((item) => item.role === "user");
  const migrated = createChat({
    title: firstUser ? deriveChatTitle(firstUser.content) : "Новый чат",
    messages: legacyMessages
  });
  chats = [migrated];
  activeChatId = migrated.id;
  messages = migrated.messages;
  saveChatStore(chats, activeChatId);
  renderChatList();
}


function addSources(parent, sources) {
  if (!Array.isArray(sources) || !sources.length) return;
  const wrap = document.createElement("div"); wrap.className = "sources";
  const heading = document.createElement("small"); heading.textContent = "ИСТОЧНИКИ"; wrap.append(heading);
  const used = new Set();
  for (const source of sources.slice(0, 8)) {
    try {
      const url = new URL(source.url);
      if (!["http:", "https:"].includes(url.protocol) || used.has(url.href)) continue;
      used.add(url.href);
      const link = document.createElement("a");
      link.href = url.href; link.target = "_blank"; link.rel = "noopener noreferrer";
      link.textContent = source.title || url.hostname; link.title = url.href;
      wrap.append(link);
    } catch { /* Ignore malformed URLs from external search results. */ }
  }
  if (wrap.childElementCount > 1) parent.append(wrap);
}
function renderMessage(message, index = -1) {
  const row = document.createElement("article");
  row.className = "message " + message.role;
  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = message.role === "assistant" ? "ϟ" : "ТЫ";
  const content = document.createElement("div"); content.className = "message-content";
  const head = document.createElement("div"); head.className = "message-head";
  const name = document.createElement("b"); name.textContent = message.role === "assistant" ? "LEDERG NEIRO" : "ТЫ";
  const time = document.createElement("time"); time.textContent = formatTime(message.timestamp);
  time.dateTime = new Date(message.timestamp || Date.now()).toISOString();
  head.append(name, time); content.append(head);
  const body = document.createElement("div"); body.className = "message-text"; body.textContent = String(message.content ?? ""); content.append(body);
  addSources(content, message.sources);

  const actions = document.createElement("div");
  actions.className = "message-actions";
  if (message.role === "user" && index >= 0) {
    const edit = document.createElement("button");
    edit.type = "button"; edit.className = "message-edit"; edit.textContent = "ИЗМЕНИТЬ";
    edit.setAttribute("aria-label", "Изменить сообщение и пересоздать ответ");
    edit.addEventListener("click", () => {
      const revised = window.prompt("Отредактируй запрос. Последующие сообщения будут удалены, ответ будет сгенерирован заново.", message.content);
      if (revised === null || !revised.trim()) return;
      ++requestCounter; pending = false;
      messages = messages.slice(0, index);
      saveHistory(); renderAll(); updateComposer();
      void sendMessage(revised.trim());
    });
    actions.append(edit);
  } else if (message.role === "assistant" && message.content) {
    const copy = document.createElement("button");
    copy.type = "button"; copy.className = "message-action"; copy.textContent = "КОПИРОВАТЬ";
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(message.content);
        copy.textContent = "СКОПИРОВАНО";
      } catch {
        copy.textContent = "СКОПИРУЙ ВРУЧНУЮ";
        copy.title = "Браузер не разрешил доступ к буферу обмена.";
      }
    });
    const download = document.createElement("button");
    download.type = "button"; download.className = "message-action"; download.textContent = "СОХРАНИТЬ ФАЙЛ";
    download.addEventListener("click", () => downloadAssistantMessage(message.content));
    actions.append(copy, download);
  }
  if (actions.childElementCount) content.append(actions);
  row.append(avatar, content); nodes.chat.append(row);
  return row;
}

function renderAll() {
  streamingRow = null; streamingBody = null; streamedTokenCount = 0;
  nodes.chat.replaceChildren();
  nodes.welcome.hidden = messages.length > 0;
  messages.forEach((message, index) => renderMessage(message, index));
  nodes.chat.scrollTop = nodes.chat.scrollHeight;
  renderChatList();
}


function renderChatList() {
  if (!nodes.chatList) return;
  nodes.chatList.replaceChildren();
  if (nodes.memoryCount) nodes.memoryCount.textContent = String(loadMemory().length);
  if (!chats.length) {
    const empty = document.createElement("p");
    empty.className = "chat-empty"; empty.textContent = "Сохранённых диалогов пока нет.";
    nodes.chatList.append(empty); return;
  }
  for (const chat of chats) {
    const row = document.createElement("div");
    row.className = "chat-row" + (chat.id === activeChatId ? " active" : "");
    row.setAttribute("role", "listitem");
    const select = document.createElement("button");
    select.type = "button"; select.className = "chat-select"; select.textContent = chat.title;
    select.title = chat.title; select.setAttribute("aria-current", chat.id === activeChatId ? "true" : "false");
    select.addEventListener("click", () => selectChat(chat.id));
    const rename = document.createElement("button");
    rename.type = "button"; rename.className = "chat-row-action"; rename.textContent = "✎";
    rename.title = "Переименовать диалог"; rename.setAttribute("aria-label", "Переименовать: " + chat.title);
    rename.addEventListener("click", () => renameChatUi(chat.id));
    const remove = document.createElement("button");
    remove.type = "button"; remove.className = "chat-row-action delete"; remove.textContent = "×";
    remove.title = "Удалить диалог"; remove.setAttribute("aria-label", "Удалить: " + chat.title);
    remove.addEventListener("click", () => deleteChatUi(chat.id));
    row.append(select, rename, remove); nodes.chatList.append(row);
  }
}

function openChatSidebar(open = true) {
  if (!nodes.sidebar || !nodes.sidebarBackdrop) return;
  nodes.sidebar.hidden = !open;
  nodes.sidebarBackdrop.hidden = !open;
  nodes.toggleChats?.setAttribute("aria-expanded", String(open));
  if (open) nodes.closeChats?.focus();
}

function selectChat(chatId) {
  if (!chats.some((chat) => chat.id === chatId)) return;
  ++requestCounter; pending = false;
  const selected = chats.find((chat) => chat.id === chatId);
  activeChatId = selected.id; messages = selected.messages;
  setPending(false); renderAll(); updateComposer(); openChatSidebar(false);
}

function renameChatUi(chatId) {
  const chat = chats.find((item) => item.id === chatId);
  if (!chat) return;
  const title = window.prompt("Новое название диалога:", chat.title);
  if (title === null || !title.trim()) return;
  applyChatState(renameChat(chats, chatId, title), activeChatId);
}

function deleteChatUi(chatId) {
  const chat = chats.find((item) => item.id === chatId);
  if (!chat) return;
  if (!window.confirm("Удалить диалог «" + chat.title + "»? Это действие нельзя отменить.")) return;
  ++requestCounter; pending = false;
  let remaining = deleteChat(chats, chatId);
  let nextActive = activeChatId;
  if (chatId === activeChatId) {
    nextActive = remaining[0]?.id || null;
  }
  if (!remaining.length) {
    const empty = createChat();
    remaining = [empty]; nextActive = empty.id;
  }
  applyChatState(remaining, nextActive);
  setPending(false); renderAll(); updateComposer();
}

function downloadAssistantMessage(content) {
  const raw = String(content ?? "");
  const fence = String.fromCharCode(96).repeat(3);
  const blockPattern = new RegExp(fence + "([a-zA-Z0-9_+#.-]*)\\s*\\r?\\n([\\s\\S]*?)" + fence, "gu");
  const blocks = [...raw.matchAll(blockPattern)];
  let data = raw;
  let extension = "md";
  let mime = "text/markdown;charset=utf-8";
  if (blocks.length === 1) {
    const language = (blocks[0][1] || "").toLowerCase();
    const extensions = { javascript: "js", js: "js", typescript: "ts", ts: "ts", python: "py", py: "py", html: "html", css: "css", json: "json", yaml: "yml", yml: "yml", sql: "sql", bash: "sh", shell: "sh", powershell: "ps1", ps1: "ps1", csharp: "cs", c: "c", cpp: "cpp", java: "java", rust: "rs", go: "go", xml: "xml", markdown: "md", md: "md" };
    extension = extensions[language] || "txt";
    data = blocks[0][2];
    mime = "text/plain;charset=utf-8";
  }
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "lederg-neiro-" + new Date().toISOString().slice(0, 10) + "." + extension;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function appendGeneratedToken(token) {
  const piece = String(token || "");
  if (!piece) return;
  if (!streamingBody) {
    streamingRow = document.createElement("article"); streamingRow.className = "message assistant is-streaming";
    const avatar = document.createElement("div"); avatar.className = "avatar"; avatar.textContent = "ϟ";
    const content = document.createElement("div"); content.className = "message-content";
    const head = document.createElement("div"); head.className = "message-head";
    const name = document.createElement("b"); name.textContent = "LEDERG NEIRO";
    const time = document.createElement("time"); time.textContent = formatTime(); time.dateTime = new Date().toISOString();
    head.append(name, time);
    streamingBody = document.createElement("div"); streamingBody.className = "message-text";
    streamingBody.setAttribute("aria-label", "Ответ LEDERG NEIRO в процессе генерации");
    content.append(head, streamingBody); streamingRow.append(avatar, content); nodes.chat.append(streamingRow);
  }
  streamingBody.textContent += piece;
  streamedTokenCount += 1;
  if (nodes.status) {
    nodes.status.textContent = "LIVE · " + streamedTokenCount;
    nodes.status.classList.add("ready");
  }
  nodes.chat.scrollTop = nodes.chat.scrollHeight;
}

function confirmMemoryText(code, saved) {
  const replies = {
    en: saved ? "Saved to LEDERG NEIRO's local memory. Open Memory to review, edit, or delete it." : "Memory is full or that note is already saved. Open Memory to manage saved notes.",
    ru: saved ? "Сохранила заметку в локальную память LEDERG NEIRO. Открой «Память», чтобы посмотреть, изменить или удалить её." : "Заметка уже сохранена или память заполнена. Открой «Память», чтобы управлять заметками.",
    uk: saved ? "Зберегла нотатку в локальній пам’яті LEDERG NEIRO. Відкрий «Пам’ять», щоб переглянути, змінити або видалити її." : "Нотатку вже збережено або пам’ять заповнена. Відкрий «Пам’ять», щоб керувати нотатками.",
    de: saved ? "In der lokalen LEDERG-NEIRO-Erinnerung gespeichert. Öffne „Gedächtnis“, um den Eintrag zu bearbeiten oder zu löschen." : "Der Eintrag ist bereits gespeichert oder der Speicher ist voll.",
    es: saved ? "Guardado en la memoria local de LEDERG NEIRO. Abre «Memoria» para revisarlo, editarlo o eliminarlo." : "La nota ya existe o la memoria está llena.",
    fr: saved ? "Enregistré dans la mémoire locale de LEDERG NEIRO. Ouvre « Mémoire » pour modifier ou supprimer cette note." : "Cette note existe déjà ou la mémoire est pleine."
  };
  return replies[code] || replies.en;
}

function openMemoryDialog() {
  if (!nodes.memoryDialog || !nodes.memoryInput) return;
  nodes.memoryInput.value = loadMemory().join("\n");
  if (typeof nodes.memoryDialog.showModal === "function") nodes.memoryDialog.showModal();
  else nodes.memoryDialog.setAttribute("open", "");
  nodes.memoryInput.focus();
}

function closeMemoryDialog() {
  if (!nodes.memoryDialog) return;
  if (typeof nodes.memoryDialog.close === "function") nodes.memoryDialog.close();
  else nodes.memoryDialog.removeAttribute("open");
}


function webSearchLinks(query) {
  const encoded = encodeURIComponent(query);
  return [
    { title: "DuckDuckGo — поиск в интернете", url: "https://duckduckgo.com/?q=" + encoded },
    { title: "Google — поиск в интернете", url: "https://www.google.com/search?q=" + encoded },
    { title: "Wikipedia — поиск", url: "https://ru.wikipedia.org/w/index.php?search=" + encoded }
  ];
}
async function searchWeb(query) {
  const q = String(query || "").trim().slice(0, 180);
  if (q.length < 2) return { content: "Уточни запрос для поиска.", sources: [], mode: "web" };
  try {
    let results = await searchWikipedia(q, { lang: "ru", limit: 5 });
    if (!results.length) results = await searchWikipedia(q, { lang: "en", limit: 5 });
    const sources = results.map((item) => ({ title: item.title + " · Wikipedia", url: item.url })).concat(webSearchLinks(q));
    if (!results.length) return {
      content: "В Wikipedia не нашлось подходящих страниц по запросу «" + q + "». Прямые ссылки на поисковики доступны ниже; эти страницы ещё не были прочитаны системой.",
      sources, mode: "web"
    };
    const summary = results.map((item, index) => (index + 1) + ". " + item.title + "\n" + (item.snippet || "Открой статью для подробностей.") + "\nИсточник: " + item.url).join("\n\n");
    return { content: "Живая выдача Wikipedia по запросу «" + q + "»:\n\n" + summary, sources, mode: "web" };
  } catch (error) {
    return { content: "Не удалось получить выдачу Wikipedia: " + (error?.message || "сервис недоступен") + ". Прямые ссылки на веб-поиск доступны ниже.", sources: webSearchLinks(q), mode: "web" };
  }
}
function localTimeAnswer() {
  const result = getMoscowTime();
  return {
    content: "Сейчас в Москве " + result.time + " (МСК).\nДата: " + result.date + ".\nЧасовой пояс: Europe/Moscow, UTC+3.\n\nВремя рассчитано из системных часов устройства с преобразованием в московский часовой пояс.",
    sources: [{ title: "IANA — база часовых поясов", url: "https://www.iana.org/time-zones" }], mode: "time"
  };
}
async function runTool(tool) {
  switch (tool.type) {
    case "time": return localTimeAnswer();
    case "calculate":
      try { return { content: tool.expression + " = " + formatNumber(calculateExpression(tool.expression)), mode: "calculation" }; }
      catch (error) { return { content: "Не получилось вычислить выражение: " + error.message + "\nПример запроса: «посчитай (128 + 64) / 4».", mode: "calculation" }; }
    case "convert":
      try {
        const result = convertUnit(tool.value, tool.from, tool.to);
        return { content: formatNumber(tool.value) + " " + tool.from + " = " + formatNumber(result.value) + " " + result.unit, mode: "conversion" };
      } catch (error) { return { content: "Не получилось конвертировать единицы: " + error.message, mode: "conversion" }; }
    case "weather":
      try {
        const w = await getWeather(tool.query);
        return {
          content: "Погода сейчас: " + w.city + "\n" + w.condition + ".\nТемпература: " + formatNumber(w.temperature) + " °C; ощущается как " + formatNumber(w.feelsLike) + " °C.\nВлажность: " + formatNumber(w.humidity) + "%. Ветер: " + formatNumber(w.wind) + " км/ч.\nВремя данных: " + w.time + " (" + w.timezone + ").",
          sources: [{ title: "Open-Meteo — источник погоды", url: w.source }], mode: "weather"
        };
      } catch (error) {
        return { content: "Не удалось получить погоду: " + error.message + "\nПроверь название города или попробуй чуть позже.", sources: [{ title: "Open-Meteo", url: "https://open-meteo.com/" }], mode: "weather" };
      }
    case "search": return searchWeb(tool.query);
    default: return null;
  }
}
function directWebIntent(text) {
  if (detectToolRequest(text)) return null;
  const t = text.toLocaleLowerCase("ru-RU");
  const fresh = /(?:сегодня|сейчас|последн(?:ие|их|яя)|свеж(?:ие|ая)|новост(?:и|ей)|актуальн(?:ая|ые)|что произошло|кто сейчас|последние события)/iu.test(t);
  const asksForSearch = /(?:найди|поищи|погугли|ищи в интернете|сделай поиск|найди источники|ссылки на источники)/iu.test(t);
  if (fresh || asksForSearch) return { type: "search", query: text };
  return null;
}
function knowledgeContext(matches) {
  return matches.map((item, index) => (index + 1) + ". " + item.title + "\n" + item.answer + "\nИсточник: " + item.source.url).join("\n\n");
}
function applyDetailedMode(answer) {
  if (!detailedMode || !answer) return answer;
  let note;
  switch (answer.mode) {
    case "knowledge":
      note = "Я проверила несколько наиболее близких карточек локальной базы знаний и передала релевантный контекст языковой модели. Ссылки на исходные материалы приложены.";
      break;
    case "web":
      note = "Я передала языковой модели результаты живой выдачи Wikipedia как контекст. Это не полный индекс всего интернета; ссылки на найденные результаты и поисковики приложены.";
      break;
    case "weather":
      note = "Погода получена от Open-Meteo по координатам найденного города. Указанное время относится к ответу погодного сервиса.";
      break;
    case "time":
      note = "Использованы системные часы устройства с преобразованием в IANA-зону Europe/Moscow.";
      break;
    case "calculation":
      note = "Выражение вычислено локальным арифметическим парсером, без выполнения кода из сообщения.";
      break;
    case "conversion":
      note = "Значение преобразовано локально с помощью коэффициентов соответствующих единиц измерения.";
      break;
    default:
      note = "Ответ сформирован локальной языковой моделью. Контекст из базы знаний или найденные материалы могут помочь, но не гарантируют безошибочность ответа.";
  }
  return { ...answer, content: answer.content + "\n\nКРАТКИЙ РАЗБОР\n" + note };
}
async function generateModelAnswer(query, { matches = [], webResult = null } = {}) {
  const sources = [
    ...(matches || []).slice(0, 3).map((item) => item.source),
    ...(webResult?.sources || [])
  ];
  const context = knowledgeContext(matches || []);
  const history = messages.slice(0, -1).slice(-8);
  const promptMessages = buildChatMessages({
    history,
    query,
    knowledgeContext: context,
    webContext: webResult?.content || ""
  });
  try {
    const content = await languageModel.generate(promptMessages, {
      onProgress: showProgress,
      maxNewTokens: 280,
      temperature: 0.68
    });
    return { content, sources, mode: webResult ? "web" : matches.length ? "knowledge" : "llm" };
  } catch (error) {
    const reason = String(error?.message || error || "неизвестная ошибка").slice(0, 260);
    if (matches.length) {
      return {
        content: "Не получилось запустить языковую модель в этом браузере. Показываю найденный справочный ответ как резервный вариант.\n\n" +
          matches[0].answer + "\n\nДля запуска LLM нужен первый скачанный пакет весов примерно 500 МБ и совместимый браузер/GPU.\nТехническая причина: " + reason,
        sources, mode: "knowledge"
      };
    }
    return {
      content: "Не удалось запустить локальную языковую модель. При первом запуске браузер должен загрузить веса примерно на 500 МБ с Hugging Face; требуется подключение к интернету. Проверь поддержку WebGPU, свободную память и попробуй перезагрузить страницу.\n\nОшибка: " + reason,
      sources: [{ title: "Модель Qwen2.5-0.5B-Instruct", url: MODEL_REPOSITORY }], mode: "llm"
    };
  }
}
async function getAnswer(query) {
  const tool = detectToolRequest(query) || directWebIntent(query);
  if (tool?.type === "search") {
    showProgress("ищу в открытой выдаче и подготавливаю контекст…");
    const result = await searchWeb(tool.query);
    return generateModelAnswer(query, { webResult: result });
  }
  if (tool) return runTool(tool);
  const matches = searchKnowledgeMany(query, 3);
  return generateModelAnswer(query, { matches });
}
async function sendMessage(raw) {
  const query = String(raw || "").trim();
  if (!query || pending) return;
  nodes.input.value = ""; updateComposer();
  nodes.welcome.hidden = true;
  messages.push({ role: "user", content: query, timestamp: Date.now() });
  messages = messages.slice(-80); renderAll(); saveHistory();
  const currentRequest = ++requestCounter;
  setPending(true);
  try {
    const answer = applyDetailedMode(await getAnswer(query));
    if (currentRequest !== requestCounter) return;
    messages.push({ role: "assistant", content: answer?.content || "Модель не вернула ответ.", timestamp: Date.now(), sources: answer?.sources || [] });
  } catch (error) {
    if (currentRequest === requestCounter) {
      messages.push({ role: "assistant", content: "Не удалось обработать запрос: " + (error?.message || "неизвестная ошибка") + ". Попробуй ещё раз.", timestamp: Date.now(), sources: [] });
    }
  } finally {
    if (currentRequest === requestCounter) {
      setPending(false); renderAll(); saveHistory(); updateComposer(); nodes.input.focus();
    }
  }
}
function newConversation() {
  ++requestCounter;
  pending = false; messages = [];
  nodes.input.value = ""; setPending(false); updateComposer(); renderAll();
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
  nodes.input.focus();
}
nodes.form.addEventListener("submit", (event) => { event.preventDefault(); void sendMessage(nodes.input.value); });
nodes.input.addEventListener("input", updateComposer);
nodes.input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); nodes.form.requestSubmit(); }
});
nodes.reset.addEventListener("click", newConversation);
nodes.detail.addEventListener("click", () => { detailedMode = !detailedMode; nodes.detail.setAttribute("aria-pressed", String(detailedMode)); nodes.detail.textContent = detailedMode ? "РАЗБОР: ВКЛ" : "РАЗБОР: ВЫКЛ"; });
nodes.quick.forEach((button) => button.addEventListener("click", () => { nodes.input.value = button.dataset.prompt || ""; updateComposer(); nodes.form.requestSubmit(); }));
loadHistory();
if (nodes.status) {
  nodes.status.textContent = "QWEN 0.5B · ЛОКАЛЬНО";
  nodes.status.title = "Открытая языковая модель загружается с Hugging Face и отвечает на устройстве";
}
renderAll(); updateComposer(); updateClock(); setInterval(updateClock, 1000);
