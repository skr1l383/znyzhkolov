// Застосовує збережену тему до першого відображення сторінки, щоб не було «спалаху».
try {
  var saved = localStorage.getItem('zk-theme');
  if (saved === 'light' || saved === 'dark') document.documentElement.dataset.theme = saved;
} catch (e) {
  // localStorage може бути недоступний (приватний режим) — тоді тема як у системі
}
