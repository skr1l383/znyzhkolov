// Перевірка форматів файлів: ZIP, Excel, CSV, визначення типу файлу і розбір рядків імпорту.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createZip, readZip } from '../server/formats/zip.js';
import { parseXlsx, toXlsx } from '../server/formats/xlsx.js';
import { decodeText, parseCsv, toCsv } from '../server/formats/csv.js';
import { detectImage, detectTable } from '../server/formats/detect.js';
import { IMPORT_DEFAULT_DISCOUNT, parseImportRows, pickResult } from '../server/services/transfer.js';

test('ZIP: архів розпаковується в ті самі файли', () => {
  const big = 'Знижколов '.repeat(5000);
  const zip = createZip([
    { name: 'a.txt', data: 'привіт' },
    { name: 'папка/b.txt', data: big },
  ]);
  const files = readZip(zip);
  assert.equal(files.get('a.txt').toString('utf8'), 'привіт');
  assert.equal(files.get('папка/b.txt').toString('utf8'), big);
  assert.ok(zip.length < big.length / 10, 'дані стискаються');
});

test('ZIP: архів відкривається стандартною програмою Windows/Linux', (t) => {
  // tar з Windows 10+ і Linux уміє розпаковувати ZIP; якщо його немає — пропускаємо
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zk-zip-'));
  try {
    fs.writeFileSync(path.join(dir, 'test.zip'), createZip([{ name: 'hello.txt', data: 'hello from zip' }]));
    try {
      // У Windows беремо системний tar.exe: tar із Git Bash ZIP не розуміє
      const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
      execFileSync(tar, ['-xf', 'test.zip'], { cwd: dir, stdio: 'ignore' });
    } catch {
      return t.skip('tar не вміє розпаковувати ZIP у цій системі');
    }
    assert.equal(fs.readFileSync(path.join(dir, 'hello.txt'), 'utf8'), 'hello from zip');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ZIP: пошкоджений файл дає зрозумілу помилку', () => {
  assert.throws(() => readZip(Buffer.from('це не архів')), /пошкоджений|не ZIP/);
});

test('Excel: записаний файл читається назад без втрат', () => {
  const rows = [
    ['Назва', 'Ціна', 'Активна'],
    ['The Witcher 3: Wild Hunt', 1349, true],
    ['Гра з <тегами> & "лапками"', 99.5, false],
    ['', null, ''],
    ['Hades', 0, true],
  ];
  const buf = toXlsx(rows, { sheetName: 'Список', widths: [30, 10, 10] });
  assert.equal(detectTable(buf), 'xlsx');
  const back = parseXlsx(buf);
  assert.deepEqual(back[0], ['Назва', 'Ціна', 'Активна']);
  assert.deepEqual(back[1], ['The Witcher 3: Wild Hunt', '1349', 'так']);
  assert.deepEqual(back[2], ['Гра з <тегами> & "лапками"', '99.5', 'ні']);
  assert.deepEqual(back[3], []);
  assert.deepEqual(back[4], ['Hades', '0', 'так']);
});

test('Excel: читаються файли зі спільними рядками, як їх зберігає Microsoft Excel', () => {
  // Так виглядає файл, збережений справжнім Excel: текст у sharedStrings.xml, у клітинках — номери
  const xml = (s) => `<?xml version="1.0" encoding="UTF-8"?>${s}`;
  const buf = createZip([
    { name: '[Content_Types].xml', data: xml('<Types/>') },
    {
      name: 'xl/workbook.xml',
      data: xml('<workbook xmlns:r="r"><sheets><sheet name="Games" sheetId="1" r:id="rId3"/></sheets></workbook>'),
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: xml('<Relationships><Relationship Id="rId3" Type="worksheet" Target="worksheets/data.xml"/></Relationships>'),
    },
    {
      name: 'xl/sharedStrings.xml',
      data: xml('<sst><si><t>Назва</t></si><si><r><t>Stardew </t></r><r><t>Valley</t></r></si><si><t>Celeste &amp; Co</t></si></sst>'),
    },
    {
      name: 'xl/worksheets/data.xml',
      data: xml(
        '<worksheet><sheetData>' +
          '<row r="1"><c r="A1" t="s"><v>0</v></c></row>' +
          '<row r="2"><c r="A2" t="s"><v>1</v></c><c r="C2"><v>413150</v></c></row>' +
          '<row r="3"/>' +
          '<row r="4"><c r="A4" t="s"><v>2</v></c><c r="B4" s="1"/></row>' +
          '</sheetData></worksheet>'
      ),
    },
  ]);
  assert.deepEqual(parseXlsx(buf), [['Назва'], ['Stardew Valley', '', '413150'], [], ['Celeste & Co', '']]);
});

test('CSV: лапки, крапка з комою, переноси рядків і BOM', () => {
  const rows = [
    ['Назва', 'Ціна'],
    ['Гра; з роздільником', '1 299,50'],
    ['Гра з "лапками"', ''],
    ['Рядок\nз переносом', '5'],
  ];
  const text = toCsv(rows);
  assert.ok(text.startsWith('﻿'), 'BOM для Excel');
  assert.deepEqual(parseCsv(text), rows);
});

test('CSV: роздільник визначається автоматично, кодування Windows-1251 теж читається', () => {
  assert.deepEqual(parseCsv('title,price\nHades,515\n'), [['title', 'price'], ['Hades', '515']]);
  assert.deepEqual(parseCsv('Назва\tЦіна\r\nHades\t515'), [['Назва', 'Ціна'], ['Hades', '515']]);
  // «Гра» у Windows-1251
  const cp1251 = Buffer.from([0xc3, 0xf0, 0xe0, 0x3b, 0x31]);
  assert.equal(decodeText(cp1251), 'Гра;1');
});

test('Тип файлу визначається за вмістом, а не за назвою', () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  const jpg = Buffer.from('ffd8ffe000104a464946', 'hex');
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);
  assert.equal(detectImage(png).ext, 'png');
  assert.equal(detectImage(jpg).ext, 'jpg');
  assert.equal(detectImage(webp).ext, 'webp');
  assert.equal(detectImage(Buffer.from('<svg></svg>')), null, 'SVG не приймаємо: у ньому може бути скрипт');
  assert.equal(detectTable(Buffer.from('%PDF-1.7')), 'pdf');
  assert.equal(detectTable(Buffer.from('d0cf11e0a1b11ae1', 'hex')), 'xls');
  assert.equal(detectTable(png), 'image');
  assert.equal(detectTable(Buffer.from('Назва;Ціна')), 'csv');
  assert.equal(detectTable(Buffer.from([1, 0, 2, 0])), null);
});

test('Імпорт: стовпці знаходяться за заголовком, умови й посилання розбираються', () => {
  const [a, b, c] = parseImportRows([
    ['Назва', 'Steam ID', 'GOG ID', 'Ціна Steam, грн', 'Умова: знижка від, %', 'Умова: ціна до, грн', 'Сповіщати про безкоштовну роздачу', 'Посилання Steam'],
    ['Hades', '1145360', '', '515', '40', '', 'ні', ''],
    ['Celeste', '', '1207658707', '', '', '199,50', '', 'https://store.steampowered.com/app/504230/Celeste/'],
    ['Terraria', '', '', '', '150', 'дешево', '', ''],
  ]);
  assert.equal(a.line, 2);
  assert.equal(a.steamId, '1145360');
  assert.deepEqual(a.conditions, { min_discount: 40, max_price_uah: null, notify_free: 0, active: 1 });
  assert.equal(b.steamId, '504230', 'ID взято з посилання');
  assert.equal(b.gogId, '1207658707');
  assert.equal(b.conditions.max_price_uah, 19950);
  assert.equal(b.conditions.min_discount, null);
  assert.equal(c.conditions.min_discount, IMPORT_DEFAULT_DISCOUNT, 'некоректні умови замінено типовою');
  assert.equal(c.problems.length, 2);
});

test('Імпорт: простий список назв без заголовка і завеликий файл', () => {
  const entries = parseImportRows([['Hollow Knight'], [''], ['Stardew Valley']]);
  assert.deepEqual(entries.map((e) => [e.line, e.title]), [[1, 'Hollow Knight'], [3, 'Stardew Valley']]);
  assert.throws(() => parseImportRows([['Назва']]), /немає жодної гри/);
  assert.throws(() => parseImportRows(Array.from({ length: 60 }, (_, i) => [`Гра ${i}`])), /Забагато рядків/);
});

test('Імпорт: коротка назва знаходить основну гру, а не доповнення', () => {
  // Так відповідає справжній Steam: безкоштовний інструмент для модів має найкоротшу назву
  const results = [
    { title: 'The Witcher 3 REDkit', price: null },
    { title: 'The Witcher 3: Wild Hunt - Hearts of Stone', price: 17900 },
    { title: 'The Witcher 3: Wild Hunt', price: 134900 },
    { title: 'The Witcher 3: Wild Hunt - Blood and Wine', price: 33900 },
  ];
  assert.equal(pickResult('Witcher 3', results).title, 'The Witcher 3: Wild Hunt');
  assert.equal(pickResult('Hades', [{ title: 'Hades II' }]), null, 'іншу частину серії не підставляємо');
  const cyberpunk = [
    { title: 'Cyberpunk SFX', price: 4400 },
    { title: 'Cyberpunk 2077', price: 139900 },
  ];
  assert.equal(pickResult('Cyberpunk', cyberpunk).title, 'Cyberpunk 2077', '2077 — частина назви, а не номер');
  assert.equal(pickResult('Disco Elysium', [{ title: 'Disco Elysium - The Final Cut', price: 1 }]).title, 'Disco Elysium - The Final Cut');
});
