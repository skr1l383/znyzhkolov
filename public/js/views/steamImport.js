// Імпорт списку бажаного Steam: посилання на профіль → ігри з цінами і галочками → стежити за вибраними.
import { get, post } from '../api.js';
import { state } from '../app.js';
import { $, $$, clearFormErrors, closeDialog, formatDate, formatUah, html, openDialog, setHtml, showFormError, toast, withLoading } from '../ui.js';
import { t, tp } from '../i18n.js';

const CONDITIONS = [
  ['', 'будь-яка знижка'],
  ['30', 'знижка від 30%'],
  ['50', 'знижка від 50%'],
  ['75', 'знижка від 75%'],
];

function itemRow(item, index) {
  const price = item.comingSoon
    ? html`<span class="muted">${t('ще не вийшла')}</span>`
    : item.price == null
      ? html`<span class="muted">${t('ціни немає')}</span>`
      : html`${item.discount > 0 ? html`<span class="discount">−${item.discount}%</span> ` : ''}<b>${item.price === 0 ? t('Безкоштовно') : formatUah(item.price)}</b>`;
  return html`
    <label class="wish-row ${item.inList ? 'in-list' : ''}">
      <input type="checkbox" data-i="${index}" ${item.inList ? html`disabled` : html`checked`} />
      <img src="${item.imageUrl || ''}" alt="" loading="lazy" />
      <span class="wish-title">
        <b>${item.title}</b>
        ${item.inList
          ? html`<span class="hint">${t('уже у твоєму списку')}</span>`
          : item.discount > 0 && item.discountEndsAt
            ? html`<span class="hint">${t('знижка до {date}', { date: formatDate(item.discountEndsAt) })}</span>`
            : ''}
      </span>
      <span class="wish-price">${price}</span>
    </label>`;
}

export function steamImportDialog(onImported) {
  const dialog = openDialog(html`
    <form class="dialog-body" novalidate id="wish-step1">
      <div><p class="muted">${t('Мій список')}</p><h2>${t('Імпорт зі Steam')}</h2></div>
      <p class="muted">
        ${t('Встав посилання на свій профіль Steam — покажемо твій список бажаного з поточними цінами, і ти одним натисканням почнеш стежити за знижками на всі ці ігри.')}
      </p>
      <div class="form-error" role="alert" hidden></div>
      <div class="field">
        <label for="wish-profile">${t('Профіль Steam')}</label>
        <input class="input" id="wish-profile" name="profile" placeholder="https://steamcommunity.com/id/${t('твоє-ім’я')}"
          value="${state.user?.steamId ? `https://steamcommunity.com/profiles/${state.user.steamId}` : ''}" autocomplete="off" required />
        <span class="hint">
          ${t('Де взяти: у Steam натисни на своє ім’я → «Профіль» і скопіюй адресу сторінки.')}
          ${t('Список бажаного має бути відкритим: «Редагувати профіль» → «Приватність» → «Інформація про ігри: Відкрита».')}
        </span>
      </div>
      <div id="wish-help" aria-live="polite"></div>
      <div class="dialog-foot">
        <button class="btn" type="button" data-close>${t('Скасувати')}</button>
        <button class="btn btn-primary" type="submit">${t('Показати список')}</button>
      </div>
    </form>
  `);
  $('[data-close]', dialog).addEventListener('click', closeDialog);
  const form = $('#wish-step1', dialog);
  form.elements.profile.focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await withLoading($('button[type="submit"]', form), async () => {
      try {
        const data = await get(`/api/steam/wishlist?profile=${encodeURIComponent(form.elements.profile.value.trim())}`);
        if (state.user) state.user.steamId = data.profile.steamId;
        showList(dialog, data, onImported);
      } catch (err) {
        if (err.details?.code !== 'wishlist_hidden') {
          setHtml($('#wish-help', form), '');
          showFormError(form, err);
          return;
        }
        // Steam однаково відповідає і на порожній, і на прихований список — підказуємо, що перевірити
        clearFormErrors(form);
        setHtml(
          $('#wish-help', form),
          html`<div class="wish-help">
            <strong>${err.message}</strong>
            <ol>
              <li>
                ${t('Відкрий')} <a href="https://steamcommunity.com/my/edit/settings" target="_blank" rel="noopener noreferrer">${t('налаштування приватності Steam')}</a>
                ${t('(там треба бути в акаунті Steam).')}
              </li>
              <li>
                ${err.details.profilePublic ? t('«Мій профіль» уже відкритий ✓.') : t('«Мій профіль» → Відкритий.')}
                ${t('Нижче «Інформація про ігри» (англійською Game details) → Відкрита. Саме цей пункт відкриває список бажаного.')}
              </li>
              <li>${t('Перевір, що у твоєму')} <a href="https://store.steampowered.com/wishlist/" target="_blank" rel="noopener noreferrer">${t('списку бажаного')}</a> ${t('справді є ігри.')}</li>
              <li>${t('Steam застосовує зміни приватності не одразу — зачекай 2–5 хвилин і натисни «Показати список» ще раз.')}</li>
            </ol>
          </div>`
        );
      }
    });
  });
}

function showList(dialog, data, onImported) {
  const { profile, items, total } = data;
  const available = items.filter((i) => !i.inList);
  setHtml(
    dialog,
    html`
      <div class="dialog-body">
        <div class="wish-profile">
          ${profile.avatar ? html`<img src="${profile.avatar}" alt="" />` : ''}
          <div>
            <p class="muted">${t('Список бажаного Steam')}</p>
            <h2>${profile.name}</h2>
            <p class="hint">
              ${total} ${tp(total, 'гра', 'гри', 'ігор')}${total > items.length ? `, ${t('показано {n}', { n: items.length })}` : ''}
              · ${t('зі знижкою зараз: {n}', { n: items.filter((i) => i.discount > 0).length })}
            </p>
          </div>
        </div>
        <div class="wish-tools">
          <label class="check"><input type="checkbox" id="wish-all" ${available.length ? 'checked' : 'disabled'} /><span>${t('Вибрати всі')}</span></label>
          <label class="wish-cond">${t('Сповістити, коли')}
            <select class="select" id="wish-cond">
              ${CONDITIONS.map(([v, label]) => html`<option value="${v}" ${v === '50' ? 'selected' : ''}>${t(label)}</option>`)}
            </select>
          </label>
        </div>
        <div class="wish-list">${items.map(itemRow)}</div>
        <div class="dialog-foot">
          <button class="btn" type="button" data-close>${t('Скасувати')}</button>
          <button class="btn btn-primary" type="button" id="wish-import"></button>
        </div>
      </div>
    `
  );
  $('[data-close]', dialog).addEventListener('click', closeDialog);
  const boxes = () => $$('.wish-list input[data-i]:not(:disabled)', dialog);
  const importBtn = $('#wish-import', dialog);
  const update = () => {
    const n = boxes().filter((b) => b.checked).length;
    importBtn.textContent = n ? t('Стежити за {n} {games}', { n, games: tp(n, 'грою', 'іграми', 'іграми') }) : t('Вибери ігри');
    importBtn.disabled = !n;
    const all = $('#wish-all', dialog);
    all.checked = n === boxes().length && n > 0;
    all.indeterminate = n > 0 && n < boxes().length;
  };
  $('#wish-all', dialog).addEventListener('change', (e) => {
    boxes().forEach((b) => (b.checked = e.target.checked));
    update();
  });
  $('.wish-list', dialog).addEventListener('change', update);
  update();

  importBtn.addEventListener('click', () =>
    withLoading(importBtn, async () => {
      const appids = boxes()
        .filter((b) => b.checked)
        .map((b) => items[Number(b.dataset.i)].storeId);
      try {
        const result = await post('/api/steam/wishlist/import', { appids, minDiscount: $('#wish-cond', dialog).value || null });
        setHtml(
          dialog,
          html`<div class="dialog-body">
            <h2>${t('Готово!')}</h2>
            <p>${t('Тепер ти стежиш за {n} {games} зі свого списку бажаного.', { n: result.added.length, games: tp(result.added.length, 'грою', 'іграми', 'іграми') })}</p>
            ${result.skipped.length ? html`<p class="muted">${t('Пропущено:')} ${result.skipped.map((s) => `${s.title} (${t(s.reason)})`).join(', ')}.</p>` : ''}
            <p class="hint">${t('Ці ж ігри в GOG шукаємо у фоні — за кілька хвилин у списку з’являться й ціни GOG для порівняння.')}</p>
            <div class="dialog-foot"><button class="btn btn-primary" type="button" data-close>${t('До мого списку')}</button></div>
          </div>`
        );
        $('[data-close]', dialog).addEventListener('click', closeDialog);
        if (result.added.length) onImported();
      } catch (err) {
        toast(err.message, 'error');
      }
    })
  );
}
