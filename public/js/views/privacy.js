// Сторінка «Конфіденційність»: що Знижколов зберігає, навіщо, кому передає і як усе видалити.
// Текст довгий і цілісний, тому замість окремих фраз тут дві повні версії — українська й англійська.
import { state } from '../app.js';
import { getLang, t } from '../i18n.js';
import { html, setHtml } from '../ui.js';

const UK = () => html`
  <h1>Конфіденційність</h1>
  <p class="muted">Оновлено 18 жовтня 2026 року. Коротко й без юридичних хитрощів.</p>

  <h2>Що ми зберігаємо</h2>
  <ul>
    <li><b>Акаунт:</b> ім'я, електронна пошта і пароль. Пароль зберігається лише як хеш (scrypt із «сіллю») — його не бачить ніхто, навіть адміністратор.</li>
    <li><b>Твій список:</b> ігри, за якими ти стежиш, умови сповіщень і отримані сповіщення.</li>
    <li><b>Коментарі</b> до ігор, які ти пишеш.</li>
    <li><b>Якщо ти сам це додаси:</b> фото профілю, зв'язок із Telegram (номер чату), номер профілю Steam (після імпорту списку бажаного), посилання «Поділитися».</li>
    <li><b>Журнал безпеки:</b> входи, невдалі спроби входу (з IP-адресою), зміни пароля чи пошти — щоб помітити злом.</li>
  </ul>

  <h2>Що зберігається на твоєму пристрої</h2>
  <ul>
    <li>Одна cookie <code>zk_session</code> — лише щоб ти лишався в акаунті (до 30 днів). Жодних рекламних cookie чи лічильників.</li>
    <li>Вибрана тема (світла чи темна) і мова інтерфейсу.</li>
    <li>Копії сторінок, даних і обкладинок для роботи без інтернету. Дані акаунта з них видаляються, коли ти виходиш.</li>
  </ul>

  <h2>Кому ми щось передаємо</h2>
  <ul>
    <li><b>Нікому не продаємо і не показуємо рекламу.</b></li>
    <li>Ціни сервер дізнається в Steam, GOG, Epic Games і курс — у НБУ. Твоїх даних у цих запитах немає.</li>
    <li>Листи надсилає поштовий сервіс (Brevo або Resend): він отримує лише твою адресу й текст листа.</li>
    <li>Сповіщення в Telegram отримує лише твій чат, якщо ти його підключиш.</li>
    <li>Обкладинки ігор браузер завантажує прямо з серверів магазинів (як на їхніх сайтах), трейлери YouTube — у режимі без відстеження (youtube-nocookie).</li>
    <li>Публічним стає лише те, чим ти поділишся сам: за посиланням «Поділитися» видно твоє ім'я, назви ігор і ціни — без пошти й умов. Коментарі до ігор видно всім разом з твоїм ім'ям.</li>
  </ul>

  <h2>Твої права</h2>
  <ul>
    <li><b>Подивитися й завантажити</b> все, що ми про тебе знаємо: «Профіль» → «Мої дані».</li>
    <li><b>Змінити</b> ім'я, пошту, пароль, фото, умови й сповіщення — у профілі та списку.</li>
    <li><b>Вимкнути</b> листи, роздачі Epic і посилання «Поділитися» будь-коли.</li>
    <li><b>Видалити акаунт</b> назавжди: «Профіль» → «Видалення акаунта». Разом з ним зникають список, сповіщення, коментарі й фото, а в журналі безпеки твоя пошта замінюється на «видалений користувач».</li>
  </ul>

  <h2>Скільки зберігаємо</h2>
  <p>Дані акаунта — доки існує акаунт. Входи (сесії) — до 30 днів. Посилання з листів діють від години до трьох днів і спрацьовують лише раз.</p>

  <p class="hint">Питання щодо даних можна поставити адміністраторові сайту.</p>
`;

const EN = () => html`
  <h1>Privacy</h1>
  <p class="muted">Updated 18 October 2026. Short and without legal tricks.</p>

  <h2>What we store</h2>
  <ul>
    <li><b>Account:</b> name, email and password. The password is stored only as a hash (salted scrypt) — nobody can see it, not even the administrator.</li>
    <li><b>Your list:</b> the games you follow, your alert conditions and the alerts you received.</li>
    <li><b>Comments</b> you write on games.</li>
    <li><b>Only if you add it yourself:</b> profile photo, Telegram link (chat number), Steam profile number (after a wishlist import), the “Share” link.</li>
    <li><b>Security log:</b> sign-ins, failed sign-in attempts (with IP address), password or email changes — to spot a break-in.</li>
  </ul>

  <h2>What is stored on your device</h2>
  <ul>
    <li>One cookie, <code>zk_session</code>, only to keep you signed in (up to 30 days). No advertising cookies or trackers.</li>
    <li>Your chosen theme (light or dark) and interface language.</li>
    <li>Copies of pages, data and covers so the app works offline. Account data is removed from them when you sign out.</li>
  </ul>

  <h2>Who we share anything with</h2>
  <ul>
    <li><b>We sell nothing to anyone and show no ads.</b></li>
    <li>The server gets prices from Steam, GOG and Epic Games, and the exchange rate from the National Bank of Ukraine. These requests contain none of your data.</li>
    <li>Emails are sent by a mail service (Brevo or Resend): it receives only your address and the text of the email.</li>
    <li>Telegram alerts go only to your own chat, if you connect it.</li>
    <li>Your browser loads game covers straight from the stores' servers (just like on their sites), and YouTube trailers in no-tracking mode (youtube-nocookie).</li>
    <li>Only what you share becomes public: the “Share” link shows your name, game titles and prices — without your email or conditions. Comments on games are visible to everyone together with your name.</li>
  </ul>

  <h2>Your rights</h2>
  <ul>
    <li><b>View and download</b> everything we know about you: “Profile” → “My data”.</li>
    <li><b>Change</b> your name, email, password, photo, conditions and alerts — in your profile and list.</li>
    <li><b>Turn off</b> emails, Epic giveaways and the “Share” link at any time.</li>
    <li><b>Delete your account</b> for good: “Profile” → “Delete account”. Your list, alerts, comments and photo go with it, and in the security log your email is replaced with “deleted user”.</li>
  </ul>

  <h2>How long we keep it</h2>
  <p>Account data — for as long as the account exists. Sign-ins (sessions) — up to 30 days. Links in emails work from one hour to three days and only once.</p>

  <p class="hint">Questions about your data can be sent to the site administrator.</p>
`;

export function render(root) {
  setHtml(
    root,
    html`
      <article class="doc">
        ${getLang() === 'en' ? EN() : UK()}
        ${state.user ? html`<p><a class="btn" href="#/profile">${t('До профілю')}</a></p>` : html`<p><a class="btn" href="#/">${t('На головну')}</a></p>`}
      </article>
    `
  );
}
