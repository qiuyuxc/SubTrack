/**
 * Runtime render check.
 *
 * Builds an SSR bundle of every view, wires the front-end to the *real* Worker
 * handler running on an in-memory D1 database, and renders each route to a
 * string. This catches runtime errors that `vite build` alone cannot see
 * (undefined refs, bad computed access, template access on null state).
 *
 * Run with: npm run test:render
 */
import assert from 'node:assert/strict';
import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { createMemoryHistory } from 'vue-router';

import App from '../src/App.vue';
import { createAppRouter } from '../src/router.js';
import { createSubscription, loadBootstrap, loadPublicConfig, login, saveSettings, state } from '../src/store.js';
import worker from '../../worker/src/index.js';
import schemaSql from '../../worker/schema.sql?raw';
import seedSql from '../../worker/seed.sql?raw';
import { createD1 } from '../../worker/test/d1-shim.mjs';
import { addDays, todayIn } from '../../worker/src/utils.js';

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

globalThis.fetch = async (input, init = {}) => {
  const target = typeof input === 'string' ? input : input.url;
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

async function render(path) {
  // The real router (and its guard) so the tests cover actual navigation.
  const router = createAppRouter(createMemoryHistory());
  const app = createSSRApp(App);
  app.use(router);
  await router.push(path);
  await router.isReady();
  return renderToString(app);
}

async function main() {
console.log('\nFront-end render check\n');

console.log('authentication');
{
  const loginPage = await render('/login');
  check('login page renders the sign-in form', loginPage.includes('登录以查看订阅'));
  check('login page states there is no sign-up', loginPage.includes('不提供注册入口'));
  check('login page is not wrapped in the app shell', !loginPage.includes('brand__name'));

  const anonymous = await fetch('/api/bootstrap');
  check('API rejects anonymous requests with 401', anonymous.status === 401);

  // Anonymous visitors read a tiny public slice of settings to pick the root page.
  const publicConfig = await (await fetch('/api/public')).json();
  check('public config is readable without a token', publicConfig.showHero === false && publicConfig.reminderDays === 7);

  db._sqlite.exec("UPDATE settings SET value = '1' WHERE key = 'show_hero'");
  await loadPublicConfig({ force: true });
  const guestLanding = await render('/');
  check('anonymous root becomes the landing page when enabled', guestLanding.includes('管好每一笔订阅'));
  check('guest landing offers sign-in instead of app actions', guestLanding.includes('登录查看订阅') && !guestLanding.includes('添加订阅'));
  check('guest landing hides the signed-in nav links', !guestLanding.includes('nav__link'));

  db._sqlite.exec("UPDATE settings SET value = '0' WHERE key = 'show_hero'");
  await loadPublicConfig({ force: true });
  const guestRoot = await render('/');
  check('anonymous root falls back to the login screen', guestRoot.includes('登录以查看订阅') && !guestRoot.includes('管好每一笔订阅'));

  await loadBootstrap();
  check('bootstrap is a no-op while signed out', state.ready === false && state.auth.authenticated === false);

  let rejected = null;
  try {
    await login(ADMIN_USERNAME, 'not-the-password');
  } catch (error) {
    rejected = error;
  }
  check('wrong password is rejected with 401', rejected?.status === 401);
  check('a failed login leaves the session signed out', state.auth.authenticated === false);

  await login(ADMIN_USERNAME, ADMIN_PASSWORD);
  check('valid credentials sign the admin in', state.auth.authenticated === true && state.auth.username === ADMIN_USERNAME);
  check('state is ready after login', state.ready === true);
  check('stats were hydrated from D1', (state.stats?.counts.total ?? 0) === 7);
  check('settings default to a 7-day window', state.settings.reminderDays === 7);
}

console.log('\nroot route (front door)');
{
  // Landing off + signed in → the root sends you to the overview.
  const off = await render('/');
  check('root without a landing page redirects to the overview', off.includes('>概览<') && off.includes('page__head'));
  const overview = await render('/dashboard');
  check('the overview sits at /dashboard', overview.includes('page__head') && overview.includes('>概览<'));
  check('the title bar names the page, not the brand', /class="brand__name brand__name--page"[^>]*>概览</.test(overview));
  check('the overview title bar drops the brand tagline', !overview.includes('brand__sub'));
  check('app pages drop the brand mark', !overview.includes('brand__mark'));
  check('app pages drop the footer', !overview.includes('footer__inner'));

  await saveSettings({ showHero: true });
  check('the landing switch persists to settings', state.settings.showHero === true);

  const landing = await render('/');
  check('root becomes the landing page once enabled', landing.includes('管好每一笔订阅'));
  check('landing page emits the mesh gradient', landing.includes('mesh__blob--develop'));
  check('the landing page keeps the brand in the title bar', landing.includes('brand__sub') && landing.includes('SubTrack'));
  check('the landing page keeps the brand mark', landing.includes('brand__mark'));
  check('the footer lives on the landing page', landing.includes('footer__inner'));
  check('landing page lists its feature cards', ['到期前自动提醒', '账单按月自动汇总', '多渠道通知'].every((t) => landing.includes(t)));
  check('landing page links into the overview', landing.includes('进入概览'));
  check('the legacy /landing path still resolves', (await render('/landing')).includes('管好每一笔订阅'));

  const authedOverview = await render('/dashboard');
  check('the overview stays hero-free while the landing page is on', !authedOverview.includes('mesh__blob--develop') && authedOverview.includes('>概览<'));
  check('the overview links back to the landing page', authedOverview.includes('打开落地页'));
}

console.log('\napp mode (SSR)');
{
  // The app shell is viewport-driven, so the server pass can only assert that
  // enabling app mode never breaks rendering and never leaks the tab bar into
  // the SSR markup. The jsdom pass covers the phone-sized shell itself.
  await saveSettings({ appMode: true });
  check('the app-mode switch persists to settings', state.settings.appMode === true);
  check('the public config exposes app mode', (await (await fetch('/api/public')).json()).appMode === true);

  const overview = await render('/dashboard');
  check('app mode still renders the overview', overview.includes('>概览<'));
  check('SSR never renders the bottom tab bar', !overview.includes('tabbar'));
  check('SSR keeps the desktop nav links without matchMedia', overview.includes('nav__links'));

  const settings = await render('/settings');
  check('settings list the app-mode switch', settings.includes('App 模式'));

  await saveSettings({ appMode: false });
  check('app mode can be switched back off', state.settings.appMode === false);
}

console.log('\ndashboard (/dashboard)');
{
  const html = await render('/dashboard');
  check('renders the 总消费金额 card', html.includes('总消费金额'));
  check('renders the 剩余额度 card', html.includes('剩余额度'));
  check('renders the 即将到期 card', html.includes('即将到期'));
  check('lists the expiring Netflix subscription', html.includes('Netflix 高级版'));
  check('shows a countdown label', html.includes('天后到期') || html.includes('今天到期'));
  check('renders the category breakdown', html.includes('支出分布') && html.includes('云服务'));
  check('renders the 6-month timeline', html.includes('月度趋势'));
  check('renders the recent-subscriptions section', html.includes('最近添加'));
}

console.log('\nsubscriptions (/subscriptions)');
{
  const html = await render('/subscriptions');
  check('renders the page heading', html.includes('订阅列表'));
  check('renders every status tab', ['全部', '生效中', '即将到期', '已过期', '已暂停', '已取消'].every((t) => html.includes(t)));
  check('renders the search box', html.includes('搜索名称 / 服务商 / 分类'));
  // Client-side fetches run in onMounted, which SSR never calls — so the
  // server pass asserts the shell and the jsdom pass asserts the rows.
  check('renders the loading shell before the client fetch', html.includes('加载中'));
  check('renders the sort control', html.includes('到期时间（近→远）'));
}

console.log('\nreminders (/reminders)');
{
  const html = await render('/reminders');
  check('renders the page heading', html.includes('到期提醒'));
  check('explains the reminder window', html.includes('默认提前'));
  check('renders the 提醒窗口 summary', html.includes('提醒窗口') && html.includes('7 天'));
  check('renders the pending list', html.includes('当前待处理'));
  check('shows the cron schedule', html.includes('0 1 * * *'));
  check('renders an empty notice list before any scan', html.includes('还没有提醒记录'));
  check('explains the per-subscription reminder window', html.includes('单独设置'));
}

console.log('\nbills (/bills)');
{
  const html = await render('/bills');
  check('renders the bills heading', html.includes('>账单<'));
  check('renders the three summary cards', ['本月账单', '近 12 个月合计', '月均支出'].every((t) => html.includes(t)));
  check('renders the month statement card', html.includes('月度账单'));
  // The list itself is fetched on mount, so SSR only asserts the shell.
  check('renders the loading shell before the client fetch', html.includes('正在生成账单'));
}

console.log('\nsettings (/settings)');
{
  const html = await render('/settings');
  check('renders the page heading', html.includes('系统设置'));
  check('renders the budget field', html.includes('月度预算'));
  check('renders the reminder-days field', html.includes('提前提醒天数'));
  check('renders the interface card with the landing switch', html.includes('启用落地页'));
  check('renders the notification-channel cards', ['站内提醒', '浏览器推送', 'Webhook 推送', 'Telegram Bot', '邮件通知'].every((c) => html.includes(c)));
  check('previews the remaining allowance', html.includes('剩余额度'));
  check('renders the current-status panel', html.includes('累计消费'));
  check('names the signed-in admin', html.includes('admin'));
}

console.log('\nmutation flow (create → re-render)');
{
  await createSubscription({
    name: '渲染测试订阅',
    vendor: 'Renderer',
    category: '开发工具',
    amount: 42,
    startDate: TODAY,
    endDate: addDays(TODAY, 3),
    autoRenew: true,
  });
  check('store receives a success toast', state.toasts.some((t) => t.tone === 'success'));
  check('stats refresh to 8 subscriptions', state.stats.counts.total === 8);

  const html = await render('/dashboard');
  check('new subscription appears on the dashboard', html.includes('渲染测试订阅'));
  check('total spend picked up the new amount', state.stats.spend.total === 1302 + 42);
  check('toast is rendered into the DOM', html.includes('toast__text'));

  const reminders = await render('/reminders');
  check('expiring count increased to 3', state.stats.counts.expiringSoon === 3);
  check('new subscription shows in pending list', reminders.includes('渲染测试订阅'));
}

console.log(`\n✅ ${passed} assertions passed\n`);
}

main().catch((error) => {
  console.error(`\n❌ ${error?.message ?? error}\n`);
  process.exitCode = 1;
});
