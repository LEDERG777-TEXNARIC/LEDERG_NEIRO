import { trainModel, predictIntent } from "./model.js";
import { KNOWLEDGE_BASE, searchKnowledgeMany } from "./knowledge.js";
import { calculateExpression, convertUnit, detectToolRequest, getMoscowTime, getWeather, searchWikipedia } from "./tools.js";

const $ = (selector) => document.querySelector(selector);
const nodes = {
  chat: $("#chat"), welcome: $("#welcome"), form: $("#chat-form"),
  input: $("#message-input"), send: $("#send-button"), clock: $("#moscow-clock"),
  counter: $("#counter"), typing: $("#typing"), reset: $("#new-chat"), detail: $("#detail-mode"),
  quick: document.querySelectorAll("[data-prompt]")
};
const STORAGE_KEY = "lederg-neiro-chat-v2";
let messages = [];
let requestCounter = 0;
let pending = false;
let trainedModel = null;
let detailedMode = false;
let toastTimer = null;

function escapeText(value) { return String(value ?? ""); }
function formatNumber(value) { return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 8 }).format(value); }
function formatTime(timestamp = Date.now()) {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(timestamp));
}
function updateClock() {
  if (!nodes.clock) return;
  const now = new Date();
  const date = new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", weekday: "short", day: "numeric", month: "short" }).format(now);
  nodes.clock.textContent = "МСК " + formatTime(now) + " · " + date;
  nodes.clock.dateTime = now.toISOString();
}
function setPending(value) {
  pending = Boolean(value);
  nodes.send.disabled = pending || !nodes.input.value.trim();
  nodes.typing.hidden = !pending;
  if (pending) nodes.typing.textContent = "LEDERG NEIRO · анализирую запрос и проверяю источники…";
}
function saveHistory() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-80))); } catch { /* Storage may be unavailable in private mode. */ }
}
function loadHistory() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    if (Array.isArray(saved)) messages = saved.filter((item) => item && ["user", "assistant"].includes(item.role) && typeof item.content === "string").slice(-80);
  } catch { messages = []; }
}
function addSources(parent, sources) {
  if (!Array.isArray(sources) || !sources.length) return;
  const wrap = document.createElement("div"); wrap.className = "sources";
  const heading = document.createElement("small"); heading.textContent = "ИСТОЧНИКИ"; wrap.append(heading);
  for (const source of sources.slice(0, 8)) {
    try {
      const url = new URL(source.url);
      if (!["http:", "https:"].includes(url.protocol)) continue;
      const link = document.createElement("a");
      link.href = url.href; link.target = "_blank"; link.rel = "noopener noreferrer";
      link.textContent = source.title || url.hostname; wrap.append(link);
    } catch { /* Ignore malformed URLs from external search results. */ }
  }
  if (wrap.childElementCount > 1) parent.append(wrap);
}
function renderMessage(message) {
  const row = document.createElement("article"); row.className = "message " + message.role;
  const avatar = document.createElement("div"); avatar.className = "avatar"; avatar.textContent = message.role === "assistant" ? "ϟ" : "ТЫ";
  const content = document.createElement("div"); content.className = "message-content";
  const head = document.createElement("div"); head.className = "message-head";
  const name = document.createElement("b"); name.textContent = message.role === "assistant" ? "LEDERG NEIRO" : "ТЫ";
  const time = document.createElement("time"); time.textContent = formatTime(message.timestamp); time.dateTime = new Date(message.timestamp || Date.now()).toISOString();
  head.append(name, time); content.append(head);
  const body = document.createElement("div"); body.className = "message-text"; body.textContent = escapeText(message.content); content.append(body);
  addSources(content, message.sources);
  row.append(avatar, content); nodes.chat.append(row);
}
function renderAll() {
  nodes.chat.replaceChildren();
  nodes.welcome.hidden = messages.length > 0;
  for (const message of messages) renderMessage(message);
  nodes.chat.scrollTop = nodes.chat.scrollHeight;
}
function updateComposer() {
  nodes.counter.textContent = nodes.input.value.length + " / 2000";
  nodes.input.style.height = "auto";
  nodes.input.style.height = Math.min(nodes.input.scrollHeight, 160) + "px";
  nodes.send.disabled = pending || !nodes.input.value.trim();
}
function stableVariant(query) {
  let hash = 0;
  for (const char of query.toLocaleLowerCase("ru-RU")) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return Math.abs(hash) % 3;
}
function knowledgeAnswer(query) {
  const matches = searchKnowledgeMany(query, 3);
  if (!matches.length) return null;
  const primary = matches[0];
  const openings = ["", "Коротко: ", "Главное: "];
  let content = openings[stableVariant(query)] + primary.answer;
  const related = matches.slice(1).filter((item) => item.title !== primary.title && item.score >= Math.max(0.46, primary.score * 0.76)).slice(0, 1);
  for (const item of related) content += "\n\nСвязанная тема — " + item.title + ":\n" + item.answer;
  return {
    content,
    sources: matches.filter((item) => item.score >= Math.max(0.44, primary.score * 0.72)).slice(0, 3).map((item) => item.source),
    mode: "knowledge",
    knowledgeTitle: primary.title,
    relatedTitles: related.map((item) => item.title)
  };
}
function applyDetailedMode(query, answer) {
  if (!detailedMode || !answer) return answer;
  let note;
  switch (answer.mode) {
    case "knowledge":
      note = "Я сопоставила формулировку вопроса с карточками собственной базы знаний, выбрала наиболее близкую тему и приложила ссылки, на которых основан ответ. Это справочный поиск, а не доказательство того, что каждый факт верен.";
      break;
    case "web":
      note = "Я отправила запрос к открытой выдаче Wikipedia и показываю полученные результаты со ссылками. Это не полный индекс всего интернета; для последних новостей открывай поисковые источники и сверяй даты публикаций.";
      break;
    case "weather":
      note = "Я запросила координаты указанного города, затем получила текущие метеоданные у Open-Meteo. Показанное время относится к данным сервиса; прогноз может обновляться.";
      break;
    case "time":
      note = "Взяла системное время устройства и преобразовала его в IANA-зону Europe/Moscow, а не просто прибавила фиксированное число часов.";
      break;
    case "calculation":
      note = "Выражение разобрано безопасным арифметическим парсером и вычислено локально, без выполнения JavaScript-кода из сообщения.";
      break;
    case "conversion":
      note = "Я определила тип измерения и преобразовала значение через коэффициенты соответствующих единиц.";
      break;
    default:
      note = answer.sources?.length ? "Я приложила доступные источники, чтобы ты мог проверить информацию независимо." : "У меня нет достаточной подтверждённой информации, поэтому я не буду додумывать отсутствующие факты.";
  }
  return { ...answer, content: answer.content + "\n\nКРАТКИЙ РАЗБОР\n" + note };
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
  if (q.length < 2) return { content: "Уточни запрос для поиска.", sources: [] };
  try {
    let results = await searchWikipedia(q, { lang: "ru", limit: 5 });
    if (!results.length) results = await searchWikipedia(q, { lang: "en", limit: 5 });
    const sources = results.map((item) => ({ title: item.title + " · Wikipedia", url: item.url })).concat(webSearchLinks(q));
    if (!results.length) return { content: "В Wikipedia не нашлось подходящих страниц по запросу «" + q + "». Ниже есть ссылки на поиск в интернете. Я не выдумываю результаты, которых не получила.", sources };
    const intro = "Нашла " + results.length + " результатов по запросу «" + q + "» в живой выдаче Wikipedia. Это не полный индекс всего интернета; для свежих новостей и более широкого поиска открой поисковик по ссылке ниже.";
    return { content: intro + "\n\n" + results.map((item, index) => (index + 1) + ". " + item.title + "\n" + (item.snippet || "Открой статью для подробностей.")).join("\n\n"), sources };
  } catch (error) {
    return { content: "Не удалось прочитать живую выдачу Wikipedia: " + (error?.message || "сервис недоступен") + ". Ниже доступны прямые ссылки на веб-поиск.", sources: webSearchLinks(q) };
  }
}
function localTimeAnswer() {
  const result = getMoscowTime();
  return {
    content: "Сейчас в Москве " + result.time + " (МСК).\nДата: " + result.date + ".\nЧасовой пояс: Europe/Moscow, UTC+3.\n\nВремя рассчитано на основе системных часов устройства с преобразованием в московский часовой пояс.",
    sources: [{ title: "IANA — база часовых поясов", url: "https://www.iana.org/time-zones" }]
  };
}
async function runTool(tool) {
  switch (tool.type) {
    case "time": return localTimeAnswer();
    case "calculate":
      try { return { content: tool.expression + " = " + formatNumber(calculateExpression(tool.expression)) + "\n\nВычислено локально безопасным калькулятором." }; }
      catch (error) { return { content: "Не получилось вычислить выражение: " + error.message + "\nПример запроса: «посчитай (128 + 64) / 4»." }; }
    case "convert":
      try {
        const result = convertUnit(tool.value, tool.from, tool.to);
        return { content: formatNumber(tool.value) + " " + tool.from + " = " + formatNumber(result.value) + " " + result.unit + "\n\nКонвертация выполнена локально." };
      } catch (error) { return { content: "Не получилось конвертировать единицы: " + error.message }; }
    case "weather":
      try {
        const w = await getWeather(tool.query);
        return {
          content: "Погода сейчас: " + w.city + "\n" + w.condition + ".\nТемпература: " + formatNumber(w.temperature) + " °C; ощущается как " + formatNumber(w.feelsLike) + " °C.\nВлажность: " + formatNumber(w.humidity) + "%. Ветер: " + formatNumber(w.wind) + " км/ч.\nВремя данных: " + w.time + " (" + w.timezone + ").",
          sources: [{ title: "Open-Meteo — источник погоды", url: w.source }]
        };
      } catch (error) {
        return { content: "Не удалось получить погоду: " + error.message + "\nПроверь написание города или попробуй чуть позже.", sources: [{ title: "Open-Meteo", url: "https://open-meteo.com/" }] };
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
function createReasonedAnswer(query, result) {
  if (result) return result;
  const predicted = predictIntent(trainedModel, query);
  if (!predicted.intentId || predicted.confidence < 0.32) {
    return {
      content: "Я пока не нашла достаточно надёжной информации, чтобы ответить без догадок.\n\nМогу поискать в интернете: напиши «поищи в интернете …» или «найди последние новости о …». Также попробуй задать вопрос другими словами.",
      sources: webSearchLinks(query)
    };
  }
  const replies = {
    greeting: "Привет! Я LEDERG NEIRO. Я ищу ответы в базе знаний и открытых источниках, умею показывать время по Москве, считать и конвертировать единицы. Для интернета напиши «поищи в интернете …».",
    identity: "Я — LEDERG NEIRO, экспериментальная браузерная ИИ-система. Самописная MLP-сеть выбирает тему сообщения, справочные ответы ищутся в базе знаний, а инструменты получают время, считают выражения, конвертируют величины, ищут в Wikipedia и получают погоду. Я ещё не являюсь полноценной генеративной LLM.",
    capabilities: "Я могу искать по встроенной справочной базе, выполнять локальные расчёты, конвертировать единицы, показывать время по Москве, получать погоду и выполнять поиск в Wikipedia с источниками. Общий веб-поиск доступен прямыми ссылками; я не утверждаю, что прочитала страницу, пока не получила её содержимое.",
    neural_network: "Нейросеть — модель, которая настраивает параметры на примерах. В этой версии сеть использует текстовые признаки, скрытый слой tanh и softmax для выбора категории. Затем система ищет справочный ответ или использует отдельный инструмент. Это классификатор, а не языковая модель, свободно генерирующая текст.",
    github_pages: "GitHub Pages публикует статические HTML, CSS и JavaScript-файлы. Поэтому интерфейс и часть вычислений работают прямо в браузере, а не на Python-сервере. Погода и поиск обращаются к публичным сервисам. Секретные API-ключи в открытый код добавлять нельзя.",
    programming: "Я могу помочь со справочными вопросами по программированию и объяснить базовые технологии, но пока не умею надёжно анализировать произвольный большой код как LLM. Уточни язык или напиши «поищи в интернете …», чтобы получить ссылки на документацию.",
    learning: "Моя нейронная часть сейчас классифицирует намерения, а не обучается на каждом сообщении. База знаний расширяется отдельными карточками с ответом и источником. Следующий большой шаг к LLM — использовать или обучать языковую модель с весами, а не наращивать только шаблоны.",
    ideas: "Чтобы развить LEDERG NEIRO, полезнее одновременно расширять проверяемую базу и тесты, чем просто добавлять случайные ответы. Для настоящей генерации свободного текста понадобится отдельная языковая модель; она заметно тяжелее текущего классификатора.",
    thanks: "Всегда пожалуйста! Если вопрос требует свежих сведений, попроси меня поискать в интернете — я покажу найденные результаты и ссылки.",
    goodbye: "До встречи! Чат сохранит историю в этом браузере. При очистке данных сайта история может быть удалена.",
    help: "Примеры запросов: «который час по Москве?», «погода в Берлине», «посчитай (128 + 64) / 4», «переведи 10 км в мили», «что такое DNS?», «поищи в интернете квантовые компьютеры»."
  };
  return { content: replies[predicted.intentId] || replies.help };
}
async function getAnswer(query) {
  const tool = detectToolRequest(query) || directWebIntent(query);
  if (tool) return runTool(tool);
  const knowledge = knowledgeAnswer(query);
  if (knowledge) return knowledge;
  return createReasonedAnswer(query, null);
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
    const answer = applyDetailedMode(query, await getAnswer(query));
    if (currentRequest !== requestCounter) return;
    messages.push({ role: "assistant", content: answer?.content || "Не получилось сформировать ответ.", timestamp: Date.now(), sources: answer?.sources || [] });
  } catch (error) {
    if (currentRequest === requestCounter) {
      messages.push({ role: "assistant", content: "Произошла ошибка при обработке запроса: " + (error?.message || "неизвестная ошибка") + ". Попробуй ещё раз.", timestamp: Date.now() });
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
try { trainedModel = trainModel({ epochs: 60, seed: 2026 }); } catch { trainedModel = null; }
renderAll(); updateComposer(); updateClock(); setInterval(updateClock, 1000);
