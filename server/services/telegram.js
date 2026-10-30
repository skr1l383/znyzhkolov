// Telegram-бот: прив'язка акаунта, команди та надсилання сповіщень.
// Працює через long polling (getUpdates), тож не потрібна публічна адреса сервера.
import { config } from '../config.js';
import { db, getSetting, setSetting } from '../db.js';
import { dateLocale, tr, userLang } from '../i18n.js';
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

/**
 * Надсилає повідомлення. photo — картинка гри: тоді це фото з підписом (підпис у Telegram — до 1024 символів).
 * button — { label, url }: кнопка-посилання під повідомленням.
 */
export async function sendMessage(chatId, html, { photo = null, button = null } = {}) {
  if (!state.enabled) return false;
  const markup = button ? { reply_markup: { inline_keyboard: [[{ text: button.label, url: button.url }]] } } : {};
  try {
    if (photo && html.length <= 1024) {
      try {
        await api('sendPhoto', { chat_id: chatId, photo, caption: html, parse_mode: 'HTML', ...markup });
        return true;
      } catch (err) {
        if (err.code === 403) throw err;
        // Telegram не зміг завантажити картинку — надсилаємо текстом
      }
    }
    await api('sendMessage', {
      chat_id: chatId,
      text: html,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...markup,
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

const help = (lang) =>
  [
    tr(lang, '<b>Знижколов</b> стежить за цінами на ігри в Steam, GOG та роздачами Epic Games.'),
    '',
    tr(lang, '/list — мій список ігор і поточні ціни'),
    tr(lang, '/free — що зараз роздають безкоштовно в Epic'),
    tr(lang, '/stop — відключити сповіщення в Telegram'),
    tr(lang, '/help — ця довідка'),
  ].join('\n');

/** Мова чату: з профілю, якщо акаунт підключено, інакше — мова застосунку Telegram. */
const chatLang = (user, from) => (user ? userLang(user) : /^(uk|ru)/.test(from?.language_code || 'uk') ? 'uk' : 'en');

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
  const lang = userLang(user);
  const items = listWatch(user.id).filter((w) => w.active);
  if (!items.length) return tr(lang, 'Твій список порожній. Додай ігри на сайті, і я повідомлю про знижки.');
  const lines = items.slice(0, 30).map((w) => {
    const prices = w.offers
      .filter((o) => o.available && o.priceUah != null)
      .map((o) => {
        const sale = o.discount > 0 ? ` (−${o.discount}%)` : '';
        return `${STORE_NAMES[o.store]}: ${formatUah(o.priceUah)}${sale}`;
      })
      .join(' · ');
    const mark = w.conditionMet ? '🔥 ' : '';
    return `${mark}<b>${escapeHtml(w.title)}</b>\n${prices || tr(lang, 'ціна ще невідома')}`;
  });
  return `<b>${tr(lang, 'Твій список ({n})', { n: items.length })}</b>\n\n${lines.join('\n\n')}`;
}

function freebiesText(lang) {
  const rows = db.prepare("SELECT * FROM epic_freebies WHERE status IN ('current', 'upcoming') ORDER BY status, ends_at").all();
  if (!rows.length) return tr(lang, 'Зараз даних про роздачі Epic немає. Спробуй пізніше.');
  const date = (iso) => (iso ? new Date(iso).toLocaleDateString(dateLocale(lang), { day: 'numeric', month: 'long' }) : '?');
  return rows
    .map((f) =>
      f.status === 'current'
        ? `🎁 <b>${escapeHtml(f.title)}</b> ${tr(lang, '— безкоштовно до {date}', { date: date(f.ends_at) })}\n${escapeHtml(f.url)}`
        : `⏳ <b>${escapeHtml(f.title)}</b> ${tr(lang, '— буде безкоштовно з {date}', { date: date(f.starts_at) })}`
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
      const lang = chatLang(user, msg.from);
      return sendMessage(
        chat.id,
        user
          ? `${tr(lang, 'Готово, {name}! Тепер сповіщення про знижки приходитимуть сюди.', { name: escapeHtml(user.name) })}\n\n${help(lang)}`
          : tr(lang, 'Код не підійшов або вже використаний. Онови сторінку профілю на сайті й натисни «Підключити Telegram» ще раз.')
      );
    }
    const user = userByChat(chat.id);
    const lang = chatLang(user, msg.from);
    return sendMessage(
      chat.id,
      user
        ? `${tr(lang, 'Привіт, {name}! Акаунт уже підключено.', { name: escapeHtml(user.name) })}\n\n${help(lang)}`
        : `${tr(lang, 'Привіт! Щоб отримувати сповіщення, відкрий на сайті сторінку «Профіль» і натисни «Підключити Telegram».')}\n\n${help(lang)}`
    );
  }

  const user = userByChat(chat.id);
  const lang = chatLang(user, msg.from);
  if (command === '/help') return sendMessage(chat.id, help(lang));
  if (command === '/free') return sendMessage(chat.id, freebiesText(lang));

  if (!user) return sendMessage(chat.id, tr(lang, 'Спочатку підключи акаунт: сайт → «Профіль» → «Підключити Telegram».'));

  if (command === '/list') return sendMessage(chat.id, watchListText(user));
  if (command === '/stop') {
    db.prepare('UPDATE users SET telegram_chat_id = NULL WHERE id = ?').run(user.id);
    log.info('telegram.unlinked', `Telegram відключено командою /stop (${user.email})`, { userId: user.id });
    return sendMessage(chat.id, tr(lang, 'Сповіщення вимкнено. Підключити знову можна на сайті в профілі.'));
  }
  return sendMessage(chat.id, `${tr(lang, 'Не знаю такої команди.')}\n\n${help(lang)}`);
}

async function pollLoop() {
  let offset = 0;
  try {
    offset = Number(getSetting('telegram:offset', 0)) || 0;
  } catch {
    // база недоступна — почнемо з нових повідомлень
  }
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
    // Меню команд і опис бота: українською за замовчуванням, англійською — для тих, у кого Telegram англійською.
    // Короткий опис видно в профілі бота, довгий — у порожньому чаті до натискання «Start»
    const site = config.baseUrl.replace(/^https?:\/\//, '');
    for (const lang of ['uk', 'en']) {
      const language_code = lang === 'en' ? 'en' : undefined;
      await api('setMyCommands', {
        language_code,
        commands: [
          { command: 'list', description: tr(lang, 'Мій список ігор і ціни') },
          { command: 'free', description: tr(lang, 'Безкоштовні роздачі Epic') },
          { command: 'stop', description: tr(lang, 'Вимкнути сповіщення') },
          { command: 'help', description: tr(lang, 'Довідка') },
        ],
      }).catch(() => {});
      await api('setMyShortDescription', {
        language_code,
        short_description: tr(lang, 'Знижки на ігри в Steam, GOG і Epic Games, ціни в гривнях. Сайт: {site}', { site }),
      }).catch(() => {});
      await api('setMyDescription', {
        language_code,
        description:
          `${tr(lang, 'Знижколов стежить за цінами на ігри в Steam, GOG і роздачами Epic Games та пише, коли гра з твого списку подешевшає.')}\n\n` +
          tr(lang, 'Додай ігри на сайті {site}, а потім у профілі натисни «Підключити Telegram».', { site }),
      }).catch(() => {});
    }
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
