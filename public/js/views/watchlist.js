// Головна сторінка: список ігор, за якими стежить користувач, з цінами в усіх магазинах.
import { del, get, patch, post } from '../api.js';
import { priceChart } from '../chart.js';
import {
  $,
  STORE_NAMES,
  closeDialog,
  confirmDialog,
  cover,
  formatMoney,
  formatUah,
  html,
  openDialog,
  setHtml,
  showFormError,
  timeAgo,
  toast,
  withLoading,
} from '../ui.js';
import { conditionsFields, conditionsText, readConditions } from './conditions.js';

const SUGGESTIONS = ['Hades', 'Stardew Valley', 'Hollow Knight', 'Cyberpunk 2077', 'The Witcher 3'];

function offerNote(o, isBest) {
  if (!o.available) return 'Недоступно в магазині для України';
  if (o.error) return o.error;
  if (o.price == null) return 'Ціни немає: гра безкоштовна або ще не продається';
  const notes = [];
  if (isBest) notes.push(html`<span class="best-label">Найдешевше</span>`);
  if (o.currency === 'USD') notes.push(`${formatMoney(o.price, 'USD')} за курсом НБУ`);
  return notes.length ? html`${notes.map((n, i) => html`${i ? ' · ' : ''}${n}`)}` : '';
}

function priceRow(o, bestStore) {
  const isBest = o.store === bestStore && o.available && o.priceUah != null;
  const note = offerNote(o, isBest);
  const value = !o.available || o.price == null ? '—' : o.isFree ? 'Безкоштовно' : formatUah(o.priceUah);
  return html`
    <a class="price-row ${isBest ? 'best' : ''}" href="${o.url}" target="_blank" rel="noopener noreferrer"
      title="Відкрити в ${STORE_NAMES[o.store]}">
      <span class="store store-${o.store}">${STORE_NAMES[o.store]}</span>
      <span class="price-values">
        ${o.discount > 0 && o.basePriceUah ? html`<span class="price-old">${formatUah(o.basePriceUah)}</span>` : ''}
        ${o.discount > 0 ? html`<span class="discount">−${o.discount}%</span>` : ''}
        <span class="price">${value}</span>
      </span>
      ${note ? html`<span class="price-note">${note}</span>` : ''}
    </a>
  `;
}

function lastChecked(item) {
  const times = item.offers.map((o) => o.checkedAt).filter(Boolean).sort();
  return times.length ? times[times.length - 1] : null;
}

function statusPill(item) {
  if (!item.active) return html`<span class="pill">На паузі</span>`;
  if (item.conditionMet) return html`<span class="pill pill-good">Умову виконано</span>`;
  return html`<span class="pill">Чекаємо на знижку</span>`;
}

function gameCard(item) {
  const checked = lastChecked(item);
  const missingGog = !item.offers.some((o) => o.store === 'gog');
  return html`
    <article class="game-card ${item.conditionMet && item.active ? 'met' : ''} ${item.active ? '' : 'paused'}" data-id="${item.id}">
      ${cover(item.imageUrl, item.title)}
      <div class="game-main">
        <div class="row">${statusPill(item)}</div>
        <h2 class="game-title">${item.title}</h2>
        <p class="conditions">Сповістити, коли: ${conditionsText(item)}</p>
        ${item.lastAlertAt ? html`<p class="hint">Останнє сповіщення ${timeAgo(item.lastAlertAt)}</p>` : ''}
        <div class="game-actions">
          <button class="btn btn-sm" type="button" data-action="chart">Графік ціни</button>
          <button class="btn btn-sm" type="button" data-action="refresh">Оновити ціни</button>
          <button class="btn btn-sm" type="button" data-action="edit">Умови</button>
          <button class="btn btn-sm" type="button" data-action="toggle">${item.active ? 'Пауза' : 'Увімкнути'}</button>
          ${missingGog
            ? html`<a class="btn btn-sm btn-ghost" href="#/search?store=gog&q=${encodeURIComponent(item.title)}&link=${item.id}">+ GOG</a>`
            : ''}
          <button class="btn btn-sm btn-ghost btn-danger" type="button" data-action="delete">Видалити</button>
        </div>
      </div>
      <div class="prices">
        ${item.offers.map((o) => priceRow(o, item.bestStore))}
        ${checked ? html`<div class="checked-at">Ціни перевірено ${timeAgo(checked)}</div>` : ''}
      </div>
    </article>
  `;
}

function emptyState() {
  return html`
    <div class="empty">
      <svg class="empty-icon" viewBox="0 0 32 32" aria-hidden="true">
        <path d="M3.5 6A2.5 2.5 0 0 1 6 3.5h9.3a2.5 2.5 0 0 1 1.77.73l11 11a2.5 2.5 0 0 1 0 3.54l-9.3 9.3a2.5 2.5 0 0 1-3.54 0l-11-11a2.5 2.5 0 0 1-.73-1.77Z" class="brand-tag" />
        <circle cx="9.5" cy="9.5" r="2.2" class="brand-hole" />
      </svg>
      <h2>Список поки порожній</h2>
      <p>Знайди гру, яку хочеш купити, і вкажи свою умову. Ми перевірятимемо ціни в Steam і GOG та повідомимо, коли настане час купувати.</p>
      <a class="btn btn-primary" href="#/search">Знайти гру</a>
      <div class="suggestions">
        ${SUGGESTIONS.map((s) => html`<a class="btn btn-sm" href="#/search?q=${encodeURIComponent(s)}">${s}</a>`)}
      </div>
    </div>
  `;
}

function editDialog(item, onSaved) {
  const dialog = openDialog(html`
    <form class="dialog-body" novalidate>
      <div class="dialog-head">
        ${cover(item.imageUrl, item.title)}
        <div><p class="muted">Умови сповіщення</p><h2>${item.title}</h2></div>
      </div>
      <div class="form-error" role="alert" hidden></div>
      ${conditionsFields(item)}
      <div class="dialog-foot">
        <button class="btn" type="button" data-close>Скасувати</button>
        <button class="btn btn-primary" type="submit">Зберегти</button>
      </div>
    </form>
  `);
  const form = $('form', dialog);
  $('[data-close]', form).addEventListener('click', closeDialog);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await withLoading($('button[type="submit"]', form), async () => {
      try {
        const { item: updated } = await patch(`/api/watch/${item.id}`, readConditions(form));
        closeDialog();
        toast('Умови збережено');
        onSaved(updated);
      } catch (err) {
        showFormError(form, err);
      }
    });
  });
}

async function chartDialog(item) {
  const dialog = openDialog(html`
    <div class="dialog-body">
      <div class="dialog-head">
        ${cover(item.imageUrl, item.title)}
        <div><p class="muted">Історія ціни</p><h2>${item.title}</h2></div>
      </div>
      <div class="chart-box"><div class="skeleton"></div></div>
      <div class="dialog-foot"><button class="btn" type="button" data-close>Закрити</button></div>
    </div>
  `);
  // Графіку потрібно більше місця, ніж звичайному діалогу
  dialog.classList.add('dialog-wide');
  dialog.addEventListener('close', () => dialog.classList.remove('dialog-wide'), { once: true });
  $('[data-close]', dialog).addEventListener('click', closeDialog);
  const box = $('.chart-box', dialog);
  try {
    const { series } = await get(`/api/watch/${item.id}/history`);
    if (box.isConnected) priceChart(box, series);
  } catch (err) {
    setHtml(box, html`<p class="form-error">${err.message}</p>`);
  }
}

export async function render(root) {
  setHtml(root, html`<div class="stack"><div class="skeleton"></div><div class="skeleton"></div></div>`);
  let items = (await get('/api/watch')).items;

  const draw = () => {
    const met = items.filter((i) => i.active && i.conditionMet).length;
    setHtml(
      root,
      html`
        <div class="page-head">
          <div>
            <h1>Мій список</h1>
            ${items.length
              ? html`<div class="summary">
                  <span class="pill">${items.length} ${plural(items.length, 'гра', 'гри', 'ігор')}</span>
                  ${met ? html`<span class="pill pill-good">${met} з виконаною умовою</span>` : ''}
                </div>`
              : html`<p>Тут будуть ігри, за цінами яких ти стежиш.</p>`}
          </div>
          ${items.length ? html`<a class="btn btn-primary" href="#/search">Додати гру</a>` : ''}
        </div>
        ${items.length ? html`<div class="game-list">${items.map(gameCard)}</div>` : emptyState()}
      `
    );
  };

  const replace = (updated) => {
    items = items.map((i) => (i.id === updated.id ? updated : i));
    draw();
  };

  root.onclick = async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const card = btn.closest('[data-id]');
    const item = items.find((i) => i.id === Number(card.dataset.id));
    if (!item) return;
    const action = btn.dataset.action;

    try {
      if (action === 'refresh') {
        await withLoading(btn, async () => {
          const res = await post(`/api/watch/${item.id}/refresh`);
          replace(res.item);
          toast(res.errors?.length ? `Частину цін не вдалося оновити: ${res.errors.join('; ')}` : 'Ціни оновлено', res.errors?.length ? 'error' : 'info');
        });
      } else if (action === 'chart') {
        await chartDialog(item);
      } else if (action === 'edit') {
        editDialog(item, replace);
      } else if (action === 'toggle') {
        const { item: updated } = await patch(`/api/watch/${item.id}`, { active: !item.active });
        replace(updated);
        toast(updated.active ? 'Стеження увімкнено' : 'Стеження поставлено на паузу');
      } else if (action === 'delete') {
        const ok = await confirmDialog({
          title: `Прибрати «${item.title}» зі списку?`,
          text: 'Сповіщення про цю гру більше не надходитимуть. Історія цін залишиться, якщо гру відстежує хтось інший.',
          confirmText: 'Прибрати',
          danger: true,
        });
        if (!ok) return;
        await del(`/api/watch/${item.id}`);
        items = items.filter((i) => i.id !== item.id);
        draw();
        toast('Гру прибрано зі списку');
      }
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  draw();
  // Поки сторінка відкрита, періодично підтягуємо свіжі ціни з сервера
  const timer = setInterval(async () => {
    if (document.querySelector('#dialog[open]')) return;
    try {
      items = (await get('/api/watch')).items;
      draw();
    } catch {
      // мовчки чекаємо наступної спроби
    }
  }, 60000);
  return () => {
    clearInterval(timer);
    root.onclick = null;
  };
}

export function plural(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
