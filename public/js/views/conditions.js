// Спільна частина форми: умови, за яких надсилати сповіщення.
import { formatUah, html } from '../ui.js';

const DISCOUNTS = [10, 20, 25, 30, 40, 50, 60, 70, 75, 80, 90];

export function conditionsFields(values = {}) {
  const min = values.minDiscount ?? '';
  const price = values.maxPriceUah != null ? values.maxPriceUah / 100 : '';
  const options = [
    { value: '', label: 'Не важливо' },
    { value: 1, label: 'Будь-яка знижка' },
    ...DISCOUNTS.map((d) => ({ value: d, label: `від ${d}%` })),
  ];
  if (min !== '' && !options.some((o) => o.value === min)) options.push({ value: min, label: `від ${min}%` });

  return html`
    <div class="cond-grid">
      <div class="field">
        <label for="cond-discount">Знижка</label>
        <select class="select" id="cond-discount" name="minDiscount">
          ${options.map(
            (o) => html`<option value="${o.value}" ${String(o.value) === String(min) ? 'selected' : ''}>${o.label}</option>`
          )}
        </select>
      </div>
      <div class="field">
        <label for="cond-price">Ціна до</label>
        <div class="input-suffix">
          <input class="input num" id="cond-price" name="maxPriceUah" type="number" min="0" step="1" inputmode="numeric"
            placeholder="наприклад, 300" value="${price}" />
          <span>₴</span>
        </div>
      </div>
    </div>
    <label class="check">
      <input type="checkbox" name="notifyFree" ${values.notifyFree === false ? '' : 'checked'} />
      <span>Повідомити, якщо гру роздають безкоштовно</span>
    </label>
    <p class="hint">Сповіщення прийде, коли виконається хоча б одна умова в будь-якому з підключених магазинів.</p>
  `;
}

export function readConditions(form) {
  const min = form.elements.minDiscount.value;
  const price = form.elements.maxPriceUah.value.trim();
  return {
    minDiscount: min === '' ? null : Number(min),
    maxPriceUah: price === '' ? null : price,
    notifyFree: form.elements.notifyFree.checked,
  };
}

/** Короткий опис умов: «знижка від 30% · ціна до 500 ₴ · роздача». */
export function conditionsText(item) {
  const parts = [];
  if (item.minDiscount === 1) parts.push('будь-яка знижка');
  else if (item.minDiscount != null) parts.push(`знижка від ${item.minDiscount}%`);
  if (item.maxPriceUah != null) parts.push(`ціна до ${formatUah(item.maxPriceUah)}`);
  if (item.notifyFree) parts.push('безкоштовна роздача');
  return parts.join(' · ');
}
