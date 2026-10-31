// Надсилання листів через поштовий сервіс (API Brevo або Resend).
// Без ключа листи складаються в «тестову скриньку» (таблиця outbox), яку видно в адмін-панелі, —
// так реєстрацію й відновлення пароля можна показати й перевірити без поштового сервісу.
import { config } from '../config.js';
import { db, now } from '../db.js';
import { tr } from '../i18n.js';
import { log } from '../logger.js';

const OUTBOX_LIMIT = 100;

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function mailProvider() {
  if (config.mail.brevoKey && config.mail.from) return 'brevo';
  if (config.mail.resendKey) return 'resend';
  return 'outbox';
}

const PROVIDER_NAMES = { brevo: 'Brevo', resend: 'Resend', outbox: 'тестова скринька' };

/** Посилання на сторінку сайту для листа: BASE_URL + адреса в застосунку. */
export const siteLink = (hash) => `${config.baseUrl}/${hash.replace(/^\//, '')}`;

/**
 * Лист у фірмовому стилі. Пошта не підтримує зовнішніх стилів, тому всі стилі прописані прямо в тегах,
 * а розмітка — таблицями (так лист однаково виглядає в Gmail, Outlook і на телефоні).
 * Повертає HTML і текстову версію (для поштовиків без HTML). lang — мова службових написів листа.
 */
/** Список ігор у листі (дайджест): обкладинка, назва-посилання і рядок з ціною. */
function sectionsHtml(sections) {
  const row = (r) =>
    `<tr><td style="padding:6px 0;border-bottom:1px solid #eaeef5"><a href="${escapeHtml(r.url)}" style="text-decoration:none;color:#121826"><table role="presentation" cellspacing="0" cellpadding="0"><tr><td style="width:112px;padding-right:12px">${r.image ? `<img src="${escapeHtml(r.image)}" width="112" alt="" style="display:block;width:112px;border-radius:6px;border:0">` : ''}</td><td style="font-size:15px;line-height:1.35"><b>${escapeHtml(r.title)}</b><br><span style="font-size:13px;color:#5a6478">${escapeHtml(r.line)}</span></td></tr></table></a></td></tr>`;
  return sections
    .map((s) => `<h2 style="margin:22px 0 10px;font-size:17px;color:#121826">${escapeHtml(s.heading)}</h2><table role="presentation" width="100%" cellspacing="0" cellpadding="0">${s.rows.map(row).join('')}</table>`)
    .join('\n');
}
export function emailLayout({ lang = 'uk', heading, image = null, paragraphs = [], sections = [], button = null, footnote = '' }) {
  const p = (t) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#121826">${escapeHtml(t)}</p>`;
  const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#f2f4f8;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f2f4f8;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden">
<tr><td style="background:#0c111d;padding:18px 24px">
  <span style="display:inline-block;background:#f29a2e;color:#1f1304;font-weight:800;font-size:16px;border-radius:7px;padding:3px 9px">%</span>
  <span style="color:#ffffff;font-weight:800;font-size:18px;vertical-align:middle;margin-left:8px">${tr(lang, 'Знижколов')}</span>
</td></tr>
${image ? `<tr><td><img src="${escapeHtml(image)}" width="560" alt="" style="display:block;width:100%;height:auto;border:0"></td></tr>` : ''}
<tr><td style="padding:26px 24px 8px">
  <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#121826">${escapeHtml(heading)}</h1>
  ${paragraphs.map(p).join('\n  ')}
  ${sectionsHtml(sections)}
  ${
    button
      ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:8px 0 18px"><tr><td style="background:#f29a2e;border-radius:10px">
    <a href="${escapeHtml(button.url)}" style="display:inline-block;padding:12px 22px;color:#1f1304;font-weight:800;font-size:15px;text-decoration:none">${escapeHtml(button.label)}</a>
  </td></tr></table>
  <p style="margin:0 0 18px;font-size:12px;color:#5a6478">${tr(lang, 'Якщо кнопка не працює, скопіюй посилання в браузер:')}<br><a href="${escapeHtml(button.url)}" style="color:#c46f05;word-break:break-all">${escapeHtml(button.url)}</a></p>`
      : ''
  }
</td></tr>
<tr><td style="padding:14px 24px 20px;border-top:1px solid #eaeef5;font-size:12px;line-height:1.5;color:#5a6478">
  ${escapeHtml(footnote || tr(lang, 'Цей лист надіслав Знижколов — сервіс стеження за знижками на ігри.'))}
</td></tr>
</table></td></tr></table></body></html>`;
  const sectionText = sections.flatMap((s) => ['', s.heading, ...s.rows.map((r) => `• ${r.title} — ${r.line}: ${r.url}`)]);
  const text = [heading, '', ...paragraphs, ...sectionText, ...(button ? ['', `${button.label}: ${button.url}`] : []), '', footnote].join('\n').trim();
  return { html, text };
}

async function viaBrevo(msg) {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': config.mail.brevoKey, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      sender: { name: config.mail.fromName, email: config.mail.from },
      to: [{ email: msg.to }],
      subject: msg.subject,
      htmlContent: msg.html,
      textContent: msg.text,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Brevo відповів ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

async function viaResend(msg) {
  const from = config.mail.from || 'onboarding@resend.dev';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.mail.resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: `${config.mail.fromName} <${from}>`, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Resend відповів ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

function toOutbox(msg) {
  db.prepare('INSERT INTO outbox (to_email, subject, html, text, kind, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    msg.to,
    msg.subject,
    msg.html,
    msg.text,
    msg.kind || null,
    now()
  );
  // Тримаємо лише останні листи
  db.prepare('DELETE FROM outbox WHERE id NOT IN (SELECT id FROM outbox ORDER BY id DESC LIMIT ?)').run(OUTBOX_LIMIT);
}

/** Надсилає лист. Помилку не кидає: повертає { ok, provider, error } — лист не має ламати реєстрацію чи перевірку цін. */
export async function sendMail({ to, subject, html, text, kind = null, userId = null }) {
  const provider = mailProvider();
  const msg = { to, subject, html, text, kind };
  try {
    if (provider === 'brevo') await viaBrevo(msg);
    else if (provider === 'resend') await viaResend(msg);
    else toOutbox(msg);
    log.info('mail.sent', `Лист «${subject}» → ${to} (${PROVIDER_NAMES[provider]})`, { userId, meta: { kind, provider } });
    return { ok: true, provider };
  } catch (err) {
    log.error('mail.error', `Не вдалося надіслати лист «${subject}» → ${to}: ${err.message}`, { userId, meta: { kind, provider } });
    return { ok: false, provider, error: err.message };
  }
}

export function listOutbox(limit = 30) {
  return db.prepare('SELECT * FROM outbox ORDER BY id DESC LIMIT ?').all(limit);
}
