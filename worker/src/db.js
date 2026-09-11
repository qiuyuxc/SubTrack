import {
  daysBetween, endOfMonth, isValidDate, json, monthKey, nowIso, num,
  round2, startOfMonth, str, toDate, todayIn, uuid,
} from './utils.js';

export const CYCLES = ['weekly', 'monthly', 'quarterly', 'yearly', 'once'];
export const STATUSES = ['active', 'paused', 'cancelled'];

/**
 * Settings live in a flat key/value table. This schema is the single source of
 * truth for defaults, coercion, and which fields are secret (never echoed back
 * to the browser).
 */
export const SETTINGS_SCHEMA = {
  monthlyBudget: { type: 'number', default: 0 },
  currency: { type: 'string', default: 'CNY' },
  reminderDays: { type: 'number', default: 7 },
  timezone: { type: 'string', default: 'Asia/Shanghai' },
  showHero: { type: 'bool', default: false },
  appMode: { type: 'bool', default: false },

  // Generated on first push delivery; a pair of env vars can override them.
  vapidPublicKey: { type: 'string', default: '' },
  vapidPrivateKey: { type: 'secret', default: '' },

  channelInappEnabled: { type: 'bool', default: true },
  channelPushEnabled: { type: 'bool', default: false },

  channelWebhookEnabled: { type: 'bool', default: false },
  webhookProvider: { type: 'enum', default: 'generic', values: ['generic', 'wecom', 'dingtalk', 'feishu', 'ntfy', 'bark', 'serverchan'] },
  // The hook URL carries the credential for most providers, so it is treated
  // like a secret: stored once, never echoed back to the browser.
  webhookUrl: { type: 'secret', default: '' },
  webhookSecret: { type: 'secret', default: '' },
  webhookToken: { type: 'secret', default: '' },

  channelTelegramEnabled: { type: 'bool', default: false },
  telegramBotToken: { type: 'secret', default: '' },
  telegramChatId: { type: 'string', default: '' },

  channelEmailEnabled: { type: 'bool', default: false },
  emailProvider: { type: 'enum', default: 'resend', values: ['smtp', 'resend', 'http'] },
  smtpHost: { type: 'string', default: '' },
  smtpPort: { type: 'number', default: 0 },                 // 0 = pick by transport (465 / 587)
  smtpSecure: { type: 'enum', default: 'tls', values: ['tls', 'starttls'] },
  smtpUser: { type: 'string', default: '' },
  smtpPassword: { type: 'secret', default: '' },
  emailApiKey: { type: 'secret', default: '' },
  emailEndpoint: { type: 'string', default: '' },
  emailFrom: { type: 'string', default: '' },
  emailTo: { type: 'string', default: '' },
};

export const SETTING_KEYS = Object.keys(SETTINGS_SCHEMA);

/** `telegramBotToken` → `telegram_bot_token`, matching the D1 column names. */
export function columnOf(key) {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

const COLUMN_TO_KEY = Object.fromEntries(SETTING_KEYS.map((key) => [columnOf(key), key]));

function coerce(key, value) {
  const definition = SETTINGS_SCHEMA[key];
  if (!definition) return null;
  switch (definition.type) {
    case 'number': {
      const parsed = num(value, definition.default);
      if (key === 'reminderDays') return Math.min(Math.max(Math.trunc(parsed), 1), 90);
      return Math.max(parsed, 0);
    }
    case 'bool':
      return value === true || value === 1 || value === '1' || value === 'true';
    case 'enum':
      return definition.values.includes(value) ? value : definition.default;
    default:
      return str(value, { max: key === 'webhookUrl' || key === 'emailEndpoint' ? 500 : 200 });
  }
}

export function serialise(key, value) {
  const definition = SETTINGS_SCHEMA[key];
  if (definition.type === 'bool') return value ? '1' : '0';
  if (definition.type === 'number') return String(Number(value) || 0);
  return String(value ?? '');
}

function isBlank(value) {
  return value === undefined || value === null || value === '';
}

/* ------------------------------------------------------------------ settings */

export async function getSettings(db) {
  const { results } = await db.prepare('SELECT key, value FROM settings').all();
  const raw = {};
  for (const row of results ?? []) raw[row.key] = row.value;

  const settings = {};
  for (const key of SETTING_KEYS) {
    const column = columnOf(key);
    settings[key] = coerce(key, raw[column] ?? SETTINGS_SCHEMA[key].default);
  }
  return settings;
}

/** Strips secret material before the settings cross the network. */
export function publicSettings(settings) {
  const out = { ...settings };
  const hasSecrets = {};
  for (const key of SETTING_KEYS) {
    if (SETTINGS_SCHEMA[key].type !== 'secret') continue;
    hasSecrets[key] = Boolean(settings[key]);
    out[key] = '';
  }
  out.hasSecrets = hasSecrets;
  return out;
}

/**
 * Accepts camelCase or snake_case keys. For secret fields: `undefined` or `''`
 * leaves the stored value untouched (the UI never receives it back), `null`
 * clears it, and any other string replaces it.
 */
export async function saveSettings(db, patch, { allowSecrets = true } = {}) {
  const now = nowIso();
  const statements = [];

  for (const [rawKey, rawValue] of Object.entries(patch ?? {})) {
    const key = SETTINGS_SCHEMA[rawKey] ? rawKey : COLUMN_TO_KEY[rawKey];
    if (!key) continue;
    const definition = SETTINGS_SCHEMA[key];

    if (definition.type === 'secret') {
      if (!allowSecrets) continue;
      if (rawValue === undefined || rawValue === '') continue;
      const value = rawValue === null ? '' : str(rawValue, { max: 500 });
      statements.push(
        db.prepare(
          `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
           ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        ).bind(columnOf(key), value, now),
      );
      continue;
    }

    if (rawValue === undefined) continue;
    const value = coerce(key, isBlank(rawValue) && definition.type === 'string' ? '' : rawValue);
    statements.push(
      db.prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      ).bind(columnOf(key), serialise(key, value), now),
    );
  }

  if (statements.length) await db.batch(statements);
  return getSettings(db);
}

/* ------------------------------------------------------------- normalization */

/** NULL/空值 = 跟随全局；否则收敛到 1–90 天。 */
function normalizeReminderDays(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(Math.max(Math.trunc(parsed), 1), 90);
}

function hydrate(row, today, reminderDays) {
  const daysLeft = daysBetween(today, row.end_date);
  // A subscription may override the global reminder window (e.g. a 7-day plan
  // that has to be renewed on day 3 — a 7-day-ahead reminder would fire instantly).
  const window = row.reminder_days ?? reminderDays;
  const derivedStatus =
    row.status !== 'active' ? row.status : daysLeft < 0 ? 'expired' : 'active';
  const totalDays = Math.max(daysBetween(row.start_date, row.end_date), 1);
  const months = totalDays / 30.44;
  return {
    id: row.id,
    name: row.name,
    vendor: row.vendor,
    category: row.category,
    amount: round2(row.amount),
    currency: row.currency,
    cycle: row.cycle,
    startDate: row.start_date,
    endDate: row.end_date,
    autoRenew: Boolean(row.auto_renew),
    reminderDays: row.reminder_days ?? null,
    reminderWindow: window,
    status: row.status,
    statusLabel: derivedStatus,
    notes: row.notes,
    daysLeft,
    expired: daysLeft < 0 && row.status === 'active',
    expiringSoon: row.status === 'active' && daysLeft >= 0 && daysLeft <= window,
    progress: Math.min(100, Math.max(0, Math.round(((totalDays - Math.max(daysLeft, 0)) / totalDays) * 100))),
    monthlyEquivalent: round2(row.amount / months),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/* ------------------------------------------------------------ subscriptions */

export async function listSubscriptions(db, { status, q, sort } = {}) {
  const settings = await getSettings(db);
  const today = todayIn(settings.timezone);
  const clauses = [];
  const params = [];

  if (status && status !== 'all') {
    if (status === 'expired') {
      clauses.push("status = 'active' AND end_date < ?");
      params.push(today);
    } else if (status === 'expiring') {
      // The window is per subscription, so the cut-off is applied after hydration.
      clauses.push('status = ? AND end_date >= ?');
      params.push('active', today);
    } else if (status === 'active') {
      clauses.push("status = 'active' AND end_date >= ?");
      params.push(today);
    } else {
      clauses.push('status = ?');
      params.push(status);
    }
  }
  if (q) {
    clauses.push('(name LIKE ? OR vendor LIKE ? OR category LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like);
  }

  const order = {
    'end-asc': 'end_date ASC',
    'end-desc': 'end_date DESC',
    'amount-desc': 'amount DESC',
    'amount-asc': 'amount ASC',
    'created-desc': 'created_at DESC',
    'name-asc': 'name COLLATE NOCASE ASC',
  }[sort ?? 'end-asc'] ?? 'end_date ASC';

  const sql = `SELECT * FROM subscriptions ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY ${order}`;
  const { results } = await db.prepare(sql).bind(...params).all();
  let items = (results ?? []).map((row) => hydrate(row, today, settings.reminderDays));
  if (status === 'expiring') items = items.filter((item) => item.expiringSoon);
  return {
    items,
    today,
    reminderDays: settings.reminderDays,
  };
}

export async function getSubscription(db, id) {
  const settings = await getSettings(db);
  const row = await db.prepare('SELECT * FROM subscriptions WHERE id = ?').bind(id).first();
  if (!row) return null;
  return hydrate(row, todayIn(settings.timezone), settings.reminderDays);
}

export function validateSubscription(input) {
  const errors = [];
  const payload = {
    name: str(input?.name, { max: 120 }),
    vendor: str(input?.vendor, { max: 120 }),
    category: str(input?.category, { max: 60 }) || '其他',
    amount: num(input?.amount, NaN),
    currency: str(input?.currency, { max: 8 }) || 'CNY',
    cycle: CYCLES.includes(input?.cycle) ? input.cycle : 'monthly',
    start_date: str(input?.startDate ?? input?.start_date, { max: 10 }),
    end_date: str(input?.endDate ?? input?.end_date, { max: 10 }),
    auto_renew: input?.autoRenew || input?.auto_renew ? 1 : 0,
    reminder_days: normalizeReminderDays(input?.reminderDays ?? input?.reminder_days),
    status: STATUSES.includes(input?.status) ? input.status : 'active',
    notes: str(input?.notes, { max: 1000 }),
  };

  if (!payload.name) errors.push('订阅名称不能为空');
  if (!Number.isFinite(payload.amount) || payload.amount < 0) errors.push('金额必须是大于等于 0 的数字');
  if (!isValidDate(payload.start_date)) errors.push('开始时间格式应为 YYYY-MM-DD');
  if (!isValidDate(payload.end_date)) errors.push('到期时间格式应为 YYYY-MM-DD');
  const rawReminder = input?.reminderDays ?? input?.reminder_days;
  if (rawReminder !== null && rawReminder !== undefined && rawReminder !== '' && !Number.isFinite(Number(rawReminder))) {
    errors.push('提前提醒天数必须是 1–90 之间的整数');
  }
  if (!errors.length && toDate(payload.end_date) < toDate(payload.start_date)) {
    errors.push('到期时间不能早于开始时间');
  }

  return { errors, payload };
}

export async function createSubscription(db, input) {
  const { errors, payload } = validateSubscription(input);
  if (errors.length) return { errors };

  const id = uuid();
  const ts = nowIso();
  await db
    .prepare(
      `INSERT INTO subscriptions
         (id, name, vendor, category, amount, currency, cycle, start_date, end_date,
          auto_renew, reminder_days, status, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id, payload.name, payload.vendor, payload.category, payload.amount, payload.currency,
      payload.cycle, payload.start_date, payload.end_date, payload.auto_renew, payload.reminder_days,
      payload.status, payload.notes, ts, ts,
    )
    .run();

  return { subscription: await getSubscription(db, id) };
}

export async function updateSubscription(db, id, input) {
  const existing = await db.prepare('SELECT id FROM subscriptions WHERE id = ?').bind(id).first();
  if (!existing) return { notFound: true };

  const { errors, payload } = validateSubscription(input);
  if (errors.length) return { errors };

  await db
    .prepare(
      `UPDATE subscriptions SET
         name = ?, vendor = ?, category = ?, amount = ?, currency = ?, cycle = ?,
         start_date = ?, end_date = ?, auto_renew = ?, reminder_days = ?, status = ?, notes = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      payload.name, payload.vendor, payload.category, payload.amount, payload.currency,
      payload.cycle, payload.start_date, payload.end_date, payload.auto_renew, payload.reminder_days,
      payload.status, payload.notes, nowIso(), id,
    )
    .run();

  return { subscription: await getSubscription(db, id) };
}

export async function deleteSubscription(db, id) {
  const result = await db.prepare('DELETE FROM subscriptions WHERE id = ?').bind(id).run();
  await db.prepare('DELETE FROM notifications WHERE subscription_id = ?').bind(id).run();
  return { deleted: (result.meta?.changes ?? 0) > 0 };
}

/* -------------------------------------------------------------------- stats */

export async function computeStats(db) {
  const settings = await getSettings(db);
  const today = todayIn(settings.timezone);
  const { results } = await db.prepare('SELECT * FROM subscriptions').all();
  const rows = results ?? [];
  const items = rows.map((row) => hydrate(row, today, settings.reminderDays));

  const billable = items.filter((item) => item.status !== 'cancelled');
  // `enabled` keeps the stored status; `active` additionally drops lapsed rows
  // so the dashboard never counts an expired subscription as still running.
  const enabled = items.filter((item) => item.status === 'active');
  const active = enabled.filter((item) => item.daysLeft >= 0);
  const lapsed = enabled.filter((item) => item.daysLeft < 0).sort((a, b) => a.daysLeft - b.daysLeft);

  const monthStart = startOfMonth(today);
  const monthEnd = endOfMonth(today);

  const monthlySubs = billable.filter(
    (item) => item.startDate <= monthEnd && item.endDate >= monthStart,
  );

  const totalSpend = round2(billable.reduce((sum, item) => sum + item.amount, 0));
  const monthSpend = round2(monthlySubs.reduce((sum, item) => sum + item.amount, 0));
  const monthBudget = round2(settings.monthlyBudget);
  const remaining = round2(monthBudget - monthSpend);
  const monthlyEquivalent = round2(
    active.reduce((sum, item) => sum + item.monthlyEquivalent, 0),
  );

  const byCategory = Object.entries(
    billable.reduce((acc, item) => {
      acc[item.category] = round2((acc[item.category] ?? 0) + item.amount);
      return acc;
    }, {}),
  )
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);

  const upcoming = active
    .filter((item) => item.expiringSoon)
    .sort((a, b) => a.daysLeft - b.daysLeft);

  const timeline = [];
  for (let i = 0; i < 6; i += 1) {
    const date = new Date(toDate(monthStart));
    date.setUTCMonth(date.getUTCMonth() + i);
    const key = date.toISOString().slice(0, 7);
    const amount = billable
      .filter((item) => monthKey(item.startDate) <= key && monthKey(item.endDate) >= key)
      .reduce((sum, item) => sum + item.amount, 0);
    timeline.push({ month: key, amount: round2(amount) });
  }

  return {
    today,
    currency: settings.currency,
    reminderDays: settings.reminderDays,
    budget: {
      monthly: monthBudget,
      remaining,
      usedRatio: monthBudget > 0 ? round2(Math.min(monthSpend / monthBudget, 1)) : 0,
      overBudget: monthBudget > 0 && remaining < 0,
    },
    spend: {
      month: monthSpend,
      total: totalSpend,
      monthlyEquivalent,
      monthLabel: monthKey(today),
    },
    counts: {
      total: items.length,
      active: active.length,
      enabled: enabled.length,
      paused: items.filter((item) => item.status === 'paused').length,
      cancelled: items.filter((item) => item.status === 'cancelled').length,
      expiringSoon: upcoming.length,
      expired: lapsed.length,
    },
    monthlySubscriptions: monthlySubs,
    upcoming,
    expired: lapsed,
    byCategory,
    timeline,
    generatedAt: nowIso(),
  };
}

/* -------------------------------------------------------------------- bills */

/** Months shown in the bill view (current month first). */
export const BILL_MONTHS = 12;

function monthLabel(month) {
  const [year, m] = month.split('-');
  return `${year}年${Number(m)}月`;
}

/** Day the charge is expected to land: the start day, clamped into that month. */
function billingDate(item, month) {
  if (monthKey(item.startDate) === month) return item.startDate;
  const day = Number(item.startDate.slice(8, 10)) || 1;
  const lastDay = Number(endOfMonth(month).slice(8, 10));
  return `${month}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}

/** Same rule as the dashboard: anything not cancelled that covers the month. */
function billableIn(items, month) {
  const from = startOfMonth(month);
  const to = endOfMonth(month);
  return items.filter((item) => item.status !== 'cancelled' && item.startDate <= to && item.endDate >= from);
}

function categoryTotals(items) {
  const map = new Map();
  for (const item of items) {
    const entry = map.get(item.category) ?? { category: item.category, amount: 0, count: 0 };
    entry.amount = round2(entry.amount + item.amount);
    entry.count += 1;
    map.set(item.category, entry);
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category));
}

export function isBillMonth(value) {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/** Month-by-month statements, newest first — powers the bill list. */
export async function listBills(db, { months = BILL_MONTHS } = {}) {
  const settings = await getSettings(db);
  const today = todayIn(settings.timezone);
  const { items } = await listSubscriptions(db, { status: 'all' });

  const list = [];
  for (let i = 0; i < months; i += 1) {
    const date = new Date(`${startOfMonth(today)}T00:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() - i);
    const month = date.toISOString().slice(0, 7);
    const billed = billableIn(items, month);
    list.push({
      month,
      label: monthLabel(month),
      total: round2(billed.reduce((sum, item) => sum + item.amount, 0)),
      count: billed.length,
      byCategory: categoryTotals(billed),
      current: month === monthKey(today),
    });
  }

  const total = round2(list.reduce((sum, entry) => sum + entry.total, 0));
  return {
    today,
    currency: settings.currency,
    months: list,
    summary: {
      months: list.length,
      total,
      average: list.length ? round2(total / list.length) : 0,
      busiest: list.reduce((best, entry) => (entry.total > (best?.total ?? -1) ? entry : best), null),
    },
  };
}

/** One month's statement, as a list of charges sorted by billing date. */
export async function getBill(db, month) {
  const settings = await getSettings(db);
  const today = todayIn(settings.timezone);
  const { items } = await listSubscriptions(db, { status: 'all' });

  const billed = billableIn(items, month)
    .map((item) => ({ ...item, chargeDate: billingDate(item, month) }))
    .sort((a, b) => a.chargeDate.localeCompare(b.chargeDate) || a.name.localeCompare(b.name));

  return {
    month,
    label: monthLabel(month),
    today,
    current: month === monthKey(today),
    currency: settings.currency,
    total: round2(billed.reduce((sum, item) => sum + item.amount, 0)),
    count: billed.length,
    byCategory: categoryTotals(billed),
    items: billed,
  };
}

/* ------------------------------------------------------------ notifications */

/** `JSON.parse` that never throws on legacy/hand-written rows. */
function safeParse(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function listNotifications(db, { limit = 50, unreadOnly = false } = {}) {
  const sql = `SELECT n.*, s.name AS subscription_name, s.amount AS subscription_amount,
                      s.currency AS subscription_currency, s.status AS subscription_status
               FROM notifications n
               LEFT JOIN subscriptions s ON s.id = n.subscription_id
               ${unreadOnly ? 'WHERE n.read_at IS NULL' : ''}
               ORDER BY n.created_at DESC
               LIMIT ?`;
  const { results } = await db.prepare(sql).bind(Math.min(Math.max(limit, 1), 200)).all();
  return (results ?? []).map((row) => ({
    id: row.id,
    subscriptionId: row.subscription_id,
    subscriptionName: row.subscription_name ?? '已删除的订阅',
    amount: round2(row.subscription_amount ?? 0),
    currency: row.subscription_currency ?? 'CNY',
    kind: row.kind,
    title: row.title,
    body: row.body,
    dueDate: row.due_date,
    daysLeft: row.days_left,
    channel: row.channel,
    channels: String(row.channel ?? '').split(',').filter(Boolean),
    status: row.status,
    error: row.error,
    deliveries: safeParse(row.deliveries),
    createdAt: row.created_at,
    sentAt: row.sent_at,
    readAt: row.read_at,
  }));
}

export async function markNotificationsRead(db, ids) {
  const ts = nowIso();
  if (!ids || !ids.length) {
    const result = await db.prepare('UPDATE notifications SET read_at = ? WHERE read_at IS NULL').bind(ts).run();
    return { updated: result.meta?.changes ?? 0 };
  }
  const statements = ids.map((id) =>
    db.prepare('UPDATE notifications SET read_at = ? WHERE id = ?').bind(ts, id),
  );
  await db.batch(statements);
  return { updated: ids.length };
}

export async function unreadCount(db) {
  const row = await db.prepare('SELECT COUNT(*) AS count FROM notifications WHERE read_at IS NULL').first();
  return row?.count ?? 0;
}

/* -------------------------------------------------------- push subscriptions */

/** Every browser that agreed to receive Web Push notifications. */
export async function listPushSubscriptions(db) {
  const { results } = await db
    .prepare('SELECT id, endpoint, p256dh, auth, user_agent, created_at, last_seen_at FROM push_subscriptions ORDER BY created_at')
    .all();
  return (results ?? []).map((row) => ({
    id: row.id,
    endpoint: row.endpoint,
    p256dh: row.p256dh,
    auth: row.auth,
    userAgent: row.user_agent,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  }));
}

export async function countPushSubscriptions(db) {
  const row = await db.prepare('SELECT COUNT(*) AS count FROM push_subscriptions').first();
  return row?.count ?? 0;
}

/** `{ endpoint, keys: { p256dh, auth } }` — the shape `PushSubscription.toJSON()` returns. */
export function validatePushSubscription(input) {
  const errors = [];
  const endpoint = str(input?.endpoint, { max: 500 });
  const keys = input?.keys ?? input?.subscription?.keys ?? {};
  const p256dh = str(keys.p256dh, { max: 200 });
  const auth = str(keys.auth, { max: 100 });

  if (!endpoint) errors.push('缺少推送端点');
  else if (!/^https:\/\//.test(endpoint)) errors.push('推送端点必须是 HTTPS 地址');
  if (!p256dh) errors.push('缺少 p256dh 公钥');
  if (!auth) errors.push('缺少 auth 密钥');
  if (errors.length) return { errors };

  return { endpoint, p256dh, auth, userAgent: str(input?.userAgent, { max: 200 }) };
}

export async function savePushSubscription(db, input) {
  const parsed = validatePushSubscription(input);
  if (parsed.errors) return parsed;

  // Re-subscribing the same endpoint refreshes its keys instead of duplicating.
  await db
    .prepare(
      `INSERT INTO push_subscriptions (id, endpoint, p256dh, auth, user_agent, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (endpoint) DO UPDATE SET
         p256dh = excluded.p256dh,
         auth = excluded.auth,
         user_agent = excluded.user_agent,
         last_seen_at = excluded.last_seen_at`,
    )
    .bind(uuid(), parsed.endpoint, parsed.p256dh, parsed.auth, parsed.userAgent, nowIso(), nowIso())
    .run();

  return { subscription: parsed };
}

export async function deletePushSubscription(db, endpoint) {
  const result = await db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(endpoint).run();
  return { deleted: (result.meta?.changes ?? 0) > 0 };
}

export { json };
