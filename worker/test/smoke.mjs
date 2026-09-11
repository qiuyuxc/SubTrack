/**
 * End-to-end smoke test: boots the real worker fetch handler on top of an
 * in-memory SQLite database and walks the whole API surface — auth, settings,
 * subscription CRUD, stats, the 7-day reminder window and every channel.
 *
 * Run with: npm test
 */
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createD1 } from './d1-shim.mjs';
import { decodeBase64Body, decodeHeaderWord, headerLines, smtpConnector, startSmtpServer } from './smtp-server.mjs';
import worker from '../src/index.js';
import { DEFAULT_EXCHANGE_RATES, SETTINGS_SCHEMA } from '../src/db.js';
import { SCHEMA_SQL } from '../src/schema.js';

import { addCycles, addDays, round2, todayIn } from '../src/utils.js';

const db = createD1();
db._sqlite.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));

const env = {
  DB: db,
  ALLOWED_ORIGIN: '*',
  ADMIN_USERNAME: 'admin',
  ADMIN_PASSWORD: 'correct-horse-battery',
  AUTH_SECRET: 'test-signing-key',
};

const TZ = 'Asia/Shanghai';
const TODAY = todayIn(TZ);

let token = '';
let passed = 0;

async function call(method, path, body, { auth = true, headers = {} } = {}) {
  const request = new Request(`https://api.test${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(auth && token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const response = await worker.fetch(request, env);
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  return { status: response.status, body: payload };
}

function check(label, condition) {
  assert.ok(condition, `FAIL: ${label}`);
  passed += 1;
  console.log(`  ✓ ${label}`);
}

/** Swap outbound fetch and record what each channel tried to send. */
async function withFetch(handler, run) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), payload: init.body ? JSON.parse(init.body) : null, headers: init.headers ?? {} });
    return handler(String(url), init, calls.length - 1);
  };
  try {
    return { result: await run(), calls };
  } finally {
    globalThis.fetch = original;
  }
}

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

console.log(`\nSubscription API smoke test — today is ${TODAY} (${TZ})\n`);

/* ------------------------------------------------------------------- auth */

console.log('authentication');
{
  const health = await call('GET', '/api/health', null, { auth: false });
  check('health check stays public', health.status === 200 && health.body.ok === true);

  const noToken = await call('GET', '/api/stats', null, { auth: false });
  check('protected route rejects anonymous requests', noToken.status === 401);
  check('401 carries a readable message', noToken.body.error.message.includes('请先登录'));

  const badToken = await call('GET', '/api/stats', null, { auth: false, headers: { authorization: 'Bearer not-a-token' } });
  check('garbage token is rejected', badToken.status === 401);

  const wrongPassword = await call('POST', '/api/auth/login', { username: 'admin', password: 'nope' }, { auth: false });
  check('wrong password is rejected', wrongPassword.status === 401);

  const wrongUser = await call('POST', '/api/auth/login', { username: 'root', password: 'correct-horse-battery' }, { auth: false });
  check('unknown username is rejected', wrongUser.status === 401);
  check('failure messages do not disclose which field was wrong', wrongUser.body.error.message === wrongPassword.body.error.message);

  const emptyLogin = await call('POST', '/api/auth/login', {}, { auth: false });
  check('empty credentials are rejected', emptyLogin.status === 400);

  const login = await call('POST', '/api/auth/login', { username: 'admin', password: 'correct-horse-battery' }, { auth: false });
  check('correct credentials return a session', login.status === 200 && typeof login.body.token === 'string');
  check('login echoes the admin username', login.body.username === 'admin');
  token = login.body.token;

  const session = await call('GET', '/api/auth/session');
  check('session endpoint validates the token', session.body.authenticated === true && session.body.username === 'admin');

  const anonymousSession = await call('GET', '/api/auth/session', null, { auth: false });
  check('anonymous session reports unauthenticated', anonymousSession.status === 200 && anonymousSession.body.authenticated === false);

  const badMethod = await call('DELETE', '/api/health', null, { auth: false });
  check('unsupported method returns 405', badMethod.status === 405);

  const publicConfig = await call('GET', '/api/public', null, { auth: false });
  check('public config is reachable without a session', publicConfig.status === 200);
  check('public config exposes the landing switch', publicConfig.body.showHero === false);
  check('public config exposes the reminder window', publicConfig.body.reminderDays === 7);
  check('public config exposes the currency', publicConfig.body.currency === 'CNY');
  check('public config exposes the app-mode switch', publicConfig.body.appMode === false);
  check(
    'public config leaks no secrets',
    Object.keys(publicConfig.body).sort().join(',') === 'appMode,currency,reminderDays,showHero',
  );

  const missing = await call('GET', '/api/nope');
  check('unknown route returns 404', missing.status === 404);
}

/* --------------------------------------------------------------- settings */

console.log('\nsettings');
{
  const boot = await call('GET', '/api/bootstrap');
  check('bootstrap returns settings + stats', boot.status === 200 && Boolean(boot.body.stats));
  check('default reminder window is 7 days', boot.body.settings.reminderDays === 7);
  check('hero band is off by default', boot.body.settings.showHero === false);

  const flipped = await call('GET', '/api/public', null, { auth: false });
  await call('PUT', '/api/settings', { showHero: true });
  const afterOn = await call('GET', '/api/public', null, { auth: false });
  check('public config follows the landing switch', flipped.body.showHero === false && afterOn.body.showHero === true);
  await call('PUT', '/api/settings', { showHero: false });
  check('in-app channel is on by default', boot.body.settings.channelInappEnabled === true);
  check('push channels start disabled', ['channelWebhookEnabled', 'channelTelegramEnabled', 'channelEmailEnabled'].every((k) => boot.body.settings[k] === false));

  const saved = await call('PUT', '/api/settings', { monthly_budget: 300, currency: 'CNY', reminder_days: 7 });
  check('PUT /api/settings accepts snake_case keys', saved.body.settings.monthlyBudget === 300);

  const hero = await call('PUT', '/api/settings', { showHero: true });
  check('hero toggle persists (camelCase)', hero.body.settings.showHero === true);
  await call('PUT', '/api/settings', { showHero: false });

  const clamped = await call('PUT', '/api/settings', { reminderDays: 999 });
  check('reminder days are clamped to 90', clamped.body.settings.reminderDays === 90);
  await call('PUT', '/api/settings', { reminderDays: 7 });

  const telegram = await call('PUT', '/api/settings', { telegramBotToken: '123456:secret-token', telegramChatId: '-100200' });
  check('secret is stored but never echoed back', telegram.body.settings.telegramBotToken === '' && telegram.body.settings.hasSecrets.telegramBotToken === true);
  check('non-secret channel fields are returned', telegram.body.settings.telegramChatId === '-100200');

  const hook = await call('PUT', '/api/settings', { webhookUrl: 'https://open.feishu.cn/open-apis/bot/v2/hook/abc' });
  check('the hook URL is stored as a secret, never echoed back', hook.body.settings.webhookUrl === '' && hook.body.settings.hasSecrets.webhookUrl === true);
  const hookKept = await call('PUT', '/api/settings', { webhookUrl: '' });
  check('an empty hook URL leaves the stored one alone', hookKept.body.settings.hasSecrets.webhookUrl === true);
  await call('PUT', '/api/settings', { webhookUrl: null });
  check('null clears the stored hook URL', (await call('GET', '/api/settings')).body.settings.hasSecrets.webhookUrl === false);

  const blank = await call('PUT', '/api/settings', { telegramBotToken: '' });
  check('an empty secret leaves the stored value alone', blank.body.settings.hasSecrets.telegramBotToken === true);

  const cleared = await call('PUT', '/api/settings', { telegramBotToken: null });
  check('null clears a stored secret', cleared.body.settings.hasSecrets.telegramBotToken === false);
}

/* ------------------------------------------------------- subscriptions crud */

console.log('\ncreate & validate subscriptions');
const ids = {};
{
  const soon = await call('POST', '/api/subscriptions', {
    name: 'Netflix 高级版', vendor: 'Netflix', category: '影音娱乐', amount: 78,
    cycle: 'monthly', startDate: addDays(TODAY, -25), endDate: addDays(TODAY, 3),
  });
  check('creates a subscription ending in 3 days (201)', soon.status === 201);
  ids.soon = soon.body.subscription.id;
  check('derived status flags expiringSoon', soon.body.subscription.expiringSoon === true);
  check('daysLeft computed correctly', soon.body.subscription.daysLeft === 3);

  const monthly = await call('POST', '/api/subscriptions', {
    name: 'ChatGPT Plus', vendor: 'OpenAI', category: '效率工具', amount: 140,
    startDate: addDays(TODAY, -10), endDate: addDays(TODAY, 20),
  });
  check('creates a mid-cycle subscription', monthly.status === 201);
  ids.monthly = monthly.body.subscription.id;

  const expired = await call('POST', '/api/subscriptions', {
    name: 'Adobe 摄影计划', vendor: 'Adobe', category: '设计工具', amount: 68,
    startDate: addDays(TODAY, -60), endDate: addDays(TODAY, -2),
  });
  check('creates an expired subscription', expired.status === 201);
  ids.expired = expired.body.subscription.id;
  check('expired subscription is flagged', expired.body.subscription.expired === true);

  const far = await call('POST', '/api/subscriptions', {
    name: '阿里云 ECS', vendor: 'Aliyun', category: '云服务', amount: 900,
    startDate: addDays(TODAY, -30), endDate: addDays(TODAY, 300), autoRenew: true,
  });
  check('autoRenew is persisted as boolean', far.body.subscription.autoRenew === true);
  ids.far = far.body.subscription.id;

  const noName = await call('POST', '/api/subscriptions', { amount: 10, startDate: TODAY, endDate: TODAY });
  check('rejects missing name with 422', noName.status === 422 && noName.body.error.details.length === 1);

  const badDate = await call('POST', '/api/subscriptions', { name: 'X', amount: 1, startDate: '2026/01/01', endDate: TODAY });
  check('rejects malformed date', badDate.status === 422);

  const reversed = await call('POST', '/api/subscriptions', { name: 'X', amount: 1, startDate: TODAY, endDate: addDays(TODAY, -5) });
  check('rejects end before start', reversed.status === 422 && reversed.body.error.details[0].includes('不能早于'));

  const negative = await call('POST', '/api/subscriptions', { name: 'X', amount: -3, startDate: TODAY, endDate: TODAY });
  check('rejects negative amount', negative.status === 422);
}

/* ------------------------------------------------------ listing & filtering */

console.log('\nlisting & filtering');
{
  const all = await call('GET', '/api/subscriptions');
  check('lists all subscriptions', all.body.items.length === 4);
  check('sorts by expiry ascending', all.body.items[0].endDate <= all.body.items[1].endDate);

  const expiring = await call('GET', '/api/subscriptions?status=expiring');
  check('status=expiring returns only the 3-day item', expiring.body.items.length === 1 && expiring.body.items[0].id === ids.soon);

  const expired = await call('GET', '/api/subscriptions?status=expired');
  check('status=expired returns the lapsed item', expired.body.items.length === 1 && expired.body.items[0].id === ids.expired);

  const search = await call('GET', '/api/subscriptions?q=OpenAI');
  check('search matches vendor', search.body.items.length === 1);

  const sorted = await call('GET', '/api/subscriptions?sort=amount-desc');
  check('sort=amount-desc orders by amount', sorted.body.items[0].amount === 900);
}

/* -------------------------------------------------------------- dashboard */

console.log('\ndashboard stats');
{
  const { body } = await call('GET', '/api/stats');
  const { stats } = body;
  check('total spend sums non-cancelled subscriptions', stats.spend.total === 1186);
  const monthBill = (await call('GET', `/api/bills/${TODAY.slice(0, 7)}`)).body.bill;
  check('monthly spend counts this month charges, not coverage', stats.spend.month === monthBill.total);
  check('monthly spend is smaller than the subscription total', stats.spend.month < stats.spend.total);
  check('remaining budget = budget - monthly spend', stats.budget.remaining === 300 - stats.spend.month);
  check('over-budget flag is raised', stats.budget.overBudget === true);
  check('upcoming only contains active items in window', stats.upcoming.length === 1);
  check('upcoming is sorted by days left', stats.upcoming[0].daysLeft === 3);
  check('expired bucket holds the lapsed subscription', stats.expired.length === 1);
  check('counts are correct', stats.counts.active === 3 && stats.counts.expired === 1 && stats.counts.expiringSoon === 1);
  check('category breakdown is sorted desc', stats.byCategory[0].category === '云服务' && stats.byCategory[0].amount === 900);
  check('6-month timeline is produced', stats.timeline.length === 6 && stats.timeline[0].month === TODAY.slice(0, 7));
}

/* ------------------------------------------------------------------ bills */

console.log('\nbills (monthly statements)');
{
  const round2 = (n) => Math.round(n * 100) / 100;
  const { body } = await call('GET', '/api/bills');
  const months = body.months;

  check('bills default to 12 months', months.length === 12);
  check('months are listed newest first', months[0].month === TODAY.slice(0, 7));
  check('only the current month is flagged', months.filter((m) => m.current).length === 1);
  check('every month carries a label', months.every((m) => /^\d{4}年\d{1,2}月$/.test(m.label)));
  check('months are strictly descending', months.every((m, i) => i === 0 || months[i - 1].month > m.month));

  const stats = (await call('GET', '/api/stats')).body.stats;
  const current = months[0];
  check('current month total matches /api/stats month spend', current.total === stats.spend.month);
  // A weekly plan pays four or five times a month, so the statement counts
  // charges — not "one line per subscription per month".
  const weekly = await call('POST', '/api/subscriptions', {
    name: '周付演练', amount: 10, cycle: 'weekly', autoRenew: false,
    startDate: addDays(TODAY, -21), endDate: addDays(TODAY, 14),
  });
  const weeklyId = weekly.body.subscription.id;
  const weeklyBill = (await call('GET', `/api/bills/${current.month}`)).body.bill;
  const weeklyCharges = weeklyBill.items.filter((item) => item.id === weeklyId);
  check('a weekly plan is charged once per week', weeklyCharges.length >= 3);
  check('every charge keeps its own date', new Set(weeklyCharges.map((c) => c.chargeDate)).size === weeklyCharges.length);
  check('the month total adds up every charge', weeklyBill.total === round2(current.total + weeklyCharges.length * 10));

  // A one-off purchase is charged on the day it was bought, and never again.
  const once = await call('POST', '/api/subscriptions', {
    name: '买断演练', amount: 500, cycle: 'once', autoRenew: false,
    startDate: addDays(TODAY, -40), endDate: addDays(TODAY, 40),
  });
  const onceId = once.body.subscription.id;
  check(
    'a one-off purchase is charged once, in the month it was paid',
    (await call('GET', `/api/bills/${addDays(TODAY, -40).slice(0, 7)}`)).body.bill.items.filter((i) => i.id === onceId).length === 1,
  );
  check(
    'a one-off purchase is not billed again in later months',
    !weeklyBill.items.some((item) => item.id === onceId),
  );

  for (const cleanup of [weeklyId, onceId]) await call('DELETE', `/api/subscriptions/${cleanup}`);

  const sum = round2(months.reduce((acc, m) => acc + m.total, 0));
  check('summary total sums every month', body.summary.total === sum);
  check('summary reports the month count', body.summary.months === 12);
  check('summary average is total / months', body.summary.average === round2(sum / 12));
  check(
    'summary busiest is the highest month',
    body.summary.busiest.total === Math.max(...months.map((m) => m.total)),
  );
  check('currency comes from settings', body.currency === 'CNY');
  check('today comes from the configured timezone', body.today === TODAY);

  check(
    'category totals add up to the month total',
    months.every((m) => round2(m.byCategory.reduce((acc, c) => acc + c.amount, 0)) === m.total),
  );
  check(
    'category totals are sorted descending',
    months.every((m) => m.byCategory.every((c, i) => i === 0 || m.byCategory[i - 1].amount >= c.amount)),
  );

  const detail = await call('GET', `/api/bills/${current.month}`);
  check('detail returns the month statement', detail.status === 200);
  check('detail total matches the list row', detail.body.bill.total === current.total);
  check('detail count matches the number of charges', detail.body.bill.count === detail.body.bill.items.length);
  check(
    'charges are sorted by billing date',
    detail.body.bill.items.every((item, i, list) => i === 0 || list[i - 1].chargeDate <= item.chargeDate),
  );
  check(
    'every charge lands inside the requested month',
    detail.body.bill.items.every((item) => item.chargeDate.startsWith(current.month) && item.chargeDate.length === 10),
  );
  check('detail carries the subscription payload', detail.body.bill.items.every((item) => typeof item.name === 'string' && item.amount > 0));
  check('detail flags the current month', detail.body.bill.current === true);

  // A subscription started on the 31st must be clamped into February.
  const february = await call('GET', '/api/bills/2026-02');
  check('february statement renders', february.status === 200);
  check(
    'billing dates are clamped into short months',
    february.body.bill.items.every((item) => Number(item.chargeDate.slice(8, 10)) <= 28),
  );

  const future = await call('GET', '/api/bills/2099-01');
  check('an empty month returns zero', future.status === 200 && future.body.bill.total === 0 && future.body.bill.items.length === 0);

  const trimmed = await call('GET', '/api/bills?months=3');
  check('months query param is honoured', trimmed.body.months.length === 3);
  const capped = await call('GET', '/api/bills?months=99');
  check('months query param is capped at 36', capped.body.months.length === 36);
  const floored = await call('GET', '/api/bills?months=0');
  check('months query param floors at 1', floored.body.months.length === 1);
  const junk = await call('GET', '/api/bills?months=abc');
  check('a junk months param falls back to 12', junk.body.months.length === 12);

  const badMonth = await call('GET', '/api/bills/2026-13');
  check('an out-of-range month is rejected with 422', badMonth.status === 422);
  const badFormat = await call('GET', '/api/bills/not-a-month');
  check('a malformed month is rejected with 422', badFormat.status === 422);
}

/* ---------------------------------------------------------- multi-currency */

console.log('\nmulti-currency settlement');
{
  // Seeded data is all CNY, so a single USD row isolates the conversion: the
  // aggregates must bring $10 onto the display currency, not add it as ¥10.
  const rate = DEFAULT_EXCHANGE_RATES.USD;
  const converted = round2(10 * rate);
  const month = TODAY.slice(0, 7);
  const before = (await call('GET', '/api/stats')).body.stats;
  const beforeBill = (await call('GET', `/api/bills/${month}`)).body.bill;
  const beforeList = (await call('GET', '/api/subscriptions')).body.totals;

  const created = await call('POST', '/api/subscriptions', {
    name: '美元演练', amount: 10, currency: 'USD', category: '外币演练', cycle: 'once',
    autoRenew: false, startDate: TODAY, endDate: TODAY,
  });
  const usdId = created.body.subscription.id;
  check('a USD subscription keeps its own currency', created.body.subscription.currency === 'USD');

  const stats = (await call('GET', '/api/stats')).body.stats;
  check('total spend converts USD onto the display currency', stats.spend.total === round2(before.spend.total + converted));
  check('monthly spend converts USD onto the display currency', stats.spend.month === round2(before.spend.month + converted));
  check('upcoming spend converts USD onto the display currency', stats.spend.upcoming === round2(before.spend.upcoming + converted));
  check('category totals convert USD onto the display currency', stats.byCategory.find((c) => c.category === '外币演练')?.amount === converted);

  const bill = (await call('GET', `/api/bills/${month}`)).body.bill;
  check('the statement total converts USD onto the display currency', bill.total === round2(beforeBill.total + converted));
  const charge = bill.items.find((item) => item.id === usdId);
  check('the charge keeps its native amount and currency', charge.amount === 10 && charge.currency === 'USD');
  check('the charge carries the converted amount', charge.displayAmount === converted);

  const list = (await call('GET', '/api/subscriptions')).body.totals;
  check('the subscription list total converts too', list.amount === round2(beforeList.amount + converted));
  check('the subscription list reports the display currency', list.currency === 'CNY');

  // The rate itself must be editable, not hard-coded.
  await call('PUT', '/api/settings', { exchangeRates: JSON.stringify({ ...DEFAULT_EXCHANGE_RATES, USD: 7 }) });
  const raised = (await call('GET', '/api/stats')).body.stats;
  check('a custom exchange rate changes the converted total', raised.spend.total === round2(before.spend.total + 70));
  await call('PUT', '/api/settings', { exchangeRates: JSON.stringify(DEFAULT_EXCHANGE_RATES) });

  // Switching the display currency re-bases every row, USD included.
  await call('PUT', '/api/settings', { currency: 'USD' });
  const inUsd = (await call('GET', '/api/stats')).body.stats;
  check('a USD charge stays $10 when USD is the display currency', inUsd.byCategory.find((c) => c.category === '外币演练')?.amount === 10);
  await call('PUT', '/api/settings', { currency: 'CNY' });

  await call('DELETE', `/api/subscriptions/${usdId}`);
  const restored = (await call('GET', '/api/stats')).body.stats;
  check('deleting the USD subscription restores the totals', restored.spend.total === before.spend.total);
}

/* ---------------------------------------------------------- reminder core */

console.log('\nreminder engine (7-day window)');
{
  const first = await call('POST', '/api/reminders/run');
  check('first run notifies for expiring + expired items', first.body.result.created === 2);
  check('exactly one expiring notification', first.body.result.notifications.filter((n) => n.kind === 'expiring_soon').length === 1);
  check('in-app delivery is recorded', first.body.result.notifications.every((n) => n.status === 'sent' && n.channels === 'inapp'));
  check('expired subscription also notifies', first.body.result.notifications.some((n) => n.kind === 'expired'));
  check('distant subscription is ignored', !first.body.result.notifications.some((n) => n.subscriptionId === ids.far));

  const second = await call('POST', '/api/reminders/run');
  check('second run is idempotent (no duplicates)', second.body.result.created === 0);
  check('duplicates recorded', second.body.result.duplicatesSkipped === 2);

  const list = await call('GET', '/api/notifications');
  check('notifications are listed with subscription name', list.body.notifications.length === 2 && !!list.body.notifications[0].subscriptionName);
  check('unread counter is exposed', list.body.unread === 2);
  check('delivery detail is attached', Array.isArray(list.body.notifications[0].deliveries) && list.body.notifications[0].deliveries[0].channel === 'inapp');

  const read = await call('POST', '/api/notifications/read', {});
  check('mark-all-read clears unread', read.body.unread === 0);
}

/* ------------------------------------------------------------ boundaries */

console.log('\nwall clock boundary (reminder window edge)');
{
  const day8 = await call('POST', '/api/subscriptions', { name: '刚好第 8 天', amount: 10, startDate: TODAY, endDate: addDays(TODAY, 8) });
  const day7 = await call('POST', '/api/subscriptions', { name: '刚好第 7 天', amount: 10, startDate: TODAY, endDate: addDays(TODAY, 7) });
  const day0 = await call('POST', '/api/subscriptions', { name: '今天到期', amount: 10, startDate: TODAY, endDate: TODAY });
  check('day 8 is outside the window', day8.body.subscription.expiringSoon === false);
  check('day 7 is inside the window', day7.body.subscription.expiringSoon === true);
  check('day 0 counts as expiring today', day0.body.subscription.expiringSoon === true);

  const run = await call('POST', '/api/reminders/run');
  check('exactly the 7-day and 0-day items notify', run.body.result.created === 2);

  await call('DELETE', `/api/subscriptions/${day8.body.subscription.id}`);
  await call('DELETE', `/api/subscriptions/${day7.body.subscription.id}`);
  await call('DELETE', `/api/subscriptions/${day0.body.subscription.id}`);
}

/* ------------------------------------------ per-subscription reminder window */

console.log('\nper-subscription reminder window');
{
  // A 7-day plan cannot use a 7-day-ahead reminder — it would fire instantly.
  const shortPlan = await call('POST', '/api/subscriptions', {
    name: '7 天短期订阅', amount: 30, startDate: addDays(TODAY, -2), endDate: addDays(TODAY, 5),
    reminderDays: 3,
  });
  const shortId = shortPlan.body.subscription.id;
  check('per-subscription reminderDays is persisted', shortPlan.body.subscription.reminderDays === 3);
  check('the override is exposed as reminderWindow', shortPlan.body.subscription.reminderWindow === 3);
  check('5 days left is outside a 3-day window', shortPlan.body.subscription.expiringSoon === false);

  const globalOne = await call('POST', '/api/subscriptions', {
    name: '跟随全局窗口', amount: 30, startDate: addDays(TODAY, -2), endDate: addDays(TODAY, 5),
  });
  const globalId = globalOne.body.subscription.id;
  check('omitting reminderDays follows the global window', globalOne.body.subscription.reminderDays === null && globalOne.body.subscription.expiringSoon === true);

  const expiring = await call('GET', '/api/subscriptions?status=expiring');
  check('status=expiring honours the override', expiring.body.items.some((i) => i.id === globalId) && !expiring.body.items.some((i) => i.id === shortId));

  const stats = await call('GET', '/api/stats');
  check('the upcoming list honours the override', stats.body.stats.upcoming.some((i) => i.id === globalId) && !stats.body.stats.upcoming.some((i) => i.id === shortId));

  await call('PUT', `/api/subscriptions/${shortId}`, {
    name: '7 天短期订阅', amount: 30, startDate: addDays(TODAY, -2), endDate: addDays(TODAY, 2),
    reminderDays: 3,
  });
  const run = await call('POST', '/api/reminders/run');
  const notice = run.body.result.notifications.find((n) => n.subscriptionId === shortId);
  check('the engine uses the override for short plans', Boolean(notice) && notice.body.includes('到期前 3 天'));

  const clamped = await call('POST', '/api/subscriptions', { name: '越界窗口', amount: 1, startDate: TODAY, endDate: addDays(TODAY, 40), reminderDays: 200 });
  check('an out-of-range window is clamped to 90', clamped.body.subscription.reminderDays === 90);
  const invalid = await call('POST', '/api/subscriptions', { name: '非法窗口', amount: 1, startDate: TODAY, endDate: addDays(TODAY, 40), reminderDays: 'abc' });
  check('a non-numeric window is rejected with 422', invalid.status === 422);

  for (const id of [shortId, globalId, clamped.body.subscription.id]) {
    await call('DELETE', `/api/subscriptions/${id}`);
  }
}

/* -------------------------------------------------------------- channels */

console.log('\nnotification channels');
{
  const created = await call('POST', '/api/subscriptions', {
    name: 'Figma 专业版', amount: 96, startDate: addDays(TODAY, -5), endDate: addDays(TODAY, 2),
  });
  const figmaId = created.body.subscription.id;

  await call('PUT', '/api/settings', {
    channelWebhookEnabled: true,
    webhookUrl: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test',
    channelTelegramEnabled: true,
    telegramBotToken: '111:abc',
    telegramChatId: '-42',
    channelEmailEnabled: true,
    emailProvider: 'resend',
    emailApiKey: 're_test',
    emailFrom: '提醒 <bot@example.com>',
    emailTo: 'me@example.com, backup@example.com',
  });

  const { result: run, calls } = await withFetch(
    (url) => (url.includes('telegram')
      ? jsonResponse({ ok: true, result: { message_id: 7 } })
      : jsonResponse({ id: 'msg_1' })),
    () => call('POST', '/api/reminders/run'),
  );

  check('every network channel is attempted once', calls.length === 3 && calls.every((c) => c.payload));
  check('reminder reports all four channels as sent', run.body.result.notifications[0].status === 'sent' && run.body.result.notifications[0].channels.split(',').length === 4);

  const webhookCall = calls.find((c) => c.url.includes('qyapi'));
  check('the default webhook payload keeps the generic shape', webhookCall.payload.msgtype === 'text' && webhookCall.payload.text.content.includes('Figma 专业版'));
  check('the generic payload still carries the structured fields', webhookCall.payload.dueDate && typeof webhookCall.payload.daysLeft === 'number');

  const telegramCall = calls.find((c) => c.url.includes('api.telegram.org'));
  check('telegram call targets the configured bot', telegramCall.url === 'https://api.telegram.org/bot111:abc/sendMessage');
  check('telegram payload carries chat_id and text', telegramCall.payload.chat_id === '-42' && telegramCall.payload.text.includes('2 天后到期'));

  const emailCall = calls.find((c) => c.url.includes('resend.com'));
  check('email goes to the Resend API with the key', emailCall.url === 'https://api.resend.com/emails' && emailCall.headers.authorization === 'Bearer re_test');
  check('email splits comma-separated recipients', JSON.stringify(emailCall.payload.to) === '["me@example.com","backup@example.com"]');
  check('email subject is prefixed for the inbox', emailCall.payload.subject.includes('订阅提醒'));

  const notices = await call('GET', '/api/notifications?limit=1');
  check('delivery detail records all four channels', notices.body.notifications[0].deliveries.length === 4);

  console.log('\nwebhook targets');
  {
    /**
     * Fires one reminder for a brand-new subscription (notifications are
     * deduplicated per subscription + due date) and returns the webhook call.
     */
    const fire = async (patch) => {
      const created = await call('POST', '/api/subscriptions', {
        name: '推送目标演练', amount: 9, startDate: TODAY, endDate: addDays(TODAY, 1),
      });
      await call('PUT', '/api/settings', { ...patch, channelInappEnabled: false, channelWebhookEnabled: true, channelTelegramEnabled: false, channelEmailEnabled: false });
      const { calls } = await withFetch(() => jsonResponse({ ok: true }), () => call('POST', '/api/reminders/run'));
      await call('DELETE', `/api/subscriptions/${created.body.subscription.id}`);
      return calls.find((entry) => entry.url.startsWith('https://hook.test'));
    };

    const generic = await fire({ webhookProvider: 'generic', webhookUrl: 'https://hook.test/generic' });
    check('generic posts the msgtype/text envelope', generic.payload.msgtype === 'text' && generic.payload.text.content.includes('推送目标演练'));

    const wecom = await fire({ webhookUrl: 'https://hook.test/wecom', webhookProvider: 'wecom' });
    check('企业微信 gets the robot shape', wecom.payload.msgtype === 'text' && wecom.payload.text.content.length > 0 && wecom.payload.dueDate === undefined);

    const dingtalk = await fire({ webhookUrl: 'https://hook.test/dingtalk', webhookProvider: 'dingtalk' });
    check('钉钉 gets the same robot shape', dingtalk.payload.msgtype === 'text' && dingtalk.payload.text.content.includes('推送目标演练'));
    check('an unsigned 钉钉 URL stays clean', new URL(dingtalk.url).searchParams.get('sign') === null);

    const feishu = await fire({ webhookUrl: 'https://hook.test/feishu', webhookProvider: 'feishu' });
    check('飞书 gets msg_type/content.text instead', feishu.payload.msg_type === 'text' && feishu.payload.content.text.includes('推送目标演练') && feishu.payload.msgtype === undefined);
    check('an unsigned 飞书 payload stays clean', feishu.payload.sign === undefined && feishu.payload.timestamp === undefined);

    // 飞书/钉钉 reject unsigned requests once 「签名校验 / 加签」 is on.
    await call('PUT', '/api/settings', { webhookSecret: 'test-secret' });
    const signedFeishu = await fire({ webhookUrl: 'https://hook.test/feishu', webhookProvider: 'feishu' });
    check('飞书 signs timestamp + secret', typeof signedFeishu.payload.timestamp === 'string' && signedFeishu.payload.sign.length > 0);
    check(
      'the 飞书 signature matches the documented HMAC order',
      signedFeishu.payload.sign === createHmac('sha256', `${signedFeishu.payload.timestamp}\ntest-secret`).update('').digest('base64'),
    );

    const signedDingtalk = await fire({ webhookUrl: 'https://hook.test/dingtalk?access_token=abc', webhookProvider: 'dingtalk' });
    const dingtalkUrl = new URL(signedDingtalk.url);
    check('钉钉 keeps the body free of signature fields', signedDingtalk.payload.sign === undefined && signedDingtalk.payload.timestamp === undefined);
    check('钉钉 keeps the original query parameters', dingtalkUrl.searchParams.get('access_token') === 'abc');
    check(
      '钉钉 sends timestamp + sign as query parameters',
      dingtalkUrl.searchParams.get('sign') === createHmac('sha256', 'test-secret').update(`${dingtalkUrl.searchParams.get('timestamp')}\ntest-secret`).digest('base64'),
    );
    check('钉钉 timestamps in milliseconds', /^\d{13}$/.test(dingtalkUrl.searchParams.get('timestamp')));

    const signedWecom = await fire({ webhookUrl: 'https://hook.test/wecom', webhookProvider: 'wecom' });
    check('企业微信 is left unsigned', signedWecom.payload.sign === undefined);
    await call('PUT', '/api/settings', { webhookSecret: null });

    // Group robots answer HTTP 200 even when they rejected the message.
    const rejected = await call('POST', '/api/subscriptions', {
      name: '推送目标演练', amount: 9, startDate: TODAY, endDate: addDays(TODAY, 1),
    });
    const rejectedId = rejected.body.subscription.id;
    const rejectedRun = await withFetch(
      () => new Response(JSON.stringify({ code: 19021, msg: 'sign match fail' }), { status: 200, headers: { 'content-type': 'application/json' } }),
      () => call('POST', '/api/reminders/run'),
    );
    const rejectedEntry = rejectedRun.result.body.result.notifications.find((n) => n.subscriptionId === rejectedId);
    check('a 200-with-error-code body counts as a failure', rejectedEntry.status === 'failed');
    check('the robot error text is preserved', rejectedEntry.deliveries.some((d) => d.status === 'failed' && d.error.includes('sign match fail')));

    const ntfy = await fire({ webhookUrl: 'https://hook.test/my-topic', webhookProvider: 'ntfy' });
    check('ntfy carries the topic from the URL', ntfy.payload.topic === 'my-topic');
    check('ntfy carries a title and the plain message', typeof ntfy.payload.title === 'string' && ntfy.payload.message.includes('推送目标演练'));
    check('ntfy stays unauthenticated without a token', ntfy.headers.authorization === undefined);

    await call('PUT', '/api/settings', { webhookToken: 'tk_test123' });
    const ntfyBearer = await fire({ webhookUrl: 'https://hook.test/my-topic', webhookProvider: 'ntfy' });
    check('ntfy sends a token as a Bearer header', ntfyBearer.headers.authorization === 'Bearer tk_test123');

    await call('PUT', '/api/settings', { webhookToken: 'user:pass' });
    const ntfyBasic = await fire({ webhookUrl: 'https://hook.test/my-topic', webhookProvider: 'ntfy' });
    check('ntfy falls back to Basic auth for user:password', ntfyBasic.headers.authorization === `Basic ${Buffer.from('user:pass').toString('base64')}`);
    await call('PUT', '/api/settings', { webhookToken: null });

    const ntfyAfterReset = await fire({ webhookUrl: 'https://hook.test/my-topic', webhookProvider: 'ntfy' });
    check('clearing the token removes the header', ntfyAfterReset.headers.authorization === undefined);

    const bark = await fire({ webhookUrl: 'https://hook.test/device-key', webhookProvider: 'bark' });
    check('Bark gets title/body', bark.payload.title.includes('推送目标演练') && typeof bark.payload.body === 'string');

    const serverchan = await fire({ webhookUrl: 'https://hook.test/SCT123.send', webhookProvider: 'serverchan' });
    check('Server 酱 gets title/desp with the due date', serverchan.payload.title.includes('推送目标演练') && serverchan.payload.desp.includes('到期日'));

    const unknown = await call('PUT', '/api/settings', { webhookProvider: 'carrier-pigeon' });
    check('an unknown provider falls back to generic', unknown.body.settings.webhookProvider === 'generic');

    const labelled = await withFetch(() => jsonResponse({ ok: true }), () => call('POST', '/api/settings/test', { channel: 'webhook' }));
    check('the test button reports which target answered', labelled.result.body.result.detail.includes('通用 JSON'));

    await call('DELETE', `/api/subscriptions/${rejectedId}`);

    // Restore the state the failure-handling block below expects.
    await call('PUT', '/api/settings', {
      channelInappEnabled: true,
      channelWebhookEnabled: true,
      channelTelegramEnabled: true,
      channelEmailEnabled: true,
      webhookProvider: 'generic',
      webhookUrl: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test',
    });
  }

  console.log('\nsmtp delivery');
  {
    const server = await startSmtpServer();
    const originalConnector = env.SMTP_CONNECT;
    env.SMTP_CONNECT = smtpConnector();

    await call('PUT', '/api/settings', {
      emailProvider: 'smtp',
      smtpHost: '127.0.0.1',
      smtpPort: server.port,
      smtpSecure: 'tls',
      smtpUser: 'bot@example.com',
      smtpPassword: 's3cret',
      emailFrom: '订阅提醒 <bot@example.com>',
      emailTo: 'me@example.com, backup@example.com',
    });

    const delivered = await call('POST', '/api/settings/test', { channel: 'email' });
    check('smtp delivery reports success', delivered.body.result.status === 'sent');
    check('the detail names the server and port', delivered.body.result.detail.includes(`127.0.0.1:${server.port}`));

    const commands = server.sessions[0]?.commands ?? [];
    const positions = ['EHLO', 'AUTH', 'MAIL FROM', 'RCPT TO', 'DATA', 'QUIT'].map((prefix) =>
      commands.findIndex((line) => line.startsWith(prefix)),
    );
    check('the conversation follows the protocol order', positions.every((position, index) => position >= 0 && (index === 0 || position > positions[index - 1])));
    check('every recipient is addressed', commands.filter((line) => line.startsWith('RCPT TO')).length === 2);
    check(
      'credentials are sent as NUL-separated PLAIN',
      Buffer.from(server.sessions[0].auth.plain, 'base64').toString('utf8') === '\u0000bot@example.com\u0000s3cret',
    );

    const data = server.sessions[0].data;
    check('the subject survives as an RFC 2047 encoded word', decodeHeaderWord(headerLines(data).find((line) => line.startsWith('Subject:'))) === '【订阅提醒】订阅提醒 · 测试消息');
    check('the message declares UTF-8 text', headerLines(data).includes('Content-Type: text/plain; charset=utf-8'));
    check('the body round-trips as base64 UTF-8', decodeBase64Body(data).includes('渠道配置成功'));
    check('the envelope sender is the bare address', commands.some((line) => line === 'MAIL FROM:<bot@example.com>'));

    // 587 / STARTTLS: upgrade before authenticating, then repeat EHLO.
    const starttlsServer = await startSmtpServer({ capabilities: ['fake.local', 'STARTTLS', 'AUTH LOGIN', 'SIZE 10485760'] });
    await call('PUT', '/api/settings', { smtpPort: starttlsServer.port, smtpSecure: 'starttls', smtpUser: '', smtpPassword: null });
    const upgraded = await call('POST', '/api/settings/test', { channel: 'email' });
    check('starttls delivery reports success', upgraded.body.result.status === 'sent');

    const upgradeCommands = starttlsServer.sessions[0]?.commands ?? [];
    check('STARTTLS is requested before any mail command', upgradeCommands.indexOf('STARTTLS') > 0 && upgradeCommands.indexOf('STARTTLS') < upgradeCommands.indexOf('DATA'));
    check('EHLO is repeated after the upgrade', upgradeCommands.filter((line) => line.startsWith('EHLO')).length === 2);
    check('no AUTH without credentials', !upgradeCommands.some((line) => line.startsWith('AUTH')));
    check('the connector saw the TLS-required transport', starttlsServer.sessions[0].secured === true);

    // A server that refuses the recipient must fail loudly, not silently.
    const strictServer = await startSmtpServer({ rejectRecipient: 'nobody@' });
    await call('PUT', '/api/settings', { smtpPort: strictServer.port, smtpSecure: 'tls', emailTo: 'nobody@example.com' });
    const refused = await call('POST', '/api/settings/test', { channel: 'email' });
    check('a rejected recipient fails the delivery', refused.body.result.status === 'failed');
    check('the server reply is surfaced', refused.body.result.error.includes('550'));

    // An unreachable server must not be mistaken for a successful send.
    await call('PUT', '/api/settings', { smtpHost: '127.0.0.1', smtpPort: 1 });
    const unreachable = await call('POST', '/api/settings/test', { channel: 'email' });
    check('an unreachable server fails the delivery', unreachable.body.result.status === 'failed');

    env.SMTP_CONNECT = originalConnector;
    await Promise.all([server.close(), starttlsServer.close(), strictServer.close()]);

    // Restore the Resend configuration the blocks below expect.
    await call('PUT', '/api/settings', {
      emailProvider: 'resend',
      emailApiKey: 're_test',
      emailTo: 'me@example.com, backup@example.com',
      smtpHost: '',
      smtpUser: '',
      smtpPort: 0,
      smtpPassword: null,
    });
  }

  console.log('\nchannel failure handling');
  {
    await call('POST', '/api/notifications/read', {});
    const probe = await call('POST', '/api/subscriptions', {
      name: '故障演练', amount: 15, startDate: TODAY, endDate: addDays(TODAY, 1),
    });
    const { result: failRun } = await withFetch(
      (url) => (url.includes('telegram') ? jsonResponse({ ok: false, description: 'chat not found' }, 400) : jsonResponse({}, 500)),
      () => call('POST', '/api/reminders/run'),
    );
    const entry = failRun.body.result.notifications.find((n) => n.subscriptionId === probe.body.subscription.id);
    check('partial failure is reported, not hidden', entry.status === 'partial');
    check('failed channels keep their error text', entry.deliveries.some((d) => d.status === 'failed' && /chat not found|500/.test(d.error)));

    const notices2 = await call('GET', '/api/notifications?limit=1');
    check('the error is persisted on the record', typeof notices2.body.notifications[0].error === 'string' && notices2.body.notifications[0].error.length > 0);

    await call('DELETE', `/api/subscriptions/${probe.body.subscription.id}`);
  }

  console.log('\nchannel test push (settings UI button)');
  {
    const { result, calls } = await withFetch(() => jsonResponse({ ok: true }), () => call('POST', '/api/settings/test', { channel: 'telegram' }));
    check('test push hits only the requested channel', calls.length === 1 && calls[0].url.includes('api.telegram.org'));
    check('test push reports success', result.status === 200 && result.body.result.status === 'sent');
    check('test push sends a marked test message', calls[0].payload.text.includes('测试消息'));

    const bad = await call('POST', '/api/settings/test', { channel: 'carrier-pigeon' });
    check('unknown channel is rejected', bad.status === 422);
  }

  console.log('\nin-app channel toggle');
  {
    await call('PUT', '/api/settings', { channelInappEnabled: false, channelWebhookEnabled: false, channelTelegramEnabled: false, channelEmailEnabled: false });
    await call('POST', '/api/notifications/read', {});
    const pushed = await call('POST', '/api/subscriptions', { name: '静默订阅', amount: 5, startDate: TODAY, endDate: addDays(TODAY, 1) });
    await call('POST', '/api/reminders/run');

    const notices = await call('GET', '/api/notifications?limit=1');
    check('record is still written for history', notices.body.notifications[0].subscriptionId === pushed.body.subscription.id);
    check('status reflects that nothing was delivered', notices.body.notifications[0].status === 'skipped');
    check('disabled in-app channel does not raise unread count', notices.body.unread === 0);

    await call('PUT', '/api/settings', { channelInappEnabled: true });
    await call('DELETE', `/api/subscriptions/${pushed.body.subscription.id}`);
    await call('DELETE', `/api/subscriptions/${figmaId}`);
  }
}

/* ------------------------------------------------------------- web push */

console.log('\nweb push (VAPID + RFC 8291)');
{
  const toB64url = (bytes) => Buffer.from(bytes).toString('base64url');
  const fromB64url = (value) => new Uint8Array(Buffer.from(value, 'base64url'));
  const join = (...parts) => {
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    for (const part of parts) { out.set(part, offset); offset += part.length; }
    return out;
  };
  const hkdf = async (salt, ikm, info, length) => {
    const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
    return new Uint8Array(
      await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8),
    );
  };

  // A stand-in for the browser: a P-256 ECDH pair plus a 16-byte auth secret.
  const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const uaPublic = new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey));
  const authSecret = crypto.getRandomValues(new Uint8Array(16));
  const encoder = new TextEncoder();

  /** Decrypts an `aes128gcm` body exactly the way a browser would. */
  async function readPush(body) {
    const salt = body.slice(0, 16);
    const idLength = body[20];
    const asPublic = body.slice(21, 21 + idLength);
    const ciphertext = body.slice(21 + idLength);
    const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const shared = new Uint8Array(
      await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, ua.privateKey, 256),
    );
    const ikm = await hkdf(authSecret, shared, join(encoder.encode('WebPush: info\0'), uaPublic, asPublic), 32);
    const cek = await hkdf(salt, ikm, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
    const nonce = await hkdf(salt, ikm, encoder.encode('Content-Encoding: nonce\0'), 12);
    const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
    const plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ciphertext));
    return { pad: plaintext[plaintext.length - 1], body: JSON.parse(new TextDecoder().decode(plaintext.slice(0, -1))) };
  }

  /** Verifies the ES256 VAPID JWT against the advertised public key. */
  async function verifyVapid(header, publicKey) {
    const match = /^vapid t=([^,]+),k=(.+)$/.exec(header ?? '');
    if (!match) return { ok: false };
    const [head, payload, signature] = match[1].split('.');
    const point = fromB64url(match[2]);
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: 'EC', crv: 'P-256', x: toB64url(point.slice(1, 33)), y: toB64url(point.slice(33, 65)) },
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' }, key, fromB64url(signature), encoder.encode(`${head}.${payload}`),
    );
    return { ok: ok && match[2] === publicKey, payload: JSON.parse(new TextDecoder().decode(fromB64url(payload))) };
  }

  /** Collects outbound requests without assuming a JSON body (push is binary). */
  async function withPushFetch(status, run) {
    const original = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, init = {}) => {
      calls.push({ url: String(url), init });
      return new Response('', { status });
    };
    try {
      return { result: await run(), calls };
    } finally {
      globalThis.fetch = original;
    }
  }

  await call('PUT', '/api/settings', {
    channelPushEnabled: true,
    channelWebhookEnabled: false,
    channelTelegramEnabled: false,
    channelEmailEnabled: false,
  });

  const key = await call('GET', '/api/push/key');
  check('push key endpoint returns a 65-byte VAPID point', key.status === 200 && fromB64url(key.body.publicKey).length === 65 && fromB64url(key.body.publicKey)[0] === 4);
  check('a fresh database has no push devices', key.body.devices === 0);

  const subscription = { endpoint: 'https://push.example.com/sub/device-1', keys: { p256dh: toB64url(uaPublic), auth: toB64url(authSecret) }, userAgent: 'smoke-test' };
  const subscribed = await call('POST', '/api/push/subscribe', subscription);
  check('a browser subscription is stored', subscribed.status === 201 && subscribed.body.devices === 1);

  await call('POST', '/api/push/subscribe', subscription);
  check('re-subscribing the same endpoint does not duplicate', (await call('GET', '/api/push/key')).body.devices === 1);

  const rejected = await call('POST', '/api/push/subscribe', { endpoint: 'http://insecure.example.com', keys: {} });
  check('an insecure endpoint is rejected with 422', rejected.status === 422 && rejected.body.error.details.length === 3);

  const probe = await call('POST', '/api/subscriptions', { name: '推送演练', amount: 20, startDate: TODAY, endDate: addDays(TODAY, 2) });
  const pushed = await withPushFetch(201, () => call('POST', '/api/reminders/run'));
  const entry = pushed.result.body.result.notifications.find((n) => n.subscriptionId === probe.body.subscription.id);
  check('the reminder decides to push', entry.channels.split(',').includes('push'));
  check('the push delivery is recorded as sent', entry.deliveries.some((d) => d.channel === 'push' && d.status === 'sent'));
  check('exactly one request reaches the stored endpoint', pushed.calls.length === 1 && pushed.calls[0].url === subscription.endpoint);

  const request = pushed.calls[0].init;
  check('the request uses the aes128gcm encoding', request.headers['content-encoding'] === 'aes128gcm' && request.headers['content-type'] === 'application/octet-stream');
  check('the payload is sent as a binary record', request.body instanceof Uint8Array && request.body.length > 100);

  const jwt = await verifyVapid(request.headers.authorization, key.body.publicKey);
  check('the VAPID JWT verifies against the advertised key', jwt.ok === true);
  check('the VAPID audience is the push service origin', jwt.payload.aud === 'https://push.example.com');

  const decrypted = await readPush(request.body);
  check('the browser can decrypt the payload', decrypted.body.title.includes('推送演练') && decrypted.body.body.includes('到期'));
  check('the record ends with the final-record padding byte', decrypted.pad === 2);
  check('the payload deep-links into the app', decrypted.body.url === '/reminders' && decrypted.body.daysLeft === 2);

  const testPush = await withPushFetch(201, () => call('POST', '/api/settings/test', { channel: 'push' }));
  check('the settings test button reaches the device', testPush.calls.length === 1 && testPush.result.body.result.status === 'sent');
  check('the test message is marked as a probe', (await readPush(testPush.calls[0].init.body)).body.title.includes('测试消息'));

  const cleanupProbe = await call('POST', '/api/subscriptions', { name: '清理演练', amount: 5, startDate: TODAY, endDate: addDays(TODAY, 1) });
  const culled = await withPushFetch(410, () => call('POST', '/api/reminders/run'));
  check('an expired subscription is still scanned', culled.calls.length === 1);
  check('a 410 response prunes the dead device', (await call('GET', '/api/push/key')).body.devices === 0);

  const unsubscribed = await call('POST', '/api/push/unsubscribe', { endpoint: subscription.endpoint });
  check('unsubscribe is idempotent for unknown endpoints', unsubscribed.status === 200 && unsubscribed.body.devices === 0);

  await call('DELETE', `/api/subscriptions/${probe.body.subscription.id}`);
  await call('DELETE', `/api/subscriptions/${cleanupProbe.body.subscription.id}`);
  await call('PUT', '/api/settings', { channelPushEnabled: false });
  check('push starts disabled again', (await call('GET', '/api/bootstrap')).body.settings.channelPushEnabled === false);
}

/* ---------------------------------------------------------- update/delete */

console.log('\nupdate & delete');
{
  const updated = await call('PUT', `/api/subscriptions/${ids.monthly}`, {
    name: 'ChatGPT Team', amount: 200, startDate: addDays(TODAY, -10), endDate: addDays(TODAY, 20),
  });
  check('PUT updates the subscription', updated.body.subscription.name === 'ChatGPT Team' && updated.body.subscription.amount === 200);

  const invalidUpdate = await call('PUT', `/api/subscriptions/${ids.monthly}`, { name: '', amount: 1, startDate: TODAY, endDate: TODAY });
  check('PUT validates payload', invalidUpdate.status === 422);

  const missing = await call('PUT', '/api/subscriptions/does-not-exist', { name: 'x', amount: 1, startDate: TODAY, endDate: TODAY });
  check('PUT on unknown id returns 404', missing.status === 404);

  const removed = await call('DELETE', `/api/subscriptions/${ids.soon}`);
  check('DELETE removes the subscription', removed.status === 200 && removed.body.ok === true);

  const gone = await call('GET', `/api/subscriptions/${ids.soon}`);
  check('deleted subscription is gone', gone.status === 404);

  const orphaned = await call('GET', '/api/notifications');
  check('cascade clears notifications of deleted subscription', !orphaned.body.notifications.some((n) => n.subscriptionId === ids.soon));

  const statsAfter = await call('GET', '/api/stats');
  check('stats recompute after delete', statsAfter.body.stats.spend.total === 1186 - 78 + 60);
}

/* ------------------------------------------------------ auto-renew rolling */

console.log('\nauto-renew rolling');
{
  check(
    'month-end cycles keep their anchor day instead of drifting',
    addCycles('2026-01-31', 'monthly', 1) === '2026-02-28' && addCycles('2026-01-31', 'monthly', 2) === '2026-03-31',
  );

  const start = addDays(TODAY, -100);
  const created = await call('POST', '/api/subscriptions', {
    name: '自动续费演练', amount: 30, cycle: 'monthly', autoRenew: true,
    startDate: start, endDate: addDays(TODAY, -5),
  });
  const id = created.body.subscription.id;
  check('a lapsed renewing subscription is rolled the moment it is read', created.body.subscription.daysLeft >= 0 && created.body.subscription.statusLabel === 'active');
  check('the roll lands on the next cycle boundary', created.body.subscription.daysLeft <= 31);
  check('the start date stays put so past months keep their charges', created.body.subscription.startDate === start);

  const listed = await call('GET', '/api/subscriptions');
  const rolled = listed.body.items.find((item) => item.id === id);
  check('the list shows the same rolled dates as the detail view', rolled.endDate === created.body.subscription.endDate);

  const reopened = await call('GET', `/api/subscriptions/${id}`);
  check('rolling twice changes nothing', reopened.body.subscription.endDate === rolled.endDate);

  // Lapsed for months: it must catch up to the *current* period, not the next one.
  const weekly = await call('POST', '/api/subscriptions', {
    name: '长期欠费演练', amount: 12, cycle: 'weekly', autoRenew: true,
    startDate: addDays(TODAY, -365), endDate: addDays(TODAY, -300),
  });
  const weeklyView = await call('GET', `/api/subscriptions/${weekly.body.subscription.id}`);
  check('a weekly subscription lapsed for a year catches up in one step', weeklyView.body.subscription.daysLeft >= 0 && weeklyView.body.subscription.daysLeft < 7);

  const fixed = await call('POST', '/api/subscriptions', {
    name: '不续费演练', amount: 5, cycle: 'monthly', autoRenew: false,
    startDate: addDays(TODAY, -40), endDate: addDays(TODAY, -10),
  });
  const fixedView = await call('GET', `/api/subscriptions/${fixed.body.subscription.id}`);
  check('without auto-renew the subscription stays expired', fixedView.body.subscription.daysLeft === -10);

  const oneOff = await call('POST', '/api/subscriptions', {
    name: '买断演练', amount: 5, cycle: 'once', autoRenew: true,
    startDate: addDays(TODAY, -40), endDate: addDays(TODAY, -10),
  });
  const oneOffView = await call('GET', `/api/subscriptions/${oneOff.body.subscription.id}`);
  check('a one-off purchase has no next cycle to roll into', oneOffView.body.subscription.daysLeft === -10);

  const paused = await call('POST', '/api/subscriptions', {
    name: '暂停演练', amount: 5, cycle: 'monthly', autoRenew: true, status: 'paused',
    startDate: addDays(TODAY, -40), endDate: addDays(TODAY, -10),
  });
  const pausedView = await call('GET', `/api/subscriptions/${paused.body.subscription.id}`);
  check('a paused subscription is left alone', pausedView.body.subscription.daysLeft === -10);

  const startBill = await call('GET', `/api/bills/${start.slice(0, 7)}`);
  check('a rolled subscription keeps its earlier charges on the statement', startBill.body.bill.items.some((item) => item.id === id));

  await call('POST', '/api/reminders/run');
  const notices = await call('GET', '/api/notifications?limit=200');
  check('a rolled subscription is never reported as expired', !notices.body.notifications.some((n) => n.subscriptionId === id && n.kind === 'expired'));

  const ids = [id, weekly.body.subscription.id, fixed.body.subscription.id, oneOff.body.subscription.id, paused.body.subscription.id];
  for (const subscriptionId of ids) await call('DELETE', `/api/subscriptions/${subscriptionId}`);
  const left = await call('GET', '/api/subscriptions');
  check('auto-renew fixtures are cleaned up', ids.every((subscriptionId) => !left.body.items.some((item) => item.id === subscriptionId)));
}

console.log('\nmanual renewal');
{
  // The everyday case: the payment went through, the panel just does not know.
  const created = await call('POST', '/api/subscriptions', {
    name: '手动续期演练', amount: 20, cycle: 'monthly', autoRenew: false,
    startDate: addDays(TODAY, -28), endDate: addDays(TODAY, 2),
  });
  const id = created.body.subscription.id;
  const before = created.body.subscription.endDate;

  const renewed = await call('POST', `/api/subscriptions/${id}/renew`);
  check('renewing answers with the updated subscription', renewed.status === 200 && renewed.body.previousEndDate === before);
  check('the due date moves on by exactly one cycle', renewed.body.subscription.endDate === addCycles(before, 'monthly', 1));
  check('the renewal records the day it was paid', renewed.body.charge.paidAt === TODAY);
  const renewedBill = await call('GET', `/api/bills/${TODAY.slice(0, 7)}`);
  check(
    'a renewal lands on this month statement straight away',
    renewedBill.body.bill.items.some((item) => item.id === id && item.chargeDate === TODAY),
  );
  check('a subscription without auto-renew can still be renewed by hand', renewed.body.subscription.autoRenew === false && renewed.body.subscription.daysLeft > 2);

  const twice = await call('POST', `/api/subscriptions/${id}/renew`);
  check('clicking again adds another cycle', twice.body.subscription.endDate === addCycles(before, 'monthly', 2));

  // Owed for months: one click has to bring it back into the current period.
  const behind = await call('POST', '/api/subscriptions', {
    name: '欠费补缴演练', amount: 20, cycle: 'monthly', autoRenew: false,
    startDate: addDays(TODAY, -200), endDate: addDays(TODAY, -100),
  });
  const caughtUp = await call('POST', `/api/subscriptions/${behind.body.subscription.id}/renew`);
  check('a subscription in arrears catches up to this period in one click', caughtUp.body.subscription.daysLeft >= 0);

  const weekly = await call('POST', '/api/subscriptions', {
    name: '按周续期演练', amount: 5, cycle: 'weekly', autoRenew: false,
    startDate: addDays(TODAY, -5), endDate: addDays(TODAY, 1),
  });
  const weeklyRenewed = await call('POST', `/api/subscriptions/${weekly.body.subscription.id}/renew`);
  check('a weekly subscription moves on by seven days', weeklyRenewed.body.subscription.endDate === addDays(TODAY, 8));

  const oneOff = await call('POST', '/api/subscriptions', {
    name: '买断续期演练', amount: 5, cycle: 'once', autoRenew: false,
    startDate: addDays(TODAY, -5), endDate: addDays(TODAY, 1),
  });
  const refused = await call('POST', `/api/subscriptions/${oneOff.body.subscription.id}/renew`);
  check('a one-off purchase refuses to renew', refused.status === 422 && refused.body.error.message.includes('一次性买断'));

  const missing = await call('POST', '/api/subscriptions/does-not-exist/renew');
  check('renewing an unknown subscription is a 404', missing.status === 404);

  const ids = [id, behind.body.subscription.id, weekly.body.subscription.id, oneOff.body.subscription.id];
  for (const subscriptionId of ids) await call('DELETE', `/api/subscriptions/${subscriptionId}`);
  const left = await call('GET', '/api/subscriptions');
  check('manual renewal fixtures are cleaned up', ids.every((subscriptionId) => !left.body.items.some((item) => item.id === subscriptionId)));
}

/* ------------------------------------------------------------- throttling */

/* ---------------------------------------------------------- schema bootstrap */

console.log('\nschema bootstrap');
{
  // schema.sql is generated from src/schema.js; drift would mean the file people
  // apply by hand no longer matches what the worker creates at runtime.
  const onDisk = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
  check('worker/schema.sql matches the runtime schema', onDisk.trimEnd() === SCHEMA_SQL.trimEnd());

  // Nothing is applied by hand here: the first request builds the database.
  const fresh = createD1();
  const booted = await worker.fetch(new Request('https://api.test/api/public'), { ...env, DB: fresh });
  const tables = fresh._sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name);
  check('an empty database gets its tables on the first request', booted.status === 200 && ['subscriptions', 'settings', 'notifications', 'payments', 'push_subscriptions'].every((name) => tables.includes(name)));

  const seeded = fresh._sqlite.prepare('SELECT COUNT(*) AS n FROM settings').get().n;
  check('every setting is seeded with its default', seeded === Object.keys(SETTINGS_SCHEMA).length);

  // A database from before the column additions must pick them up. Dropping the
  // two columns from the current schema is exactly the shape it had back then.
  const v1 = onDisk
    .replace(/^\s*reminder_days INTEGER,.*\n/m, '')
    .replace(/^\s*deliveries\s+TEXT,\n/m, '');
  const legacy = createD1();
  legacy._sqlite.exec(v1);
  const upgraded = await worker.fetch(new Request('https://api.test/api/public'), { ...env, DB: legacy });
  const columnsOf = (table) => legacy._sqlite.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name);
  check('an older database gains the columns added since', upgraded.status === 200 && columnsOf('notifications').includes('deliveries') && columnsOf('subscriptions').includes('reminder_days'));

  // Running it against a database that already has everything hits the
  // "duplicate column name" error the upgrades are written to swallow.
  const current = createD1();
  current._sqlite.exec(onDisk);
  const rerun = await worker.fetch(new Request('https://api.test/api/public'), { ...env, DB: current });
  check('re-running the bootstrap on an up-to-date database is a no-op', rerun.status === 200);
}

/* --------------------------------------------------------------- hardening */

console.log('\nfront-end routing');
{
  // The built SPA ships as static assets next to the API: the Worker hands every
  // non-API path over to them, and /api/* never ends up in the asset layer.
  const assets = {
    fetch: (request) =>
      new Response(`<!doctype html>spa:${new URL(request.url).pathname}`, {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
  };
  const spa = await worker.fetch(new Request('https://api.test/bills?months=3'), { ...env, ASSETS: assets });
  check('a page request is served from the assets binding', spa.status === 200 && (await spa.text()).includes('spa:/bills'));

  const unknownApi = await worker.fetch(new Request('https://api.test/api/nope'), { ...env, ASSETS: assets });
  check('the assets never swallow an /api path', !unknownApi.headers.get('location') && unknownApi.headers.get('content-type')?.includes('json'));

  const missingAsset = { fetch: () => new Response('not found', { status: 404 }) };
  const notFound = await worker.fetch(new Request('https://api.test/login'), { ...env, ASSETS: missingAsset });
  check('a miss in the assets falls through to the JSON 404', notFound.status === 404);

  const noAssets = await worker.fetch(new Request('https://api.test/login'), env);
  check('without an assets binding the JSON 404 stays', noAssets.status === 404);
}

console.log('\nrequest hardening');
{
  // A stray `%` used to reach decodeURIComponent and crash the request.
  const malformed = await call('GET', '/api/subscriptions/%zz');
  check('a malformed path parameter is a 404, not a crash', malformed.status === 404 && Boolean(malformed.body.error.message));

  const malformedBills = await call('GET', '/api/bills/%25');
  check('the same holds for other parameterised routes', malformedBills.status === 422);

  const brokenDb = {
    prepare() {
      throw new Error('D1_ERROR: SELECT * FROM settings WHERE key = "smtp_password"');
    },
  };
  const request = () => new Request('https://api.test/api/stats', { headers: { authorization: `Bearer ${token}` } });
  // The handler logs the failure on purpose; keep the test output readable.
  const logged = console.error;
  console.error = () => {};
  const opaque = await worker.fetch(request(), { ...env, DB: brokenDb });
  const verbose = await worker.fetch(request(), { ...env, DB: brokenDb, DEBUG_ERRORS: '1' });
  console.error = logged;

  const opaqueBody = await opaque.json();
  check('an internal error answers 500', opaque.status === 500);
  check('the driver message stays out of the response by default', opaqueBody.error.details === null && !JSON.stringify(opaqueBody).includes('smtp_password'));

  const verboseBody = await verbose.json();
  check('DEBUG_ERRORS surfaces the message for local debugging', verboseBody.error.details.includes('D1_ERROR'));
}

console.log('\nlogin throttling');
{
  let blocked = null;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const response = await call('POST', '/api/auth/login', { username: 'admin', password: `wrong-${attempt}` }, { auth: false });
    if (response.status === 429) { blocked = response; break; }
  }
  check('repeated failures are throttled with 429', blocked !== null);
  check('throttle tells the client when to retry', typeof blocked.body.error.details?.retryAfter === 'number');

  const stillAllowed = await call('POST', '/api/auth/login', { username: 'admin', password: 'wrong-again' }, { auth: false });
  check('existing sessions keep working while throttled', stillAllowed.status === 429);
  const session = await call('GET', '/api/auth/session');
  check('valid token is unaffected by the login throttle', session.body.authenticated === true);
}

console.log(`\n✅ ${passed} assertions passed\n`);
