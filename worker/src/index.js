import { Router } from './router.js';
import {
  computeStats, countPushSubscriptions, createSubscription, deletePushSubscription, deleteSubscription,
  getBill, getSettings, getSubscription, isBillMonth, listBills, listNotifications, listSubscriptions,
  markNotificationsRead, publicSettings, savePushSubscription, saveSettings, unreadCount, updateSubscription,
} from './db.js';
import { getVapidKeys } from './push.js';
import { runReminders } from './reminder.js';
import { CHANNEL_IDS, deliverOne } from './notify.js';
import { authenticate, clearLoginFailures, createToken, getAuthConfig, loginThrottle, recordLoginFailure, verifyCredentials } from './auth.js';
import { fail, json, readJson, str, todayIn } from './utils.js';
import { ensureSchema } from './bootstrap.js';

const router = new Router();

/** Reachable without a session. Everything else under /api/ needs a token. */
const PUBLIC_PATHS = new Set([
  '/api/health',
  '/api/public',
  '/api/auth/login',
  '/api/auth/session',
  '/api/auth/logout',
]);

function corsHeaders(request, env) {
  const allowed = env.ALLOWED_ORIGIN || '*';
  const origin = request.headers.get('origin') || '';
  const allowOrigin =
    allowed === '*' ? '*' : allowed.split(',').map((s) => s.trim()).find((o) => o === origin) || allowed.split(',')[0].trim();
  return {
    'access-control-allow-origin': allowOrigin,
    'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization',
    'access-control-max-age': '86400',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    vary: 'origin',
  };
}

/* -------------------------------------------------------------------- auth */

router.get('/api/health', () => json({ ok: true, service: 'subtrack-worker', time: new Date().toISOString() }));

/**
 * Anonymous visitors need to know whether `/` is the landing page before they
 * have a session, so this tiny slice of settings is public on purpose.
 */
router.get('/api/public', async (request, env) => {
  const settings = await getSettings(env.DB);
  return json({
    showHero: Boolean(settings.showHero),
    appMode: Boolean(settings.appMode),
    reminderDays: settings.reminderDays,
    currency: settings.currency,
  });
});

router.post('/api/auth/login', async (request, env) => {
  const throttle = loginThrottle(request);
  if (throttle.blocked) {
    return fail(429, '登录失败次数过多，请稍后再试', { retryAfter: throttle.retryAfter });
  }

  const body = await readJson(request);
  const username = str(body?.username, { max: 120 });
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!username || !password) return fail(400, '请输入用户名和密码');

  const result = await verifyCredentials(username, password, env);
  if (result.error === 'config') {
    return fail(503, '服务端未配置管理员账号，请设置 ADMIN_USERNAME / ADMIN_PASSWORD');
  }
  if (result.error) {
    recordLoginFailure(request);
    return fail(401, '用户名或密码错误');
  }

  clearLoginFailures(request);
  const config = getAuthConfig(env);
  return json({ token: await createToken(result.username, config.secret), username: result.username });
});

router.post('/api/auth/logout', () => json({ ok: true }));

router.get('/api/auth/session', async (request, env) => {
  const auth = await authenticate(request, env);
  if (!auth.ok) return json({ authenticated: false, reason: auth.message });
  return json({ authenticated: true, username: auth.username, expiresAt: auth.expiresAt });
});

/* ---------------------------------------------------------------- settings */

router.get('/api/settings', async (request, env) => json({ settings: publicSettings(await getSettings(env.DB)) }));

router.put('/api/settings', async (request, env) => {
  const body = await readJson(request);
  if (!body || typeof body !== 'object') return fail(400, '请求体必须是 JSON 对象');
  return json({ settings: publicSettings(await saveSettings(env.DB, body)) });
});

/** "发送测试消息" button in the notification-channel dialog. */
router.post('/api/settings/test', async (request, env) => {
  const body = (await readJson(request)) ?? {};
  const channel = str(body.channel, { max: 32 });
  if (!CHANNEL_IDS.includes(channel)) return fail(422, '未知的推送渠道', CHANNEL_IDS);

  const settings = await getSettings(env.DB);
  const today = todayIn(settings.timezone);
  const result = await deliverOne(
    settings,
    channel,
    {
      title: '订阅提醒 · 测试消息',
      body: `如果你看到这条消息，说明该渠道配置成功。发送时间 ${today} ${new Date().toISOString().slice(11, 19)} UTC。`,
      dueDate: today,
      daysLeft: settings.reminderDays,
    },
    { db: env.DB, env },
  );

  // Always 200: a failed probe is a diagnostic result, not an API failure.
  return json({ result });
});

/* -------------------------------------------------------------- dashboard */

router.get('/api/bootstrap', async (request, env) => {
  const [settings, stats, unread, notifications] = await Promise.all([
    getSettings(env.DB),
    computeStats(env.DB),
    unreadCount(env.DB),
    listNotifications(env.DB, { limit: 20 }),
  ]);
  return json({ settings: publicSettings(settings), stats, unread, notifications });
});

router.get('/api/stats', async (request, env) => json({ stats: await computeStats(env.DB) }));

/* ------------------------------------------------------------------ bills */

router.get('/api/bills', async (request, env) => {
  const url = new URL(request.url);
  const requested = Number.parseInt(url.searchParams.get('months') ?? '', 10);
  const months = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 36) : undefined;
  return json(await listBills(env.DB, { months }));
});

router.get('/api/bills/:month', async (request, env, params) => {
  if (!isBillMonth(params.month)) return fail(422, '月份格式应为 YYYY-MM');
  return json({ bill: await getBill(env.DB, params.month) });
});

/* ----------------------------------------------------------- subscriptions */

router.get('/api/subscriptions', async (request, env) => {
  const url = new URL(request.url);
  const data = await listSubscriptions(env.DB, {
    status: url.searchParams.get('status') ?? 'all',
    q: (url.searchParams.get('q') ?? '').trim(),
    sort: url.searchParams.get('sort') ?? 'end-asc',
  });
  return json(data);
});

router.post('/api/subscriptions', async (request, env) => {
  const body = await readJson(request);
  if (!body || typeof body !== 'object') return fail(400, '请求体必须是 JSON 对象');
  const result = await createSubscription(env.DB, body);
  if (result.errors) return fail(422, '订阅信息校验失败', result.errors);
  return json(result, { status: 201 });
});

router.get('/api/subscriptions/:id', async (request, env, params) => {
  const subscription = await getSubscription(env.DB, params.id);
  if (!subscription) return fail(404, '未找到该订阅');
  return json({ subscription });
});

router.put('/api/subscriptions/:id', async (request, env, params) => {
  const body = await readJson(request);
  if (!body || typeof body !== 'object') return fail(400, '请求体必须是 JSON 对象');
  const result = await updateSubscription(env.DB, params.id, body);
  if (result.notFound) return fail(404, '未找到该订阅');
  if (result.errors) return fail(422, '订阅信息校验失败', result.errors);
  return json(result);
});

router.delete('/api/subscriptions/:id', async (request, env, params) => {
  const result = await deleteSubscription(env.DB, params.id);
  if (!result.deleted) return fail(404, '未找到该订阅');
  return json({ ok: true });
});

/* -------------------------------------------------------------- web push */

/** The browser needs the application server key before it can subscribe. */
router.get('/api/push/key', async (request, env) => {
  const keys = await getVapidKeys(env.DB, env);
  return json({ publicKey: keys.publicKey, devices: await countPushSubscriptions(env.DB) });
});

router.post('/api/push/subscribe', async (request, env) => {
  const body = await readJson(request);
  if (!body || typeof body !== 'object') return fail(400, '请求体必须是 JSON 对象');
  const result = await savePushSubscription(env.DB, body);
  if (result.errors) return fail(422, '推送订阅信息不完整', result.errors);
  return json({ ok: true, devices: await countPushSubscriptions(env.DB) }, { status: 201 });
});

router.post('/api/push/unsubscribe', async (request, env) => {
  const body = (await readJson(request)) ?? {};
  await deletePushSubscription(env.DB, str(body.endpoint, { max: 500 }));
  return json({ ok: true, devices: await countPushSubscriptions(env.DB) });
});

/* ----------------------------------------------------------- notifications */

router.get('/api/notifications', async (request, env) => {
  const url = new URL(request.url);
  const notifications = await listNotifications(env.DB, {
    limit: Number(url.searchParams.get('limit') ?? 50),
    unreadOnly: url.searchParams.get('unread') === '1',
  });
  return json({ notifications, unread: await unreadCount(env.DB) });
});

router.post('/api/notifications/read', async (request, env) => {
  const body = (await readJson(request)) ?? {};
  const result = await markNotificationsRead(env.DB, body.ids ?? []);
  return json({ ...result, unread: await unreadCount(env.DB) });
});

router.post('/api/reminders/run', async (request, env) => json({ result: await runReminders(env) }));

/* ------------------------------------------------------------------ handler */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);

    // Best effort: if the database cannot be prepared the request still goes
    // through its normal error path, and the reason is in the logs.
    try {
      await ensureSchema(env.DB);
    } catch (error) {
      console.error('schema bootstrap failed', error?.stack ?? error);
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    if (url.pathname.startsWith('/api/') && !PUBLIC_PATHS.has(url.pathname)) {
      const auth = await authenticate(request, env);
      if (!auth.ok) {
        return json({ error: { message: auth.message } }, { status: auth.status, headers: cors });
      }
    }

    try {
      const { handler, params, pathMatched } = router.match(request.method, url.pathname);
      if (!handler) {
        return json(
          { error: { message: pathMatched ? '方法不被支持' : '接口不存在', path: url.pathname } },
          { status: pathMatched ? 405 : 404, headers: cors },
        );
      }

      const response = await handler(request, env, params);
      for (const [key, value] of Object.entries(cors)) response.headers.set(key, value);
      return response;
    } catch (error) {
      console.error('unhandled error', error?.stack ?? error);
      // Driver errors can quote SQL, so the message stays in the logs unless
      // DEBUG_ERRORS is switched on for local work.
      return json(
        {
          error: {
            message: '服务器内部错误',
            details: env.DEBUG_ERRORS ? String(error?.message ?? error) : null,
          },
        },
        { status: 500, headers: cors },
      );
    }
  },

  /** Daily Cron Trigger — see wrangler.toml `[triggers]`. */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(ensureSchema(env.DB).catch((error) => console.error('schema bootstrap failed', error)));
    ctx.waitUntil(
      runReminders(env)
        .then((result) => console.log('reminder run', JSON.stringify(result)))
        .catch((error) => console.error('reminder run failed', error?.stack ?? error)),
    );
  },
};
