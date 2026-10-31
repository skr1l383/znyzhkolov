// Переклад того, що сервер надсилає користувачу (листи, Telegram, сповіщення на сайті), на мову з його профілю.
// Як і на сайті (public/js/i18n.js), ключ — український текст, {name} — місце для значення.
// Тест test/i18n.test.js перевіряє, що в кожного tr(lang, '…') є англійський переклад.

const EN = {
  Знижколов: 'Znyzhkolov',

  // Сповіщення про знижки (notifier.js)
  'знижка від {n}%': 'discount of {n}% or more',
  'ціна до {price}': 'price up to {price}',
  'безкоштовна роздача': 'free giveaway',
  ' або ': ' or ',
  '{seller} (ключ Steam)': '{seller} (Steam key)',
  '{store}: безкоштовно (було {price})': '{store}: free (was {price})',
  '{game}: безкоштовно в {store}!': '{game}: free on {store}!',
  '{game}: {price} у {store}{sale}': '{game}: {price} on {store}{sale}',
  'Історичний мінімум: дешевше не було з {date}.': 'Historical low: not this cheap since {date}.',
  'Твоя умова: {condition}': 'Your condition: {condition}',
  'Інші магазини: {list}.': 'Other stores: {list}.',
  'Відкрити в {store}': 'Open on {store}',
  'Відкрити в магазині': 'Open in store',
  'Забрати в Epic Games': 'Claim on Epic Games',
  'Ти отримав цей лист, бо стежиш за цінами в Знижколові. Вимкнути листи можна в профілі: {url}':
    'You received this email because you track prices on Znyzhkolov. You can turn emails off in your profile: {url}',

  // Роздачі Epic (epicFree.js)
  'Epic Games роздає {title} безкоштовно': 'Epic Games is giving away {title} for free',
  'Забрати можна до {date}{price}.': 'Claim it until {date}{price}.',
  ' (зазвичай {price})': ' (usually {price})',
  'безкоштовно в Epic Games': 'free on Epic Games',
  'До {date}': 'Until {date}',

  // Тестове сповіщення (routes/profile.js)
  'Тестове сповіщення': 'Test notification',
  'Якщо ти це бачиш, усе налаштовано правильно.': 'If you can see this, everything is set up correctly.',

  // Шаблон листа (mailer.js)
  'Якщо кнопка не працює, скопіюй посилання в браузер:': 'If the button does not work, copy this link into your browser:',
  'Цей лист надіслав Знижколов — сервіс стеження за знижками на ігри.': 'This email was sent by Znyzhkolov, a game deal tracker.',

  // Підтвердження пошти й відновлення пароля (routes/auth.js)
  'Підтверди пошту, {name}': 'Confirm your email, {name}',
  'Дякуємо за реєстрацію в Знижколові! Натисни кнопку, щоб підтвердити, що це твоя пошта.':
    'Thanks for signing up for Znyzhkolov! Press the button to confirm this is your email.',
  'Після цього ми зможемо надсилати тобі сповіщення про знижки і, якщо знадобиться, допомогти відновити пароль.':
    'After that we can send you deal alerts and, if needed, help you reset your password.',
  'Підтвердити пошту': 'Confirm email',
  'Посилання діє 3 дні. Якщо ти не реєструвався в Знижколові, просто проігноруй цей лист.':
    'The link is valid for 3 days. If you did not sign up for Znyzhkolov, just ignore this email.',
  'Підтвердь пошту в Знижколові': 'Confirm your email for Znyzhkolov',
  'Відновлення пароля': 'Password reset',
  'Привіт, {name}! Хтось (сподіваємось, ти) попросив змінити пароль до Знижколова.':
    'Hi, {name}! Someone (hopefully you) asked to change the password for Znyzhkolov.',
  'Натисни кнопку й вигадай новий пароль.': 'Press the button and choose a new password.',
  'Змінити пароль': 'Change password',
  'Посилання діє годину і спрацює лише один раз. Якщо ти не просив змінити пароль, нічого не роби — старий пароль працює.':
    'The link is valid for an hour and works only once. If you did not ask to change your password, do nothing: your old password still works.',
  'Відновлення пароля в Знижколові': 'Password reset for Znyzhkolov',

  // Листи про зміни в акаунті (routes/account.js)
  'Привіт, {name}! {text}': 'Hi, {name}! {text}',
  'Якщо це зробив не ти — одразу зміни пароль через «Забули пароль?» на сторінці входу.':
    'If this was not you, change your password right away via “Forgot password?” on the sign-in page.',
  'Відкрити Знижколов': 'Open Znyzhkolov',
  'Пароль змінено': 'Password changed',
  'Пароль до твого акаунта щойно змінили. На інших пристроях виконано вихід.':
    'The password for your account was just changed. You have been signed out on other devices.',
  'Пошту акаунта змінено': 'Account email changed',
  'Пошту твого акаунта змінили з {from} на {to}.': 'Your account email was changed from {from} to {to}.',

  // Telegram-бот (telegram.js)
  '<b>Знижколов</b> стежить за цінами на ігри в Steam, GOG та роздачами Epic Games.':
    '<b>Znyzhkolov</b> tracks game prices on Steam and GOG and Epic Games giveaways.',
  '/list — мій список ігор і поточні ціни': '/list — my games and current prices',
  '/free — що зараз роздають безкоштовно в Epic': '/free — what Epic is giving away right now',
  '/stop — відключити сповіщення в Telegram': '/stop — turn off Telegram alerts',
  '/help — ця довідка': '/help — this help',
  'Мій список ігор і ціни': 'My games and prices',
  'Безкоштовні роздачі Epic': 'Epic free games',
  'Вимкнути сповіщення': 'Turn off alerts',
  Довідка: 'Help',
  'Знижки на ігри в Steam, GOG і Epic Games, ціни в гривнях. Сайт: {site}': 'Game deals on Steam, GOG and Epic Games, prices in hryvnias. Site: {site}',
  'Знижколов стежить за цінами на ігри в Steam, GOG і роздачами Epic Games та пише, коли гра з твого списку подешевшає.':
    'Znyzhkolov tracks game prices on Steam and GOG and Epic Games giveaways, and messages you when a game from your list gets cheaper.',
  'Додай ігри на сайті {site}, а потім у профілі натисни «Підключити Telegram».':
    'Add games on {site}, then press “Connect Telegram” in your profile.',
  'Твій список порожній. Додай ігри на сайті, і я повідомлю про знижки.': 'Your list is empty. Add games on the site and I will tell you about deals.',
  'ціна ще невідома': 'price not known yet',
  'Твій список ({n})': 'Your list ({n})',
  'Зараз даних про роздачі Epic немає. Спробуй пізніше.': 'There is no data on Epic giveaways right now. Try again later.',
  '— безкоштовно до {date}': '— free until {date}',
  '— буде безкоштовно з {date}': '— free from {date}',
  'Готово, {name}! Тепер сповіщення про знижки приходитимуть сюди.': 'Done, {name}! Deal alerts will now arrive here.',
  'Код не підійшов або вже використаний. Онови сторінку профілю на сайті й натисни «Підключити Telegram» ще раз.':
    'The code did not work or was already used. Reload your profile page on the site and press “Connect Telegram” again.',
  'Привіт, {name}! Акаунт уже підключено.': 'Hi, {name}! Your account is already connected.',
  'Привіт! Щоб отримувати сповіщення, відкрий на сайті сторінку «Профіль» і натисни «Підключити Telegram».':
    'Hi! To get alerts, open the “Profile” page on the site and press “Connect Telegram”.',
  'Спочатку підключи акаунт: сайт → «Профіль» → «Підключити Telegram».': 'Connect your account first: site → “Profile” → “Connect Telegram”.',
  'Сповіщення вимкнено. Підключити знову можна на сайті в профілі.': 'Alerts are off. You can connect again in your profile on the site.',
  'Не знаю такої команди.': 'I do not know this command.',

  // ШІ-порадник (advisor.js)
  'Купувати цю гру зараз чи чекати знижки?': 'Should I buy this game now or wait for a sale?',
  'Не можу допомогти з цим. Спитай мене про ціну чи знижки на гру.': 'I cannot help with that. Ask me about the price or discounts on the game.',

  // Синхронізація з бажаним Steam (steamSync.js)
  'Нові ігри з бажаного Steam: {n}': 'New games from your Steam wishlist: {n}',
  'Тепер стежимо й за ними: {list}.': 'We are now tracking them too: {list}.',

  // Тижневий дайджест (digest.js)
  безкоштовно: 'free',
  'Тижневий дайджест Знижколова': 'Znyzhkolov weekly digest',
  'Зі знижкою зараз {n} з твого списку ({total} у стеженні), можна заощадити {sum}.': 'On sale now: {n} from your list ({total} tracked), you can save {sum}.',
  'Цього тижня жодна гра з твого списку ({total}) не має знижки — продовжуємо стежити.': 'No game from your list ({total}) is on sale this week — we keep watching.',
  'умову виконано': 'condition met',
  'З твого списку': 'From your list',
  'Найкращі знижки тижня': 'Best deals of the week',
  'Безкоштовно в Epic Games': 'Free on Epic Games',
  'Відкрити мій список': 'Open my list',
};

/** Мова користувача для листів і повідомлень: англійська, якщо він вибрав її на сайті, інакше українська. */
export const userLang = (user) => (user?.lang === 'en' ? 'en' : 'uk');

/** Локаль для дат: «5 листопада» або «5 November». */
export const dateLocale = (lang) => (lang === 'en' ? 'en-GB' : 'uk-UA');

export function tr(lang, text, vars = {}) {
  const template = lang === 'en' ? (EN[text] ?? text) : text;
  return template.replace(/\{(\w+)\}/g, (m, key) => (key in vars ? String(vars[key]) : m));
}

export const hasEnglish = (text) => text in EN;
