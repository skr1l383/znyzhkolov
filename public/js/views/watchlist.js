// Головна сторінка: список ігор, за якими стежить користувач, з цінами в усіх магазинах.
import { del, get, patch, post, upload } from '../api.js';
import { priceChart } from '../chart.js';
import {
  $,
  STORE_NAMES,
  bindDropZone,
  dropZone,
  formatSize,
  closeDialog,
  confirmDialog,
  cover,
  formatMoney,
  formatUah,
  gameHref,
  html,
  openDialog,
  setHtml,
  showFormError,
  timeAgo,
  toast,
  withLoading,
} from '../ui.js';
import { conditionsFields, conditionsText, readConditions } from './conditions.js';
import { shareDialog } from './share.js';

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
        <h2 class="game-title"><a class="plain-link" href="${gameHref(item.offers[0]?.store, item.offers[0]?.storeId)}">${item.title}</a></h2>
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

const IMPORT_MAX_BYTES = 1024 * 1024; // те саме обмеження, що й на сервері

const MAX_ROWS = 50;

/** Таблиця з сервера приходить у base64 — робимо з неї файл, який можна зберегти. */
function downloadLink(file) {
  const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: file.type }));
  return html`<a class="btn btn-primary" href="${url}" download="${file.name}">Завантажити таблицю з цінами</a>`;
}

function importReport({ added, skipped, found, file }, { addToList, source }) {
  const stores = (list) => list.map((s) => STORE_NAMES[s]).join(' + ');
  const ok = addToList ? added : found;
  return html`
    <div class="import-report stack">
      <div class="row">
        <span class="pill pill-good">${addToList ? 'Додано' : 'Знайдено'}: ${ok.length}</span>
        ${skipped.length ? html`<span class="pill">${addToList ? 'Пропущено' : 'Не знайдено'}: ${skipped.length}</span>` : ''}
      </div>
      <div class="row">${downloadLink(file)}</div>
      ${ok.length
        ? html`<ul class="report-list">
            ${ok.map(
              (a) => html`<li>
                <span class="report-line">рядок ${a.line}</span>
                <span><strong>${a.matched}</strong>${a.matched !== a.title ? html` <span class="muted">(${source}: ${a.title})</span>` : ''}
                  <span class="muted"> · ${stores(a.stores)}</span>
                  ${a.notes?.length ? html`<span class="hint report-note">${a.notes.join('; ')}</span>` : ''}</span>
              </li>`
            )}
          </ul>`
        : ''}
      ${skipped.length
        ? html`<h3>${addToList ? 'Не додано' : 'Не знайдено'}</h3>
          <ul class="report-list">
            ${skipped.map(
              (s) => html`<li><span class="report-line">рядок ${s.line}</span><span>${s.title || '—'} <span class="muted">— ${s.reason}</span></span></li>`
            )}
          </ul>`
        : ''}
      ${added.length ? html`<p class="hint">Ціни щойно доданих ігор оновлюються у фоні, за хвилину-дві вони будуть актуальні.</p>` : ''}
    </div>
  `;
}

const addCheckbox = (id) => html`
  <label class="check">
    <input type="checkbox" id="${id}" checked />
    <span>Додати знайдені ігри до мого списку (сповіщення про знижку від 50%)</span>
  </label>`;

const lookupRow = (n, value = '') => html`
  <div class="lookup-row">
    <span class="lookup-num">${n}</span>
    <input class="input" type="text" maxlength="200" placeholder="Назва гри, наприклад Hollow Knight" value="${value}"
      aria-label="Гра ${n}" />
    <button class="icon-btn" type="button" data-remove aria-label="Прибрати рядок">×</button>
  </div>`;

/** Вкладка «Скласти таблицю»: рядки з назвами, «+», Enter, вставка цілого списку. */
function bindLookup(panel, { onDone }) {
  const rowsBox = $('.lookup-rows', panel);
  const inputs = () => [...rowsBox.querySelectorAll('input')];
  const renumber = () => {
    rowsBox.querySelectorAll('.lookup-row').forEach((row, i) => {
      $('.lookup-num', row).textContent = i + 1;
      $('input', row).setAttribute('aria-label', `Гра ${i + 1}`);
    });
    const filled = inputs().filter((i) => i.value.trim()).length;
    $('#lookup-count', panel).textContent = filled ? `${filled} з ${MAX_ROWS}` : '';
    $('#lookup-add', panel).disabled = inputs().length >= MAX_ROWS;
  };
  const addRow = (after = null, value = '') => {
    if (inputs().length >= MAX_ROWS) {
      toast(`Не більше ${MAX_ROWS} ігор за раз`, 'error');
      return null;
    }
    const tmp = document.createElement('div');
    setHtml(tmp, lookupRow(0, value));
    const row = tmp.firstElementChild;
    if (after) after.after(row);
    else rowsBox.append(row);
    renumber();
    return $('input', row);
  };

  $('#lookup-add', panel).addEventListener('click', () => addRow()?.focus());
  rowsBox.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove]');
    if (!btn) return;
    const row = btn.closest('.lookup-row');
    if (inputs().length === 1) $('input', row).value = '';
    else row.remove();
    renumber();
  });
  rowsBox.addEventListener('input', renumber);
  rowsBox.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
    e.preventDefault();
    const row = e.target.closest('.lookup-row');
    const next = row.nextElementSibling;
    (next ? $('input', next) : addRow(row))?.focus();
  });
  // Вставлений список (кожна гра з нового рядка, наприклад стовпчик з Excel) розкладаємо по рядках
  rowsBox.addEventListener('paste', (e) => {
    const lines = (e.clipboardData?.getData('text') || '')
      .split(/\r?\n/)
      .map((l) => l.split('\t')[0].trim())
      .filter(Boolean);
    if (lines.length < 2) return;
    e.preventDefault();
    let input = e.target;
    input.value = lines[0];
    for (const line of lines.slice(1)) {
      input = addRow(input.closest('.lookup-row'), line);
      if (!input) break;
    }
    renumber();
  });

  $('#lookup-run', panel).addEventListener('click', (e) =>
    withLoading(e.currentTarget, async () => {
      const titles = inputs().map((i) => i.value.trim()).filter(Boolean);
      if (!titles.length) {
        toast('Впиши хоча б одну гру', 'error');
        inputs()[0].focus();
        return;
      }
      const addToList = $('#lookup-to-list', panel).checked;
      try {
        onDone(await post('/api/watch/lookup', { titles, addToList }), addToList);
      } catch (err) {
        toast(err.message, 'error');
      }
    })
  );
}

function filesDialog(hasItems, onImported) {
  const dialog = openDialog(html`
    <div class="dialog-body">
      <div><p class="muted">Мій список</p><h2>Таблиці з іграми</h2></div>
      <div class="segmented tabs" role="group" aria-label="Що зробити">
        <button type="button" data-tab="lookup" aria-pressed="true">Скласти таблицю</button>
        <button type="button" data-tab="import" aria-pressed="false">Імпорт файлу</button>
        <button type="button" data-tab="export" aria-pressed="false">Експорт і звіт</button>
      </div>

      <section class="stack" data-panel="lookup">
        <p class="muted">
          Впиши назви ігор — ми знайдемо кожну в Steam і GOG і повернемо таблицю з цінами, знижками й посиланнями.
          Enter або «+» додає рядок; можна вставити цілий список, кожна гра з нового рядка.
        </p>
        <div class="lookup-rows">${lookupRow(1)}</div>
        <div class="row">
          <button class="btn btn-sm" type="button" id="lookup-add">+ Додати гру</button>
          <span class="hint" id="lookup-count"></span>
        </div>
        ${addCheckbox('lookup-to-list')}
        <div class="row"><button class="btn btn-primary" type="button" id="lookup-run">Заповнити таблицю</button></div>
      </section>

      <section class="stack" data-panel="import" hidden>
        <p class="muted">
          Підійде файл, експортований звідси, або просто назви ігор у першому стовпці.
          Після пошуку можна завантажити таблицю, вже заповнену цінами.
        </p>
        ${addCheckbox('import-to-list')}
        <div id="import-box">
          ${dropZone({
            title: 'Перетягни таблицю сюди',
            hint: `або натисни, щоб вибрати файл. Excel (.xlsx) або CSV, до ${formatSize(IMPORT_MAX_BYTES)} і до ${MAX_ROWS} ігор`,
            accept: '.xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          })}
        </div>
      </section>

      <section class="stack" data-panel="export" hidden>
        <p class="muted">${hasItems
          ? 'Таблиця з усіма іграми списку, цінами в Steam і GOG та умовами сповіщень. Відкривається в Excel і Google Таблицях.'
          : 'Список поки порожній — файл стане шаблоном, який можна заповнити й імпортувати.'}</p>
        <div class="row">
          <a class="btn" href="/api/watch/export?format=xlsx" download>Excel (.xlsx)</a>
          <a class="btn" href="/api/watch/export?format=csv" download>CSV</a>
        </div>
        <h3>PDF-звіт</h3>
        <p class="muted">Гарний звіт для друку чи пересилання: скільки ігри коштують зараз, скільки без знижок і скільки можна заощадити.</p>
        <div class="row"><a class="btn btn-primary" href="/api/watch/report.pdf" download>Завантажити PDF-звіт</a></div>
      </section>

      <div class="dialog-foot"><button class="btn" type="button" data-close>Закрити</button></div>
    </div>
  `);
  $('[data-close]', dialog).addEventListener('click', closeDialog);

  dialog.querySelectorAll('[data-tab]').forEach((tab) =>
    tab.addEventListener('click', () => {
      dialog.querySelectorAll('[data-tab]').forEach((t) => t.setAttribute('aria-pressed', String(t === tab)));
      dialog.querySelectorAll('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== tab.dataset.tab));
    })
  );

  const lookupPanel = $('[data-panel="lookup"]', dialog);
  bindLookup(lookupPanel, {
    onDone: (result, addToList) => {
      setHtml(
        lookupPanel,
        html`${importReport(result, { addToList, source: 'запит' })}
          <div class="row"><button class="btn" type="button" id="lookup-again">Скласти нову таблицю</button></div>`
      );
      $('#lookup-again', lookupPanel).addEventListener('click', () => filesDialog(hasItems || result.added.length > 0, onImported));
      if (result.added.length) onImported();
    },
  });

  const box = $('#import-box', dialog);
  bindDropZone($('.dropzone', box), {
    extensions: ['xlsx', 'csv'],
    maxBytes: IMPORT_MAX_BYTES,
    typeError: 'Цей формат не підтримується. Можна Excel (.xlsx) або CSV',
    onFile: async (file) => {
      const addToList = $('#import-to-list', dialog).checked;
      $('.dropzone-hint', box).textContent = `«${file.name}»: шукаємо ігри в Steam і GOG, це може зайняти до хвилини…`;
      try {
        const report = await upload(`/api/watch/import${addToList ? '' : '?add=0'}`, file);
        setHtml(box, html`<h3>Результат для «${file.name}»</h3>${importReport(report, { addToList, source: 'у файлі' })}`);
        if (report.added.length) onImported();
      } finally {
        const hint = $('.dropzone-hint', box);
        if (hint) hint.textContent = 'Спробуй інший файл: Excel (.xlsx) або CSV';
      }
    },
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
          <div class="row">
            <button class="btn" type="button" id="share-btn">Поділитися</button>
            <button class="btn" type="button" id="files-btn">Таблиці</button>
            ${items.length ? html`<a class="btn btn-primary" href="#/search">Додати гру</a>` : ''}
          </div>
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
    if (e.target.closest('#share-btn')) {
      shareDialog();
      return;
    }
    if (e.target.closest('#files-btn')) {
      filesDialog(items.length > 0, async () => {
        items = (await get('/api/watch')).items;
        draw();
      });
      return;
    }
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
