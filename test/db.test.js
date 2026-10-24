// База даних недоступна: які помилки сервер вважає «база недоступна» і як база оживає,
// щойно файл полагодили. Окремий файл — окремий процес, тож тут можна вільно відкривати й закривати базу.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeDb, db, ensureDb, initDb, isDbOpen, isDbUnavailable } from '../server/db.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'znyzhkolov-db-'));
after(() => {
  closeDb();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const errorOf = (fn) => {
  try {
    fn();
  } catch (err) {
    return err;
  }
  assert.fail('Очікувалась помилка');
};

test('Пошкоджений файл бази: сервер не падає, запити отримують помилку «база недоступна»', () => {
  const file = path.join(tmp, 'broken.db');
  fs.writeFileSync(file, 'це не база даних, а просто текст, який хтось записав замість неї');
  const err = errorOf(() => initDb(file));
  assert.ok(isDbUnavailable(err), err.message);
  assert.equal(isDbOpen(), false);
  // Будь-який запит до бази тепер дає зрозумілу помилку, а не TypeError
  assert.ok(isDbUnavailable(errorOf(() => db.prepare('SELECT 1').get())));
  assert.equal(ensureDb(), false);

  // Файл полагодили (видалили пошкоджений — буде створено новий) — база оживає без перезапуску
  fs.rmSync(file);
  assert.equal(ensureDb(), true);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 0);
});

test('Звичайні помилки SQL не вважаються недоступністю бази', () => {
  initDb(path.join(tmp, 'ok.db'));
  db.prepare("INSERT INTO users (email, name, password_hash, role, created_at) VALUES ('a@b.ua', 'A', 'x', 'user', 'now')").run();
  const dup = errorOf(() =>
    db.prepare("INSERT INTO users (email, name, password_hash, role, created_at) VALUES ('a@b.ua', 'B', 'x', 'user', 'now')").run()
  );
  assert.match(dup.message, /UNIQUE/);
  assert.equal(isDbUnavailable(dup), false);
  assert.equal(isDbUnavailable(new Error('щось інше')), false);
});

test('Тека замість файлу бази (диск недоступний): помилка «не вдалося відкрити»', () => {
  const dir = path.join(tmp, 'folder.db');
  fs.mkdirSync(dir);
  const err = errorOf(() => initDb(dir));
  assert.ok(isDbUnavailable(err), err.message);
  assert.equal(isDbOpen(), false);
});
