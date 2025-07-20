
import fs from 'node:fs';
import path from 'node:path';
import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';

dotenv.config();

// ────────────────────────────────────────────────────────────────────────────────
// Константы и ENV
// ────────────────────────────────────────────────────────────────────────────────
const { BOT_TOKEN } = process.env;

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN не задан в .env');
  process.exit(1);
}

// Встроенная база (ккал на 100 г)
const LOCAL_FOOD_DB = {
  яблоко: 52,
  банан: 96,
  хлеб: 265,
  молоко: 42,
  сыр: 402,
  курица: 239,
  рис: 130,
  яйцо: 155,
};

// Путь к файлу кэша (чтобы не дёргать API часто)
const CACHE_FILE = path.resolve('calorie_cache.json');
function loadCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
  } catch {
    return {};
  }
}
function saveCache(cache) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf-8');
}
const apiCache = loadCache();

// Путь к файлу с дневными итогами
const DATA_FILE = path.resolve('calories.json');
function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } catch {
    return {};
  }
}
function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
}
const dataStore = loadData();

// ────────────────────────────────────────────────────────────────────────────────
// Вспомогательные функции
// ────────────────────────────────────────────────────────────────────────────────
const todayKey = () => new Date().toISOString().slice(0, 10);

function addCalories(userId, kcal) {
  const d = todayKey();
  dataStore[userId] ??= {};
  dataStore[userId][d] = (dataStore[userId][d] || 0) + kcal;
  saveData(dataStore);
}
function getTotal(userId) {
  return dataStore[userId]?.[todayKey()] ?? 0;
}
function resetToday(userId) {
  if (dataStore[userId]) {
    dataStore[userId][todayKey()] = 0;
    saveData(dataStore);
  }
}

/**
 * Запрашивает калории через Open Food Facts.
 * Возвращает `null`, если не найдено.
 */
async function fetchCaloriesFromOpenFoodFacts(query) {
  if (apiCache[query]) return apiCache[query];

  const url = `https://world.openfoodfacts.org/cgi/search.pl?action=process&search_terms=${encodeURIComponent(
    query
  )}&json=1&page_size=1`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`API status ${res.status}`);
    const json = await res.json();
    const product = json.products?.[0];
    const kcal = Math.round(product?.nutriments?.['energy-kcal_100g'] || 0);
    if (kcal) {
      apiCache[query] = kcal;
      saveCache(apiCache);
      return kcal;
    }
  } catch (err) {
    console.error('OpenFoodFacts API error:', err.message);
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────────────
// Telegram‑бот
// ────────────────────────────────────────────────────────────────────────────────
const bot = new Telegraf(BOT_TOKEN);

bot.start((ctx) => {
  ctx.reply(
    '👋 Привет! Пришлите название продукта — я добавлю его калории (на 100 г) к счёту. Можно отправлять несколько слов через запятую или пробел.\n\n' +
      'Команды:\n' +
      '/total — калории за сегодня\n' +
      '/reset — сбросить счёт\n' +
      '/help  — помощь'
  );
});

bot.help((ctx) => ctx.reply('Отправьте названия продуктов (одно или несколько). Команды: /total, /reset'));

bot.command('total', (ctx) => ctx.reply(`Сегодня вы съели ${getTotal(ctx.from.id)} ккал.`));

bot.command('reset', (ctx) => {
  resetToday(ctx.from.id);
  ctx.reply('Счётчик на сегодня сброшен.');
});

bot.on('text', async (ctx) => {
  const text = ctx.message.text.trim().toLowerCase();
  if (text.startsWith('/')) return;

  const queries = text
    .split(/[,\n]+|\s{2,}/) // разделение по запятым, переводам строки и двойным пробелам
    .map((s) => s.trim())
    .filter(Boolean);

  if (!queries.length) return ctx.reply('Пожалуйста, отправьте название продукта.');

  let totalAdded = 0;
  let messages = [];

  for (const q of queries) {
    let kcal = LOCAL_FOOD_DB[q] ?? apiCache[q];
    if (!kcal) kcal = await fetchCaloriesFromOpenFoodFacts(q);

    if (!kcal) {
      messages.push(`❓ ${q} — не найдено.`);
      continue;
    }

    addCalories(ctx.from.id, kcal);
    totalAdded += kcal;
    messages.push(`✅ ${q} ≈ ${kcal} ккал`);
  }

  const total = getTotal(ctx.from.id);
  messages.push(`\nВсего за сегодня: ${total} ккал.`);
  ctx.reply(messages.join('\n'));
});

// ────────────────────────────────────────────────────────────────────────────────
// Запуск бота
// ────────────────────────────────────────────────────────────────────────────────
bot.launch().then(() => console.log('🤖 CalorieBot запущен (OpenFoodFacts API)'));