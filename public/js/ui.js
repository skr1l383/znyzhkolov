// Допоміжні функції інтерфейсу: безпечні шаблони HTML, форматування, сповіщення, діалоги.
import { locale, t } from './i18n.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

class Raw {
  constructor(value) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}

/** Позначає рядок як уже безпечний HTML (не буде екрановано). */
export const raw = (s) => new Raw(String(s ?? ''));

/**
 * Шаблон HTML з автоматичним екрануванням: html`<b>${name}</b>`.
 * Масиви з'єднуються, вкладені html`` не екрануються повторно.
 */
export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => {
    out += render(v) + strings[i + 1];
  });
  return raw(out);
}

function render(v) {
  if (v == null || v === false) return '';
  if (v instanceof Raw) return v.value;
  if (Array.isArray(v)) return v.map(render).join('');
  return escapeHtml(v);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function setHtml(el, content) {
  el.innerHTML = String(content);
}

export const STORE_NAMES = { steam: 'Steam', gog: 'GOG', epic: 'Epic Games' };

/** 51500 копійок → "515 ₴" */
export function formatUah(kopecks) {
  if (kopecks == null) return '—';
  const value = kopecks / 100;
  return (
    new Intl.NumberFormat(locale(), {
      minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(value) + ' ₴'
  );
}

export function formatMoney(minor, currency) {
  if (minor == null) return '—';
  if (currency === 'USD') return `$${(minor / 100).toFixed(2)}`;
  return formatUah(minor);
}

export function timeAgo(iso) {
  if (!iso) return '';
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return diff < 0 ? t('щойно') : t('за мить');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
  return new Date(iso).toLocaleDateString(locale());
}

export function formatDate(iso, withTime = false) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(locale(), {
    day: 'numeric',
    month: 'long',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

export function initials(title) {
  return String(title || '?')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

/** Обкладинка гри або заглушка з першими літерами назви. */
export function cover(url, title, extraClass = '', fallback = null) {
  if (url) {
    return html`<img class="cover ${extraClass}" src="${url}" alt="" loading="lazy" referrerpolicy="no-referrer"
      data-title="${title}" ${fallback ? html`data-fallback="${fallback}"` : ''} />`;
  }
  return html`<div class="cover cover-placeholder ${extraClass}" aria-hidden="true">${initials(title)}</div>`;
}

export function toast(message, type = 'info') {
  const box = $('#toasts');
  const el = document.createElement('div');
  el.className = `toast ${type === 'error' ? 'error' : ''}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.textContent = t(message); // повідомлення сервера теж перекладаються, якщо є у словнику
  box.append(el);
  setTimeout(() => el.remove(), type === 'error' ? 6000 : 3500);
}

/** Відкриває діалог із заданим вмістом. Повертає елемент діалогу. */
export function openDialog(content) {
  const dialog = $('#dialog');
  setHtml(dialog, content);
  if (!dialog.open) dialog.showModal();
  return dialog;
}

export function closeDialog() {
  const dialog = $('#dialog');
  if (dialog.open) dialog.close();
  dialog.innerHTML = '';
}

/** Підтвердження дії всередині сторінки (замість стандартного confirm). */
export function confirmDialog({ title, text, confirmText = t('Так'), danger = false }) {
  return new Promise((resolve) => {
    const dialog = openDialog(html`
      <form class="dialog-body" method="dialog">
        <h2>${title}</h2>
        ${text ? html`<p class="muted">${text}</p>` : ''}
        <div class="dialog-foot">
          <button class="btn" value="cancel" type="submit">${t('Скасувати')}</button>
          <button class="btn ${danger ? 'btn-danger solid' : 'btn-primary'}" value="ok" type="submit">${confirmText}</button>
        </div>
      </form>
    `);
    dialog.addEventListener(
      'close',
      () => {
        resolve(dialog.returnValue === 'ok');
        dialog.returnValue = '';
      },
      { once: true }
    );
  });
}

/** Показує стан завантаження на кнопці, поки виконується дія. */
export async function withLoading(button, fn) {
  button?.classList.add('loading');
  try {
    return await fn();
  } finally {
    button?.classList.remove('loading');
  }
}

/** Показує помилку з сервера під потрібним полем форми або загальну помилку. */
export function showFormError(form, err) {
  $$('.field-error', form).forEach((e) => e.remove());
  $$('.invalid', form).forEach((e) => e.classList.remove('invalid'));
  const general = $('.form-error', form);
  if (general) general.hidden = true;

  const field = err?.field && form.querySelector(`[name="${err.field}"]`);
  if (field) {
    field.classList.add('invalid');
    const msg = document.createElement('div');
    msg.className = 'field-error';
    msg.textContent = t(err.message);
    field.closest('.field')?.append(msg);
    field.focus();
  } else if (general) {
    general.textContent = t(err?.message || 'Щось пішло не так');
    general.hidden = false;
  } else {
    toast(t(err?.message || 'Щось пішло не так'), 'error');
  }
}

export function clearFormErrors(form) {
  $$('.field-error', form).forEach((e) => e.remove());
  $$('.invalid', form).forEach((e) => e.classList.remove('invalid'));
  const general = $('.form-error', form);
  if (general) general.hidden = true;
}

/** Адреса сторінки гри в застосунку. */
export const gameHref = (store, storeId) => `#/game?store=${encodeURIComponent(store)}&id=${encodeURIComponent(storeId)}`;

/** Розмір файлу людською мовою: 2 097 152 → «2 МБ». */
export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} ${t('Б')}`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} ${t('КБ')}`;
  return new Intl.NumberFormat(locale(), { maximumFractionDigits: 1 }).format(bytes / 1024 / 1024) + ` ${t('МБ')}`;
}

/** Аватар користувача: фото або перша літера імені. */
export function avatar(user, extraClass = '') {
  if (user?.avatarUrl) return html`<img class="avatar-img ${extraClass}" src="${user.avatarUrl}" alt="" />`;
  return html`<span class="avatar-letter ${extraClass}" aria-hidden="true">${initials(user?.name).slice(0, 1) || '?'}</span>`;
}

/**
 * Зона для файлу: можна перетягнути файл мишкою або натиснути й вибрати.
 * Поле вибору файлу лишається доступним з клавіатури (Tab, потім Enter).
 */
export function dropZone({ title, hint, accept }) {
  return html`
    <label class="dropzone">
      <input class="visually-hidden" type="file" accept="${accept}" />
      <svg class="dropzone-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0-4.5 4.5M12 4l4.5 4.5M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" /></svg>
      <strong>${title}</strong>
      <span class="dropzone-hint">${hint}</span>
      <span class="dropzone-error" role="alert" hidden></span>
    </label>
  `;
}

/**
 * Підключає до зони перетягування й вибір файлу. Перед надсиланням перевіряє
 * розширення і розмір, щоб не вантажити на сервер завідомо невідповідний файл
 * (сервер однаково перевіряє все ще раз).
 */
export function bindDropZone(zone, { extensions, maxBytes, typeError, onFile }) {
  const input = $('input[type="file"]', zone);
  const error = $('.dropzone-error', zone);
  const showError = (message) => {
    error.textContent = message;
    error.hidden = false;
  };

  const take = async (file) => {
    error.hidden = true;
    if (!file) return;
    const ext = file.name.includes('.') ? file.name.split('.').pop().toLowerCase() : '';
    if (!extensions.includes(ext)) return showError(typeError);
    if (file.size > maxBytes) {
      return showError(t('Файл завеликий: {size}. Максимум — {max}', { size: formatSize(file.size), max: formatSize(maxBytes) }));
    }
    zone.classList.add('busy');
    try {
      await onFile(file);
    } catch (err) {
      showError(err.message);
    } finally {
      zone.classList.remove('busy');
    }
  };

  input.addEventListener('change', () => {
    take(input.files[0]);
    input.value = ''; // щоб той самий файл можна було вибрати ще раз
  });
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    zone.classList.add('dragging');
  });
  zone.addEventListener('dragleave', (e) => {
    if (!zone.contains(e.relatedTarget)) zone.classList.remove('dragging');
  });
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('dragging');
    if (e.dataTransfer.files.length > 1) return showError(t('Перетягни лише один файл'));
    take(e.dataTransfer.files[0]);
  });
  return { showError };
}
