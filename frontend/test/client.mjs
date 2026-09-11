/**
 * Interactive client check (jsdom + real Worker on in-memory D1).
 *
 * SSR can't run `onMounted`, so this file mounts the real app in a DOM and
 * drives it the way a user would: sign in, navigate, search, filter, open the
 * dialog, submit, delete through the confirm step, toggle the theme, flip the
 * landing page off, drive the custom select, configure channels, save settings.
 *
 * Run via: npm run test:render  (uses --import ./test/jsdom-env.mjs)
 */
import assert from 'node:assert/strict';
import { createApp, nextTick } from 'vue';
import { createMemoryHistory } from 'vue-router';

import App from '../src/App.vue';
import { createAppRouter } from '../src/router.js';
import { api } from '../src/api.js';
import { createSubscription, disableBrowserPush, enableBrowserPush, ensureSession, loadPublicConfig, state } from '../src/store.js';
import { dialogState } from '../src/lib/dialog.js';
import worker from '../../worker/src/index.js';
import schemaSql from '../../worker/schema.sql?raw';
import seedSql from '../../worker/seed.sql?raw';
import { createD1 } from '../../worker/test/d1-shim.mjs';
import { addCycles, addDays, todayIn } from '../../worker/src/utils.js';

const TZ = 'Asia/Shanghai';
const TODAY = todayIn(TZ);
const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'correct-horse-battery';

/* ------------------------------------------------ real worker, in-memory D1 */
const db = createD1();
db._sqlite.exec(schemaSql);
db._sqlite.exec(seedSql);
const env = {
  DB: db,
  ALLOWED_ORIGIN: '*',
  ADMIN_USERNAME,
  ADMIN_PASSWORD,
  AUTH_SECRET: 'test-signing-key',
};

/** Any outbound request the Worker makes (Telegram/Resend/webhook) is stubbed. */
const stubResponse = () =>
  new Response(JSON.stringify({ ok: true, id: 'stub' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

globalThis.fetch = async (input, init = {}) => {
  const target = typeof input === 'string' ? input : input.url;
  if (/^https?:\/\//i.test(target) && !target.startsWith('http://localhost')) return stubResponse();
  const { pathname, search } = new URL(target, 'http://localhost');
  return worker.fetch(
    new Request(`http://localhost${pathname}${search}`, {
      method: init.method ?? 'GET',
      headers: init.headers,
      body: init.body,
    }),
    env,
  );
};

/* ------------------------------------------------------------------ harness */
let passed = 0;
function check(label, condition) {
  assert.ok(condition, `FAIL: ${label}`);
  passed += 1;
  console.log(`  ✓ ${label}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Let Vue flush, promises settle, and rAF-driven transitions advance. */
async function flush(rounds = 12) {
  for (let i = 0; i < rounds; i += 1) {
    await nextTick();
    // A real tick (not just setTimeout(0)) so <Transition mode="out-in"> finishes.
    await sleep(i % 2 === 0 ? 20 : 0);
  }
}

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function setValue(element, value) {
  element.value = value;
  element.dispatchEvent(new window.Event('input', { bubbles: true }));
  element.dispatchEvent(new window.Event('change', { bubbles: true }));
}

function click(selector) {
  const element = $(selector);
  assert.ok(element, `FAIL: no element matches ${selector}`);
  element.click();
}

function buttonByText(scope, text) {
  return $$(`${scope} .btn`).find((button) => button.textContent.includes(text));
}

function btn(text) {
  return $$('.btn').find((button) => button.textContent.includes(text));
}

function rows() {
  return $$('tbody tr').map((row) => row.textContent.replace(/\s+/g, ' ').trim());
}

function channelCard(label) {
  return $$('.channel').find((card) => card.querySelector('.channel__title .strong')?.textContent.trim() === label);
}

async function go(path) {
  await router.push(path);
  await flush();
}

// The real router (routes + guard) over a memory history.
const router = createAppRouter(createMemoryHistory());

async function main() {
  console.log('\nFront-end interaction check (jsdom)\n');

  const app = createApp(App);
  app.use(router);
  await router.isReady();
  app.mount('#app');
  await flush();

  console.log('front door');
  await go('/');
  check('signed-out root falls back to the login screen when the landing page is off', router.currentRoute.value.name === 'login');
  check('the login screen hides the app chrome', !$('.brand__name'));

  console.log('login gate');
  await go('/login');
  check('login screen renders', Boolean($('#login-user')) && Boolean($('#login-pass')));
  check('app chrome is hidden on the login screen', !$('.brand__name'));
  check('workspace stays empty while signed out', state.ready === false && state.subscriptions.length === 0);

  $('.login__form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await flush();
  check('empty submit is rejected', $('.login__error')?.textContent.includes('请输入用户名和密码'));

  setValue($('#login-user'), ADMIN_USERNAME);
  setValue($('#login-pass'), 'wrong-password');
  $('.login__form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await flush(20);
  check('wrong credentials surface the server message', $('.login__error')?.textContent.includes('用户名或密码错误'));
  check('a rejected login keeps the user on /login', router.currentRoute.value.name === 'login');

  setValue($('#login-pass'), ADMIN_PASSWORD);
  $('.login__form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await flush(20);
  await sleep(30);
  await flush(20);
  check('valid credentials open the dashboard', router.currentRoute.value.name === 'dashboard');
  check('session is stored', state.auth.authenticated === true && state.auth.username === ADMIN_USERNAME);
  check('bearer token is persisted', Boolean(localStorage.getItem('subtrack-token')));
  check('session restores from the stored token (page reload)', (await ensureSession({ force: true })) === true && state.auth.authenticated === true);

  console.log('\nmount + bootstrap');
  check('app mounts and renders the nav', Boolean($('.nav__inner')));
  check('the title bar names the current page', $('.brand__name')?.textContent.trim() === '概览');
  check('app pages drop the brand mark', !$('.brand__mark'));
  check('app pages drop the footer', !$('.footer'));
  await go('/bills');
  check('the title bar follows the route', $('.brand__name')?.textContent.trim() === '账单');
  await go('/subscriptions');
  check('the title bar updates again', $('.brand__name')?.textContent.trim() === '订阅');
  await go('/dashboard');
  check('overview renders the same compact header as the other pages', $('.page__title')?.textContent.trim() === '概览');
  check('no landing hero on the overview', !$('.mesh__blob--develop'));
  check('5 nav links are present', $$('.nav__link').length === 5);
  check('the overview entry points at /dashboard', $$('.nav__link')[0].textContent.trim() === '概览' && $$('.nav__link')[0].getAttribute('href') === '/dashboard');
  check('nav links to the bills page', $$('.nav__link').some((link) => link.textContent.trim() === '账单'));
  check('stats hydrated from the Worker', state.stats.counts.total === 7);
  check('stays within budget with the seeded allowance', !$('.nav__alert'));
  check('remaining allowance is positive', state.stats.budget.remaining > 0);

  console.log('\ndashboard content');
  check('recent table fetched on mount', rows().length === 6);
  check('recent table shows a seeded subscription', rows().some((row) => row.includes('Netflix 高级版')));
  check('upcoming panel lists the expiring item', $('.upcoming')?.textContent.includes('Netflix 高级版'));
  check('category breakdown is rendered', $$('.categories__row').length === 5);
  check('timeline renders 6 bars', $$('.chart__bar').length === 6);

  console.log('\ntheme toggle');
  const themeButton = $('[aria-label="切换到深色模式"]');
  themeButton.click();
  await flush();
  check('dark theme is applied to <html>', document.documentElement.dataset.theme === 'dark');
  check('toggle label flips', Boolean($('[aria-label="切换到浅色模式"]')));
  $('[aria-label="切换到浅色模式"]').click();
  await flush();
  check('light theme restored', document.documentElement.dataset.theme === 'light');

  console.log('\nsubscriptions page');
  await go('/subscriptions');
  check('all seeded rows render', rows().length === 7);
  check('page heading renders', $('.display-lg')?.textContent.includes('订阅列表'));

  const search = $('.search__input');
  setValue(search, 'Netflix');
  await sleep(400);
  await flush();
  check('search filters the table', rows().length === 1 && rows()[0].includes('Netflix'));

  setValue(search, '');
  await sleep(400);
  await flush();
  check('clearing the search restores all rows', rows().length === 7);

  const cancelledTab = $$('.tab').find((tab) => tab.textContent.trim() === '已取消');
  cancelledTab.click();
  await flush();
  check('status tab filters to cancelled', rows().length === 1 && rows()[0].includes('Spotify'));
  $$('.tab').find((tab) => tab.textContent.trim() === '全部').click();
  await flush();

  console.log('\ncreate subscription through the dialog');
  $('.nav__cta').click();
  await flush();
  check('dialog opens', dialogState.open === true && Boolean($('.modal')));

  $('.modal__foot .btn--primary').click();
  await flush();
  check('empty submit shows validation errors', $$('.modal .field-error').length > 0);
  check('dialog stays open on invalid input', Boolean($('.modal')));
  check('no subscription was created', state.stats.counts.total === 7);

  setValue($('#sub-name'), '测试订阅 A');
  setValue($('#sub-vendor'), 'TestVendor');
  setValue($('#sub-amount'), '66');
  setValue($('#sub-end'), addDays(TODAY, 4));
  await flush();
  check('reminder preview is computed', $('.summary')?.textContent.includes('到期前 7 天'));

  $('.modal__foot .btn--primary').click();
  await flush(20);
  await sleep(30);
  await flush(20);
  check('dialog closes after a successful save', !$('.modal'));
  check('subscription count increased', state.stats.counts.total === 8);
  check('success toast is shown', Boolean($('.toast--success')));
  check('new subscription joins the upcoming list', state.stats.upcoming.some((item) => item.name === '测试订阅 A'));
  check('table re-rendered with the new row', rows().some((row) => row.includes('测试订阅 A')));

  console.log('\ndelete through the confirm step');
  const targetRow = $$('tbody tr').find((row) => row.textContent.includes('测试订阅 A'));
  targetRow.querySelector('[aria-label="删除"]').click();
  await flush();
  check('confirm dialog appears', Boolean($('.modal')) && $('.modal')?.textContent.includes('删除这条订阅？'));

  $('.modal__foot .btn--primary').click();
  await flush(20);
  await sleep(30);
  await flush(20);
  check('row is removed after confirming', !rows().some((row) => row.includes('测试订阅 A')));
  check('store count returns to 7', state.stats.counts.total === 7);

  console.log('\ndelete from the overview panel');
  {
    await createSubscription({ name: '概览删除演练', amount: 9, startDate: TODAY, endDate: addDays(TODAY, 30) });
    await go('/dashboard');
    const target = $$('tbody tr').find((row) => row.textContent.includes('概览删除演练'));
    check('the overview lists the new subscription', Boolean(target));

    target.querySelector('[aria-label="删除"]').click();
    await flush();
    check('the overview asks before deleting', Boolean($('.modal')) && $('.modal')?.textContent.includes('删除这条订阅？'));

    $('.modal__foot .btn--primary').click();
    await flush(20);
    await sleep(30);
    await flush(20);
    check('the overview drops the row after confirming', !$$('tbody tr').some((row) => row.textContent.includes('概览删除演练')));
    check('the overview delete leaves the store at 7', state.stats.counts.total === 7);
    await go('/subscriptions');
  }

  console.log('\nmanual renewal from the list');
  {
    // A yearly subscription: renewing it cannot disturb the reminder-window
    // expectations the later blocks rely on.
    const renewRow = $$('tbody tr').find((row) => row.textContent.includes('阿里云 ECS'));
    check('every row offers a renew action', Boolean(renewRow?.querySelector('[aria-label="续期"]')));

    const before = (await api.listSubscriptions({ q: '阿里云' })).items[0];
    renewRow.querySelector('[aria-label="续期"]').click();
    await flush(20);
    await sleep(30);
    await flush(20);

    const after = (await api.listSubscriptions({ q: '阿里云' })).items[0];
    check('renewing pushes the due date one cycle further', after.endDate === addCycles(before.endDate, 'yearly', 1));
    check('the new due date is reported back', $$('.toast').some((toast) => toast.textContent.includes(after.endDate)));
    check('the toast says the payment landed on the statement', $$('.toast').some((toast) => toast.textContent.includes('已记入本月账单')));
  }

  console.log('\nper-subscription reminder window');
  $('.nav__cta').click();
  await flush();
  check('the form exposes an auto-renew switch', Boolean($('.modal .switch__input')) && $('.modal .switch__input').checked === true);
  check('the form exposes a reminder-days field', Boolean($('#sub-reminder')) && $('#sub-reminder').value === '');
  check('the reminder summary follows the global window by default', $('.summary')?.textContent.includes('跟随全局'));

  setValue($('#sub-name'), '短期订阅 B');
  setValue($('#sub-amount'), '12');
  setValue($('#sub-end'), addDays(TODAY, 5));
  setValue($('#sub-reminder'), '3');
  await flush();
  check('a custom window previews its own reminder date', $('.summary')?.textContent.includes('到期前 3 天 · 单独设置'));

  $('.modal .switch__input').click();
  await flush();
  check('auto-renew can be switched off', $('.modal .switch__input').checked === false);

  $('.modal__foot .btn--primary').click();
  await flush(20);
  await sleep(30);
  await flush(20);
  check('short plan saves with its own window', state.stats.counts.total === 8);
  check('short plan stays out of the global upcoming list', !state.stats.upcoming.some((item) => item.name === '短期订阅 B'));
  check('the row shows the custom window', rows().some((row) => row.includes('短期订阅 B') && row.includes('单独提前 3 天提醒')));

  const shortRow = $$('tbody tr').find((row) => row.textContent.includes('短期订阅 B'));
  shortRow.querySelector('[aria-label="编辑"]').click();
  await flush();
  check('the switch round-trips as off', $('.modal .switch__input').checked === false);
  check('the custom window round-trips', $('#sub-reminder').value === '3');

  $$('.modal__foot .btn').find((b) => b.textContent.includes('取消')).click();
  await flush();

  $$('tbody tr').find((row) => row.textContent.includes('短期订阅 B')).querySelector('[aria-label="删除"]').click();
  await flush();
  $('.modal__foot .btn--primary').click();
  await flush(20);
  await sleep(30);
  await flush(20);
  check('short plan removed, count back to 7', state.stats.counts.total === 7);

  console.log('\nreminder scan');
  await go('/reminders');
  check('reminders page renders', $('.display-lg')?.textContent.includes('到期提醒'));
  check('no notices before the first scan', $$('.notice').length === 0);

  btn('立即检查提醒').click();
  await flush(20);
  await sleep(30);
  await flush(20);
  check('scan lists 3 notices', $$('.notice').length === 3);
  check('notice text mentions the reminder window', $('.notices')?.textContent.includes('到期前 7 天'));
  check('unread counter is shown', state.unread === 3);

  btn('全部标为已读').click();
  await flush(20);
  check('unread counter clears', state.unread === 0);

  console.log('\nsettings page');
  await go('/settings');
  check('settings page renders', $('.display-lg')?.textContent.includes('系统设置'));
  check('budget input is hydrated', $('#set-budget').value === '1400');
  check('reminder-days input is hydrated', $('#set-reminder').value === '7');

  const saveButton = () => $$('button[type="submit"]').find((button) => button.textContent.includes('保存设置'));

  console.log('\ncustom select (no native <select>)');
  check('settings page uses no native <select>', $$('select').length === 0);
  // The custom control must not reuse the legacy .select class from base.css
  // (that rule paints a background chevron, which showed up as a second arrow).
  check('no element borrows the legacy .select class', $$('.select').length === 0);
  click('#set-currency');
  await flush();
  check('custom select opens a listbox', Boolean($('.listbox__list')) && $('.listbox__button').getAttribute('aria-expanded') === 'true');
  check('every currency option is listed', $$('.listbox__list .listbox__option').length === 5);

  $$('.listbox__list .listbox__option').find((option) => option.textContent.includes('USD')).click();
  await flush();
  check('picking an option updates the trigger', $('#set-currency')?.textContent.includes('USD'));
  check('picking an option closes the list', !$('.listbox__list'));

  click('#set-currency');
  await flush();
  $$('.listbox__list .listbox__option').find((option) => option.textContent.includes('CNY')).click();
  await flush();
  check('the select round-trips back to CNY', $('#set-currency')?.textContent.includes('CNY'));

  console.log('\nlanding page switch');
  $('.interface .switch__input').click();
  await flush();
  check('landing switch flips on', $('.interface .switch__input').checked === true);
  saveButton().click();
  await flush(20);
  await sleep(30);
  await flush(20);
  check('landing setting persists', state.settings.showHero === true);
  check('the nav still lists the five app pages', $$('.nav__link').length === 5);

  await go('/');
  check('the root is now the landing page', router.currentRoute.value.name === 'home');
  check('landing page renders the full hero', $('.hero__title')?.textContent.includes('管好每一笔订阅'));
  check('landing page renders the mesh gradient', Boolean($('.mesh__blob--develop')));
  check('landing page lists its feature cards', $$('.feature').length === 3);
  check('signed-in visitors keep the app nav', $$('.nav__link').length === 5);
  check('the landing page shows the brand in the title bar', $('.brand__name')?.textContent.trim() === 'SubTrack');
  check('the landing page keeps the brand tagline', Boolean($('.brand__sub')));
  check('the landing page keeps the brand mark', Boolean($('.brand__mark')));
  check('the landing page keeps the footer', Boolean($('.footer')));
  check('landing page can jump into the overview', Boolean(btn('进入概览')));

  await go('/dashboard');
  check('overview stays a dashboard, not a hero', !$('.mesh__blob--develop') && Boolean($('.page__head')));
  btn('打开落地页').click();
  await flush();
  check('overview links back to the landing page', router.currentRoute.value.name === 'home');

  await go('/settings');
  $('.interface .switch__input').click();
  await flush();
  saveButton().click();
  await flush(20);
  await sleep(30);
  await flush(20);
  check('landing can be switched back off', state.settings.showHero === false);

  await go('/');
  check('the root falls back to the overview once the landing page is off', router.currentRoute.value.name === 'dashboard');
  check('overview never renders the mesh gradient', !$('.mesh__blob--develop'));

  await go('/settings');

  console.log('\nbills page');
  await go('/bills');
  check('bills page renders', $('.display-lg')?.textContent.includes('账单'));
  check('three summary cards render', $$('.summary .card').length === 3);
  check('12 months are listed', $$('.months .month').length === 12);
  check('current month is marked', $('.month')?.textContent.includes('本月'));
  check('bills table matches the dashboard month spend', state.stats.spend.month > 0);

  const currentMonth = $('.months .month');
  const currentTotal = currentMonth.querySelector('.month__amount .strong')?.textContent ?? '';
  currentMonth.click();
  await flush(20);
  await sleep(30);
  await flush(20);
  check('clicking a month opens the statement dialog', Boolean($('.modal')) && Boolean($('.bill')));
  check('dialog groups charges by day', $$('.bill .charge-day').length > 0);
  check('dialog lists at least one charge', $$('.bill .charge').length > 0);
  check('an early renewal is marked as paid ahead of its cycle', $$('.bill .charge').some((row) => row.textContent.includes('提前续费')));
  check('dialog total matches the month row', Boolean(currentTotal) && $('.bill__hero')?.textContent.includes(currentTotal.replace(/\s+/g, '')));

  // The close affordance must survive on phones where the sheet hugs the top.
  const closeButton = $('.modal__head .icon-btn');
  check('statement dialog exposes a close button', Boolean(closeButton) && closeButton.getAttribute('aria-label') === '关闭');
  closeButton.click();
  await flush(20);
  check('close button dismisses the statement dialog', !$('.modal'));

  await go('/settings');

  console.log('\nchannel dialog — Telegram');
  channelCard('Telegram Bot').click();
  await flush();
  check('Telegram dialog opens', Boolean($('.modal')) && $('.modal')?.textContent.includes('Telegram Bot设置'));
  check('dialog starts disabled', $('.modal .switch__input').checked === false);

  $('.modal .switch__input').click();
  await flush();
  setValue($('#ch-telegramBotToken'), '123456:TESTTOKEN');
  setValue($('#ch-telegramChatId'), '-1001234567890');
  buttonByText('.modal', '发送测试消息').click();
  await flush(20);
  await sleep(30);
  await flush(20);
  check('test message reports success', $('.test-result--ok')?.textContent.includes('测试消息已发送'));
  check('Telegram channel is enabled', state.settings.channelTelegramEnabled === true);
  check('chat id is stored', state.settings.telegramChatId === '-1001234567890');
  check('bot token is stored as a secret, never echoed', state.settings.telegramBotToken === '' && state.settings.hasSecrets.telegramBotToken === true);

  buttonByText('.modal', '保存').click();
  await flush(20);
  await sleep(30);
  await flush(20);
  check('dialog closes after saving', !$('.modal'));
  check('channel card badge flips to 已启用', channelCard('Telegram Bot')?.textContent.includes('已启用'));

  console.log('\nchannel dialog — email');
  channelCard('邮件通知').click();
  await flush();
  check('email dialog opens', Boolean($('.modal')) && $('.modal')?.textContent.includes('邮件通知设置'));

  $('.modal .switch__input').click();
  await flush();
  buttonByText('.modal', '保存').click();
  await flush();
  check('incomplete email config is rejected', $$('.modal .field-error').length > 0);
  check('email channel stays off until valid', state.settings.channelEmailEnabled === false);

  click('#ch-emailProvider');
  await flush();
  check('provider select opens inside the dialog', Boolean($('.modal .listbox__list')));
  $$('.modal .listbox__option').find((option) => option.textContent.includes('自定义 HTTP 邮件网关')).click();
  await flush();
  check('choosing a provider swaps the credential field', Boolean($('#ch-emailEndpoint')) && !$('#ch-emailApiKey'));

  setValue($('#ch-emailEndpoint'), 'https://mail.example.com/send');
  setValue($('#ch-emailFrom'), 'bot@example.com');
  setValue($('#ch-emailTo'), 'me@example.com');
  buttonByText('.modal', '发送测试消息').click();
  await flush(20);
  await sleep(30);
  await flush(20);
  check('email test message reports success', $('.test-result--ok')?.textContent.includes('测试消息已发送'));
  check('email channel is enabled after a valid save', state.settings.channelEmailEnabled === true);
  check('endpoint is stored', state.settings.emailEndpoint === 'https://mail.example.com/send');

  buttonByText('.modal', '取消').click();
  await flush(20);
  check('cancel closes the dialog', !$('.modal'));

  console.log('\nchannel dialog — SMTP');
  channelCard('邮件通知').click();
  await flush();
  click('#ch-emailProvider');
  await flush();
  $$('.modal .listbox__option').find((option) => option.textContent.includes('SMTP')).click();
  await flush();
  check('SMTP swaps in the mail-server fields', Boolean($('#ch-smtpHost')) && Boolean($('#ch-smtpSecure')) && Boolean($('#ch-smtpUser')) && Boolean($('#ch-smtpPassword')));
  check('the Resend key is no longer offered', !$('#ch-emailApiKey'));
  check('port auto-selection suggests 465 first', $('#ch-smtpPort').placeholder === '465');

  click('#ch-smtpSecure');
  await flush();
  $$('.modal .listbox__option').find((option) => option.textContent.includes('587')).click();
  await flush();
  check('choosing STARTTLS suggests 587', $('#ch-smtpPort').placeholder === '587');

  setValue($('#ch-smtpHost'), 'smtp.example.com');
  setValue($('#ch-smtpUser'), 'bot@example.com');
  setValue($('#ch-smtpPassword'), 'app-password');
  buttonByText('.modal', '保存').click();
  await flush(20);
  await sleep(30);
  await flush(20);
  check('SMTP settings persist', state.settings.emailProvider === 'smtp' && state.settings.smtpHost === 'smtp.example.com' && state.settings.smtpSecure === 'starttls');
  check('the SMTP password is stored as a secret', state.settings.smtpPassword === '' && state.settings.hasSecrets.smtpPassword === true);
  check('the email channel stays enabled', state.settings.channelEmailEnabled === true);

  check(
    'a working SMTP setup is not flagged as incomplete',
    channelCard('邮件通知')?.textContent.includes('已启用') && !channelCard('邮件通知')?.textContent.includes('配置不完整'),
  );

  console.log('\nchannel dialog — webhook targets');
  channelCard('Webhook 推送').click();
  await flush();
  check('webhook dialog opens', Boolean($('.modal')) && $('.modal').textContent.includes('Webhook 推送设置'));
  check('webhook dialog offers a service picker', Boolean($('#ch-webhookProvider')));
  check('webhook defaults to the generic JSON target', $('#ch-webhookProvider').textContent.includes('通用 JSON'));

  click('#ch-webhookProvider');
  await flush();
  check('service picker opens inside the dialog', Boolean($('.modal .listbox__list')));
  $$('.modal .listbox__option').find((option) => option.textContent.includes('ntfy')).click();
  await flush();
  check('picking ntfy retargets the URL placeholder', $('#ch-webhookUrl').placeholder.includes('ntfy.sh'));
  check('picking ntfy swaps the hint too', $('.modal').textContent.includes('主题名'));
  check('targets without a signature hide the secret field', !$('#ch-webhookSecret'));
  check('ntfy offers an optional access token', Boolean($('#ch-webhookToken')));
  check('the ntfy token field explains Bearer/Basic', $('.modal').textContent.includes('Bearer'));

  click('#ch-webhookProvider');
  await flush();
  $$('.modal .listbox__option').find((option) => option.textContent.includes('飞书群机器人')).click();
  await flush();
  check('飞书 asks for the signing secret', Boolean($('#ch-webhookSecret')));
  check('the secret field explains when it is needed', $('.modal').textContent.includes('签名校验'));
  check('the secret hint mentions the keyword alternative', $('.modal').textContent.includes('自定义关键词'));
  check('飞书 hides the ntfy access token', !$('#ch-webhookToken'));
  check('飞书 retargets the URL placeholder', $('#ch-webhookUrl').placeholder.includes('open.feishu.cn'));
  click('#ch-webhookProvider');
  await flush();
  $$('.modal .listbox__option').find((option) => option.textContent.includes('ntfy')).click();
  await flush();

  $('.modal .switch__input').click();
  await flush();
  setValue($('#ch-webhookUrl'), 'https://ntfy.sh/subtrack-demo');
  buttonByText('.modal', '发送测试消息').click();
  await flush(20);
  await sleep(30);
  await flush(20);
  check('webhook test message succeeds', Boolean($('.test-result--ok')));
  check('webhook channel is enabled', state.settings.channelWebhookEnabled === true);
  check('the chosen target is persisted', state.settings.webhookProvider === 'ntfy');
  check('the hook URL is stored as a secret, never echoed', state.settings.webhookUrl === '' && state.settings.hasSecrets.webhookUrl === true);
  check('the card names the chosen target', channelCard('Webhook 推送')?.textContent.includes('已启用 · ntfy'));
  buttonByText('.modal', '取消').click();
  await flush();

  // Reopening the dialog is where the "written once, never echoed" promise is
  // visible: a blank field that still says the hook is configured.
  channelCard('Webhook 推送').click();
  await flush();
  check('a stored hook URL comes back blank', $('#ch-webhookUrl').value === '');
  check('the empty URL field says it is already configured', $('#ch-webhookUrl').placeholder.includes('已配置'));
  check('the hook URL stays readable while typing', $('#ch-webhookUrl').type === 'text');
  buttonByText('.modal', '取消').click();
  await flush();

  console.log('\nchannel dialog — browser push');
  {
    // jsdom ships no Notification / PushManager / service worker, so the test
    // installs a minimal stand-in to walk the entire subscribe path.
    const created = [];
    // Real P-256 material: the Worker encrypts with it for the stubbed endpoint.
    const devicePair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const devicePublic = Buffer.from(await crypto.subtle.exportKey('raw', devicePair.publicKey)).toString('base64url');
    const deviceAuth = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64url');
    let deviceSeq = 0;
    const registration = {
      pushManager: {
        getSubscription: async () => created.filter((entry) => !entry.__gone).pop() ?? null,
        subscribe: async ({ applicationServerKey }) => {
          const entry = {
            endpoint: `https://push.example.com/browser-${++deviceSeq}`,
            options: { applicationServerKey },
            keys: { p256dh: devicePublic, auth: deviceAuth },
            toJSON() {
              return { endpoint: this.endpoint, expirationTime: null, keys: this.keys };
            },
            unsubscribe: async () => {
              entry.__gone = true;
              return true;
            },
          };
          created.push(entry);
          return entry;
        },
      },
    };
    navigator.serviceWorker = { register: async () => registration };
    window.isSecureContext = true;
    window.Notification = { permission: 'granted', requestPermission: async () => 'granted' };
    window.PushManager = function PushManager() {};

    channelCard('浏览器推送').click();
    await flush();
    await sleep(30);
    await flush();
    check('push dialog opens', Boolean($('.modal')) && $('.modal').textContent.includes('浏览器推送设置'));
    check('push dialog reports this device as unsubscribed', $('.modal').textContent.includes('未订阅'));
    check('push dialog shows the device count', $('.modal').textContent.includes('已订阅设备'));
    check('test push is blocked until a device subscribes', buttonByText('.modal', '发送测试消息').disabled === true);

    $('.modal .switch__input').click();
    await flush();
    buttonByText('.modal', '保存').click();
    await flush(20);
    await sleep(30);
    await flush(20);
    check('push channel is enabled', state.settings.channelPushEnabled === true);
    check('the browser subscribed with the server VAPID key', created.length === 1 && created[0].options.applicationServerKey.length === 65 && created[0].options.applicationServerKey[0] === 4);
    check('the subscription is registered with the Worker', state.push.devices === 1 && state.push.subscribed === true);
    check('the dialog closes after saving', !$('.modal'));

    channelCard('浏览器推送').click();
    await flush();
    await sleep(30);
    await flush();
    check('reopening shows this device as subscribed', $('.modal').textContent.includes('已订阅推送'));
    check('test push becomes available', buttonByText('.modal', '发送测试消息').disabled === false);
    buttonByText('.modal', '发送测试消息').click();
    await flush(20);
    await sleep(30);
    await flush(20);
    check('test push reaches the registered device', Boolean($('.test-result--ok')));

    $('.modal .switch__input').click();
    await flush();
    buttonByText('.modal', '保存').click();
    await flush(20);
    await sleep(30);
    await flush(20);
    check('switching the channel off unsubscribes this device', created[0].__gone === true && state.push.subscribed === false);
    check('the push channel is off again', state.settings.channelPushEnabled === false && state.push.devices === 0);

    // A subscription is bound to the VAPID key that created it, so a rotated
    // server key must replace it instead of silently reusing a dead endpoint.
    registration.pushManager.getSubscription = async () => created.find((entry) => !entry.__gone) ?? null;
    await enableBrowserPush();
    created[0].options.applicationServerKey = new Uint8Array(65);
    await enableBrowserPush();
    check('a subscription bound to an old VAPID key is replaced', created[0].__gone === true && created.length === 2);
    check('the replaced endpoint is also removed from the Worker', state.push.devices === 1 && state.push.subscribed === true);
    await disableBrowserPush();

    // Chromium builds without a push service fail with exactly this message.
    registration.pushManager.subscribe = async () => {
      throw new Error('Registration failed - push service error');
    };
    channelCard('浏览器推送').click();
    await flush();
    await sleep(30);
    await flush();
    $('.modal .switch__input').click();
    await flush();
    buttonByText('.modal', '保存').click();
    await flush(20);
    await sleep(30);
    await flush(20);
    check('a browser without a push service keeps the channel off', state.settings.channelPushEnabled === false);
    check('the dialog stays open so the reason is readable', Boolean($('.modal')));
    check('the raw browser error is explained in plain language', $('.test-result--fail')?.textContent.includes('推送服务'));
    buttonByText('.modal', '取消').click();
    await flush();
  }

  console.log('\nsettings save');
  setValue($('#set-budget'), '500');
  await flush();
  check('remaining preview updates live', $('.preview').textContent.includes('500'));
  saveButton().click();
  await flush(20);
  await sleep(30);
  await flush(20);
  check('lowering the budget persists', state.settings.monthlyBudget === 500);
  check('remaining allowance turns negative', state.stats.budget.remaining === 500 - state.stats.spend.month);
  check('over-budget alert appears in the nav', Boolean($('.nav__alert')));

  setValue($('#set-budget'), '2000');
  await flush();
  saveButton().click();
  await flush(20);
  await sleep(30);
  await flush(20);
  check('settings persisted to the Worker', state.settings.monthlyBudget === 2000);
  check('stats picked up the new budget', state.stats.budget.monthly === 2000);
  check('remaining allowance is recomputed', state.stats.budget.remaining === 2000 - state.stats.spend.month);
  check('over-budget alert disappears', !$('.nav__alert'));

  await go('/dashboard');
  check('dashboard reflects the new budget', $('.stats')?.textContent.includes('2,000'));

  console.log('\napp mode (mobile shell)');
  await go('/settings');
  check('settings exposes the app-mode switch', Boolean($('.interface__row .switch__input')));
  check('app mode is off by default', state.settings.appMode === false && !$('.tabbar'));

  $('.interface__row .switch__input').click();
  await flush();
  saveButton().click();
  await flush(20);
  await sleep(30);
  await flush(20);
  check('app mode persists to the Worker', state.settings.appMode === true);
  check('a desktop-width window keeps the web layout', !$('.tabbar') && $$('.nav__link').length === 5);

  globalThis.__setViewport(390);
  await flush();
  check('phone width switches to the app shell', Boolean($('.tabbar')));
  check('the tab bar keeps four sections plus the add action', $$('.tabbar .tab').length === 5);
  check('the add action sits in the middle', $$('.tabbar .tab')[2].classList.contains('tab--add'));
  check(
    'the tab bar labels each section',
    $$('.tabbar .tab__label').map((el) => el.textContent.trim()).filter(Boolean).join(',') === '概览,账单,订阅,设置',
  );
  check('the add action is icon-only', !$$('.tabbar .tab')[2].querySelector('.tab__label'));
  check('提醒 is gone from the tab bar', !$('.tabbar')?.textContent.includes('提醒'));
  check('the app shell drops the desktop nav links', $$('.nav__link').length === 0);
  check('the app shell drops the burger menu', !$('.nav__burger'));
  check('the app bar still names the page', $('.brand__name')?.textContent.trim() === '设置');
  check('the app bar drops its add button', !$('.nav__add'));
  check('the app shell hides the in-page title', !$('.page__title'));
  check('the settings page hides its own add buttons', $$('.page .btn--primary').filter((b) => b.textContent.includes('添加订阅')).length === 0);
  check('the active tab is marked', $('.tabbar .tab--active .tab__label')?.textContent.trim() === '设置');

  await go('/dashboard');
  check('the tab bar follows the route', $('.tabbar .tab--active .tab__label')?.textContent.trim() === '概览');
  check('the dashboard hides its own add button in the app shell', !$$('.page .btn, .dashboard .btn').some((b) => b.textContent.trim() === '添加订阅'));
  check('the dashboard head is web-only too', !$('.dashboard .page__head'));
  check('the dashboard stats stay flush under the app bar', Boolean($('.dashboard .stats')));
  await go('/subscriptions');
  check('the subscriptions page renders cards, not a table', $$('.sub-card').length === 7 && $$('tbody tr').length === 0);
  check('the subscriptions page hides its header add button', !$$('.page__head .btn').some((b) => b.textContent.includes('添加订阅')));

  $$('.tabbar .tab').find((tab) => tab.textContent.includes('账单')).click();
  await flush(20);
  check('tapping a tab navigates', router.currentRoute.value.name === 'bills');

  $('.tabbar .tab--add').click();
  await flush();
  check('the middle add action opens the sheet', Boolean($('.modal')));
  $$('.modal .btn').find((b) => b.textContent.includes('取消')).click();
  await flush();

  globalThis.__setViewport(1440);
  await flush();
  check('widening the window restores the web layout', !$('.tabbar') && $$('.nav__link').length === 5);

  globalThis.__setDisplayMode('standalone');
  await flush();
  check('an installed PWA uses the app shell even on a wide window', Boolean($('.tabbar')));
  globalThis.__setDisplayMode('browser');
  globalThis.__setViewport(1440);
  await flush();

  await go('/settings');
  $('.interface__row .switch__input').click();
  await flush();
  saveButton().click();
  await flush(20);
  await sleep(30);
  await flush(20);
  check('app mode can be switched back off', state.settings.appMode === false);
  globalThis.__setViewport(390);
  await flush();
  check('the shell disappears with the setting', !$('.tabbar'));
  globalThis.__setViewport(1440);
  await flush();

  console.log(`\n✅ ${passed} assertions passed\n`);
}

main().catch((error) => {
  console.error(`\n❌ ${error?.message ?? error}\n`, error?.stack ?? '');
  process.exitCode = 1;
});
