// Перевірка даних, що приходять від браузера. Помилки повертаються з полем,
// щоб інтерфейс міг підсвітити саме те поле, яке заповнено неправильно.
import { HttpError } from './http.js';

export function fieldError(field, message) {
  return new HttpError(400, message, { field });
}

export function text(value, { field, label, min = 0, max = 200, required = true }) {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s) {
    if (required) throw fieldError(field, `Заповніть поле «${label}»`);
    return '';
  }
  if (s.length < min) throw fieldError(field, `Поле «${label}» має містити щонайменше ${min} символів`);
  if (s.length > max) throw fieldError(field, `Поле «${label}» має містити не більше ${max} символів`);
  return s;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function email(value) {
  const s = text(value, { field: 'email', label: 'Електронна пошта', max: 120 }).toLowerCase();
  if (!EMAIL_RE.test(s)) throw fieldError('email', 'Введіть правильну адресу пошти, наприклад name@gmail.com');
  return s;
}

export function password(value) {
  const s = typeof value === 'string' ? value : '';
  if (!s) throw fieldError('password', 'Заповніть поле «Пароль»');
  if (s.length < 8) throw fieldError('password', 'Пароль має містити щонайменше 8 символів');
  if (s.length > 100) throw fieldError('password', 'Пароль занадто довгий');
  return s;
}

/** Ціле число в межах або null, якщо поле порожнє. */
export function optionalInt(value, { field, label, min, max }) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || Math.round(n) !== n) throw fieldError(field, `«${label}» має бути цілим числом`);
  if (n < min || n > max) throw fieldError(field, `«${label}» має бути від ${min} до ${max}`);
  return n;
}

export function optionalMoney(value, { field, label, max = 100000 }) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(String(value).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) throw fieldError(field, `«${label}» має бути додатним числом`);
  if (n > max) throw fieldError(field, `«${label}» не може бути більше ${max}`);
  return Math.round(n * 100); // у копійках
}

export function id(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(404, 'Не знайдено');
  return n;
}
