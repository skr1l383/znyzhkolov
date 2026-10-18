// «Поділитися списком»: посилання і QR-код на свій список, сканування QR друга,
// і сторінка, яку бачить друг за посиланням (#/shared?token=...).
import { del, get, post } from '../api.js';
import { go, state } from '../app.js';
import { startCameraScan, decodeImageFile, sharedTokenFrom } from '../qrscan.js';
import {
  $,
  STORE_NAMES,
  bindDropZone,
  closeDialog,
  cover,
  dropZone,
  formatSize,
  formatUah,
  gameHref,
  html,
  openDialog,
  setHtml,
  toast,
  withLoading,
} from '../ui.js';
import { openAddDialog } from './search.js';
import { plural } from './watchlist.js';

const shareLink = (token) => `${location.origin}/#/shared?token=${encodeURIComponent(token)}`;
const qrSrc = (text) => `/api/qr.svg?text=${encodeURIComponent(text)}`;
const PHOTO_MAX_BYTES = 8 * 1024 * 1024;

function minePanel(token) {
  if (!token) {
    return html`
      <p class="muted">
        Створи посилання на свій список — друзі побачать ігри, за якими ти стежиш, і їхні ціни
        (без твоєї пошти й інших даних) і зможуть одним натисканням стежити за ними теж.
      </p>
      <div><button class="btn btn-primary" type="button" id="share-create">Створити посилання</button></div>`;
  }
  const link = shareLink(token);
  return html`
    <div class="share-grid">
      <img class="qr-img" src="${qrSrc(link)}" alt="QR-код посилання на мій список" width="220" height="220" />
      <div class="stack">
        <p class="muted">Наведи камеру телефона на код або надішли посилання.</p>
        <div class="copy-row">
          <input class="input" id="share-link" value="${link}" readonly aria-label="Посилання на мій список" />
          <button class="btn" type="button" id="share-copy">Копіювати</button>
        </div>
        <div class="row">
          <a class="btn btn-sm" href="${link}" target="_blank" rel="noopener">Відкрити</a>
          <a class="btn btn-sm" href="${qrSrc(link)}" download="znyzhkolov-qr.svg">Завантажити QR</a>
          <button class="btn btn-sm btn-ghost btn-danger" type="button" id="share-revoke">Вимкнути посилання</button>
        </div>
        <p class="hint">Після вимкнення старе посилання й QR-код перестануть працювати.</p>
      </div>
    </div>`;
}

/** Що робити з текстом, прочитаним із QR. */
function handleScanned(text, box) {
  const token = sharedTokenFrom(text);
  if (token) {
    closeDialog();
    toast('QR-код розпізнано — відкриваємо список');
    go(`#/shared?token=${encodeURIComponent(token)}`);
    return;
  }
  const isUrl = /^https?:\/\//i.test(text);
  setHtml(
    box,
    html`<div class="scan-result">
      <strong>Розпізнано QR-код</strong>
      <p>${text}</p>
      ${isUrl ? html`<a class="btn btn-sm" href="${text}" target="_blank" rel="noopener noreferrer">Відкрити посилання</a>` : ''}
      <p class="hint">Це не посилання на список у Знижколові.</p>
    </div>`
  );
}

export async function shareDialog() {
  const dialog = openDialog(html`
    <div class="dialog-body">
      <div><p class="muted">Мій список</p><h2>Поділитися</h2></div>
      <div class="segmented tabs" role="group" aria-label="Що зробити">
        <button type="button" data-tab="mine" aria-pressed="true">Мій список</button>
        <button type="button" data-tab="friend" aria-pressed="false">Список друга</button>
      </div>
      <section class="stack" data-panel="mine"><div class="skeleton" style="height: 120px"></div></section>
      <section class="stack" data-panel="friend" hidden>
        <p class="muted">Відскануй QR-код зі списком друга камерою або завантаж фото з кодом.</p>
        <div class="scan-box" hidden>
          <video aria-label="Зображення з камери"></video>
          <canvas class="scan-overlay" aria-hidden="true"></canvas>
          <span class="scan-hint">Наведи камеру на QR-код</span>
        </div>
        <div class="row">
          <button class="btn btn-primary" type="button" id="scan-start">Сканувати камерою</button>
          <button class="btn" type="button" id="scan-stop" hidden>Зупинити камеру</button>
        </div>
        ${dropZone({
          title: 'Або перетягни фото з QR-кодом',
          hint: `чи натисни, щоб вибрати. JPG, PNG або WEBP, до ${formatSize(PHOTO_MAX_BYTES)}`,
          accept: 'image/png,image/jpeg,image/webp',
        })}
        <div id="scan-result" aria-live="polite"></div>
      </section>
      <div class="dialog-foot"><button class="btn" type="button" data-close>Закрити</button></div>
    </div>
  `);

  let stopCamera = null;
  const stopScan = () => {
    stopCamera?.();
    stopCamera = null;
    // Після закриття вікна його вміст уже прибрано — тоді лише вимикаємо камеру
    const box = $('.scan-box', dialog);
    if (!box) return;
    box.hidden = true;
    $('#scan-start', dialog).hidden = false;
    $('#scan-stop', dialog).hidden = true;
  };
  // Камера вимикається, хоч би як закрили вікно (кнопкою, Esc чи кліком поза ним)
  dialog.addEventListener('close', stopScan, { once: true });
  $('[data-close]', dialog).addEventListener('click', closeDialog);

  dialog.querySelectorAll('[data-tab]').forEach((tab) =>
    tab.addEventListener('click', () => {
      dialog.querySelectorAll('[data-tab]').forEach((t) => t.setAttribute('aria-pressed', String(t === tab)));
      dialog.querySelectorAll('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== tab.dataset.tab));
      if (tab.dataset.tab !== 'friend') stopScan();
    })
  );

  // ---- Мій список ----
  const mine = $('[data-panel="mine"]', dialog);
  const drawMine = (token) => {
    setHtml(mine, minePanel(token));
    $('#share-create', mine)?.addEventListener('click', (e) =>
      withLoading(e.currentTarget, async () => drawMine((await post('/api/me/share')).token))
    );
    $('#share-copy', mine)?.addEventListener('click', async () => {
      const input = $('#share-link', mine);
      try {
        await navigator.clipboard.writeText(input.value);
        toast('Посилання скопійовано');
      } catch {
        input.select(); // без доступу до буфера — виділяємо, щоб скопіювати Ctrl+C
      }
    });
    $('#share-revoke', mine)?.addEventListener('click', async () => {
      try {
        drawMine((await del('/api/me/share')).token);
        toast('Посилання вимкнено');
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  };
  try {
    drawMine((await get('/api/me/share')).token);
  } catch (err) {
    setHtml(mine, html`<p class="form-error">${err.message}</p>`);
  }

  // ---- Список друга: камера або фото ----
  const resultBox = $('#scan-result', dialog);
  $('#scan-start', dialog).addEventListener('click', async (e) => {
    setHtml(resultBox, '');
    const box = $('.scan-box', dialog);
    box.hidden = false;
    await withLoading(e.currentTarget, async () => {
      try {
        stopCamera = await startCameraScan($('video', box), $('canvas', box), {
          onResult: (text) => {
            stopScan();
            handleScanned(text, resultBox);
          },
        });
        $('#scan-start', dialog).hidden = true;
        $('#scan-stop', dialog).hidden = false;
      } catch (err) {
        box.hidden = true;
        setHtml(resultBox, html`<p class="form-error">${err.message}</p>`);
      }
    });
  });
  $('#scan-stop', dialog).addEventListener('click', stopScan);

  bindDropZone($('.dropzone', dialog), {
    extensions: ['png', 'jpg', 'jpeg', 'webp'],
    maxBytes: PHOTO_MAX_BYTES,
    typeError: 'Це не схоже на фото. Вибери картинку JPG, PNG або WEBP',
    onFile: async (file) => {
      setHtml(resultBox, '');
      handleScanned(await decodeImageFile(file), resultBox);
    },
  });
}

// ---------- Сторінка списку друга ----------

function sharedCard(item, index) {
  const priced = item.offers.filter((o) => o.available && o.priceUah != null);
  const best = priced.sort((a, b) => a.priceUah - b.priceUah)[0] || item.offers[0];
  const discount = Math.max(0, ...priced.map((o) => o.discount || 0));
  return html`
    <article class="deal-card" data-title="${item.title}">
      <a class="deal-cover" href="${gameHref(best.store, best.storeId)}" tabindex="-1" aria-hidden="true">
        ${cover(item.imageUrl, item.title)}
        ${discount ? html`<span class="deal-badge">−${discount}%</span>` : ''}
      </a>
      <div class="deal-body">
        <div class="deal-meta">${item.offers.map((o) => html`<span class="store store-${o.store}">${STORE_NAMES[o.store]}</span>`)}</div>
        <h3 class="deal-title"><a href="${gameHref(best.store, best.storeId)}">${item.title}</a></h3>
        <div class="deal-foot">
          <div class="deal-prices">
            ${best.discount > 0 && best.basePriceUah ? html`<span class="price-old">${formatUah(best.basePriceUah)}</span>` : ''}
            <span class="price">${best.priceUah != null ? `${best.currency === 'USD' ? '≈ ' : ''}${formatUah(best.priceUah)}` : '—'}</span>
          </div>
          ${item.inMyList
            ? html`<span class="pill pill-good">У тебе в списку</span>`
            : html`<button class="btn btn-sm btn-primary" type="button" data-follow="${index}">Стежити</button>`}
        </div>
      </div>
    </article>`;
}

export async function render(root, params) {
  const token = String(params.token || '');
  const data = await get(`/api/shared/${encodeURIComponent(token)}`);
  document.title = `Список гравця ${data.owner.name} · Знижколов`;
  const n = data.items.length;
  const draw = () =>
    setHtml(
      root,
      html`
        <div class="page-head">
          <div>
            <p class="muted">${data.isMine ? 'Так твій список бачать друзі' : 'Список друга'}</p>
            <h1>Список гравця ${data.owner.name}</h1>
            <p>${n} ${plural(n, 'гра', 'гри', 'ігор')}, за ${plural(n, 'якою', 'якими', 'якими')} ${data.isMine ? 'ти стежиш' : `стежить ${data.owner.name}`}</p>
          </div>
          ${data.isMine ? html`<a class="btn" href="#/list">До мого списку</a>` : ''}
        </div>
        ${n
          ? html`<div class="deal-grid">${data.items.map(sharedCard)}</div>`
          : html`<div class="empty"><h2>Список поки порожній</h2><p>Тут з'являться ігри, щойно власник їх додасть.</p></div>`}
      `
    );
  draw();

  root.onclick = (e) => {
    const btn = e.target.closest('[data-follow]');
    if (!btn) return;
    if (!state.user) {
      toast('Створи акаунт або увійди, щоб стежити за цінами');
      return go('#/register');
    }
    const item = data.items[Number(btn.dataset.follow)];
    const offer = item.offers.find((o) => o.store === item.bestStore) || item.offers[0];
    openAddDialog({ ...offer, imageUrl: item.imageUrl }, {
      onAdded: () => {
        item.inMyList = true;
        draw();
      },
    });
  };
  return () => (root.onclick = null);
}
