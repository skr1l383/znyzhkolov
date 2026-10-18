// QR-коди: те, що згенерував наш код, має розпізнати незалежна бібліотека jsQR (та сама, що в браузері).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { qrMatrix, qrSvg } from '../server/formats/qr.js';

// jsQR — файл для браузера в старому форматі модулів; підключаємо його так само, як браузер: просто виконуємо
const jsQR = (() => {
  const module = { exports: {} };
  new Function('module', 'exports', fs.readFileSync(new URL('../public/vendor/jsQR.js', import.meta.url), 'utf8'))(module, module.exports);
  return module.exports;
})();

/** Матриця → «фото» RGBA: кожен модуль 4×4 пікселі плюс біла рамка, як на екрані телефона. */
function render(modules, scale = 4, margin = 4) {
  const size = (modules.length + margin * 2) * scale;
  const pixels = new Uint8ClampedArray(size * size * 4).fill(255);
  modules.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (!dark) return;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const i = (((y + margin) * scale + dy) * size + (x + margin) * scale + dx) * 4;
          pixels[i] = pixels[i + 1] = pixels[i + 2] = 0;
        }
      }
    })
  );
  return { pixels, size };
}

const decode = (text, level) => {
  const { pixels, size } = render(qrMatrix(text, { level }));
  return jsQR(pixels, size, size)?.data;
};

test('QR: посилання на список друга розпізнається', () => {
  const link = 'https://znyzhkolov.example/#/shared?token=Zk3vQ9mP2xLr8tYw';
  assert.equal(decode(link, 'M'), link);
});

test('QR: тексти різної довжини (версії 1–14) і всі рівні захисту', () => {
  for (const level of ['L', 'M', 'Q', 'H']) {
    for (const len of [1, 7, 17, 25, 40, 60, 90, 120, 160, 200, 260, 300]) {
      const text = 'Знижколов-'.repeat(40).slice(0, len);
      assert.equal(decode(text, level), text, `рівень ${level}, ${len} символів`);
    }
  }
});

test('QR: розмір зростає разом із текстом, SVG містить «тиху зону»', () => {
  assert.equal(qrMatrix('a').length, 21, 'версія 1 — 21×21 модуль');
  assert.ok(qrMatrix('x'.repeat(100)).length > 21);
  const svg = qrSvg('hello', { margin: 4 });
  assert.match(svg, /^<svg[^>]+viewBox="0 0 29 29"/, '21 модуль + по 4 з кожного боку');
  assert.throws(() => qrMatrix('x'.repeat(5000)), /задовгий/);
});
