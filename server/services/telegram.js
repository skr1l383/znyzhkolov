// Telegram-бот: прив'язка акаунта, команди та надсилання сповіщень.
// Працює через long polling (getUpdates), тож не потрібна публічна адреса сервера.
import { config } from '../config.js';
import { db, getSetting, setSetting } from '../db.js';
import { log } from '../logger.js';
import { formatUah } from '../stores/util.js';
import { STORE_NAMES } from '../stores/index.js';
import { listWatch } from './watch.js';

const state = {
  enabled: Boolean(config.telegram.token),
  running: false,
  username: null,
  lastError: null,
  controller: null,
};

export const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

class TelegramError extends Error {
  constructor(code, description) {
    super(`Telegram ${code}: ${description}`);
    this.code = code;
  }
}

async function api(method, params = {}, { timeoutMs = 15000, signal } = {}) {
  const url = `${config.telegram.apiUrl}/bot${config.telegram.token}/${method}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
  });
  let data;
  try {
    data = await res.json();
  } catch {
    throw new TelegramError(res.status, 'незрозуміла відповідь');
  }
  if (!data.ok) throw new TelegramError(data.error_code || res.status, data.description || 'помилка');
  return data.result;
}

export function botStatus() {
  return {
    enabled: state.enabled,
    running: state.running,
    username: state.username,
    lastError: state.lastError,
  };
}

export const linkUrl = (code) => (state.username ? `https://t.me/${state.username}?start=${code}` : null);

export async function sendMessage(chatId, html) {
  if (!state.enabled) return false;
  try {
    await api('sendMessage', {
      chat_id: chatId,
      text: html,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    });
    return true;
  } catch (err) {
    state.lastError = err.message;
    if (err.code === 403) {
      // Користувач заблокував бота: відв'язуємо, щоб не надсилати даремно
      db.prepare('UPDATE users SET telegram_chat_id = NULL WHERE telegram_chat_id = ?').run(String(chatId));
      log.warn('telegram.blocked', `Користувач заблокував бота, Telegram відв'язано (chat ${chatId})`);
    } else {
      log.error('telegram.send_failed', `Не вдалося надіслати повідомлення: ${err.message}`);
    }
    return false;
  }
}

const HELP = [
  '<b>Знижколов</b> стежить за цінами на ігри в Steam, GOG та роздачами Epic Games.',
  '',
  '/list — мій список ігор і поточні ціни',
  '/free — що зараз роздають безкоштовно в Epic',
  '/stop — відключити сповіщення в Telegram',
  '/help — ця довідка',
].join('\n');

function userByChat(chatId) {
  return db.prepare('SELECT * FROM users WHERE telegram_chat_id = ?').get(String(chatId));
}

function linkAccount(code, chat, from) {
  const user = db.prepare('SELECT * FROM users WHERE telegram_link_code = ?').get(code);
  if (!user) return null;
  // Один чат може бути прив'язаний лише до одного акаунта
  db.prepare('UPDATE users SET telegram_chat_id = NULL WHERE telegram_chat_id = ? AND id <> ?').run(String(chat.id), user.id);
  db.prepare('UPDATE users SET telegram_chat_id = ?, telegram_username = ?, telegram_link_code = NULL WHERE id = ?').run(
    String(chat.id),
    from?.username || from?.first_name || null,
    user.id
  );
  log.info('telegram.linked', `Telegram підключено до акаунта ${user.email}`, { userId: user.id });
  return user;
}

function watchListText(user) {
  const items = listWatch(user.id).filter((w) => w.active);
  if (!items.length) return 'Твій список порожній. Додай ігри на сайті, і я повідомлю про знижки.';
  const lines = items.slice(0, 30).map((w) => {
    const prices = w.offers
      .filter((o) => o.available && o.priceUah != null)
      .map((o) => {
        const sale = o.discount > 0 ? ` (−${o.discount}%)` : '';
        return `${STORE_NAMES[o.store]}: ${formatUah(o.priceUah)}${sale}`;
      })
      .join(' · ');
    const mark = w.conditionMet ? '🔥 ' : '';
    return `${mark}<b>${escapeHtml(w.title)}</b>\n${prices || 'ціна ще невідома'}`;
  });
  return `<b>Твій список (${items.length})</b>\n\n${lines.join('\n\n')}`;
}

function freebiesText() {
  const rows = db.prepare("SELECT * FROM epic_freebies WHERE status IN ('current', 'upcoming') ORDER BY status, ends_at").all();
  if (!rows.length) return 'Зараз даних про роздачі Epic немає. Спробуй пізніше.';
  const date = (iso) => (iso ? new Date(iso).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' }) : '?');
  return rows
    .map((f) =>
      f.status === 'current'
        ? `🎁 <b>${escapeHtml(f.title)}</b> — безкоштовно до ${date(f.ends_at)}\n${escapeHtml(f.url)}`
        : `⏳ <b>${escapeHtml(f.title)}</b> — буде безкоштовно з ${date(f.starts_at)}`
    )
    .join('\n\n');
}

async function handleMessage(msg) {
  const chat = msg.chat;
  const text = String(msg.text || '').trim();
  if (!chat || !text) return;
  const [rawCommand, ...args] = text.split(/\s+/);
  const command = rawCommand.toLowerCase().replace(/@.*$/, '');

  if (command === '/start') {
    const code = args[0];
    if (code) {
      const user = linkAccount(code, chat, msg.from);
      return sendMessage(
        chat.id,
        user
          ? `Готово, ${escapeHtml(user.name)}! Тепер сповіщення про знижки приходитимуть сюди.\n\n${HELP}`
          : 'Код не підійшов або вже використаний. Онови сторінку профілю на сайті й натисни «Підключити Telegram» ще раз.'
      );
    }
    const user = userByChat(chat.id);
    return sendMessage(
      chat.id,
      user
        ? `Привіт, ${escapeHtml(user.name)}! Акаунт уже підключено.\n\n${HELP}`
        : `Привіт! Щоб отримувати сповіщення, відкрий на сайті сторінку «Профіль» і натисни «Підключити Telegram».\n\n${HELP}`
    );
  }

  if (command === '/help') return sendMessage(chat.id, HELP);
  if (command === '/free') return sendMessage(chat.id, freebiesText());

  const user = userByChat(chat.id);
  if (!user) return sendMessage(chat.id, 'Спочатку підключи акаунт: сайт → «Профіль» → «Підключити Telegram».');

  if (command === '/list') return sendMessage(chat.id, watchListText(user));
  if (command === '/stop') {
    db.prepare('UPDATE users SET telegram_chat_id = NULL WHERE id = ?').run(user.id);
    log.info('telegram.unlinked', `Telegram відключено командою /stop (${user.email})`, { userId: user.id });
    return sendMessage(chat.id, 'Сповіщення вимкнено. Підключити знову можна на сайті в профілі.');
  }
  return sendMessage(chat.id, `Не знаю такої команди.\n\n${HELP}`);
}

async function pollLoop() {
  let offset = Number(getSetting('telegram:offset', 0)) || 0;
  let backoff = 1000;
  while (state.running) {
    try {
      const updates = await api(
        'getUpdates',
        { offset, timeout: 25, allowed_updates: ['message'] },
        { timeoutMs: 40000, signal: state.controller.signal }
      );
      for (const update of updates) {
        offset = update.update_id + 1;
        setSetting('telegram:offset', offset);
        if (update.message) {
          try {
            await handleMessage(update.message);
          } catch (err) {
            log.error('telegram.handler', `Помилка обробки повідомлення: ${err.message}`);
          }
        }
      }
      backoff = 1000;
      state.lastError = null;
    } catch (err) {
      if (!state.running) break;
      state.lastError = err.message;
      if (err.code === 401 || err.code === 404) {
        log.error('telegram.token', 'Telegram відхилив токен бота. Перевір TELEGRAM_BOT_TOKEN у файлі .env');
        state.running = false;
        break;
      }
      log.warn('telegram.poll', `Немає зв'язку з Telegram: ${err.message}. Повтор через ${backoff / 1000} с`);
      await new Promise((r) => setTimeout(r, backoff));
      backoff = Math.min(backoff * 2, 60000);
    }
  }
}

export async function startBot() {
  if (!state.enabled) {
    log.info('telegram.disabled', 'TELEGRAM_BOT_TOKEN не задано, бот вимкнено (сайт працює і без нього)');
    return;
  }
  state.running = true;
  state.controller = new AbortController();
  try {
    const me = await api('getMe');
    state.username = me.username;
    await api('setMyCommands', {
      commands: [
        { command: 'list', description: 'Мій список ігор і ціни' },
        { command: 'free', description: 'Безкоштовні роздачі Epic' },
        { command: 'stop', description: 'Вимкнути сповіщення' },
        { command: 'help', description: 'Довідка' },
      ],
    }).catch(() => {});
    log.info('telegram.started', `Telegram-бот @${me.username} запущено`);
  } catch (err) {
    state.lastError = err.message;
    log.warn('telegram.start', `Не вдалося підключитися до Telegram: ${err.message}. Бот пробуватиме ще раз`);
  }
  pollLoop();
}

export function stopBot() {
  state.running = false;
  state.controller?.abort();
}

/** Для повторної спроби отримати ім'я бота, якщо при старті не було інтернету. */
export async function ensureBotUsername() {
  if (state.enabled && !state.username) {
    try {
      state.username = (await api('getMe')).username;
    } catch {
      // залишаємо як є
    }
  }
  return state.username;
}
