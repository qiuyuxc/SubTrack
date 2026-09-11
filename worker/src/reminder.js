/**
 * Expiry reminder engine.
 *
 * Runs from the daily Cron Trigger and from `POST /api/reminders/run` (manual
 * "check now"). For every active subscription it creates an idempotent
 * notification once the remaining days fall inside the reminder window, then
 * fans the message out to every enabled channel.
 */
import { addDays, nowIso, todayIn, uuid } from './utils.js';
import { getSettings, listSubscriptions } from './db.js';
import { deliverAll, formatAmount, isEnabled, summarise } from './notify.js';

export const KINDS = {
  expiring: 'expiring_soon',
  expired: 'expired',
};

function buildMessage(subscription, daysLeft, reminderDays) {
  const amount = formatAmount(subscription.amount, subscription.currency);

  if (daysLeft < 0) {
    return {
      kind: KINDS.expired,
      title: `订阅已过期 · ${subscription.name}`,
      body: `${subscription.name}（${amount}）已于 ${subscription.endDate} 到期，请确认是否续费或停用。`,
    };
  }
  return {
    kind: KINDS.expiring,
    title: `订阅即将到期 · ${subscription.name}`,
    body: `${subscription.name}（${amount}）将在 ${daysLeft} 天后到期（${subscription.endDate}）。提醒窗口为到期前 ${reminderDays} 天。`,
  };
}

export async function runReminders(env, { force = false } = {}) {
  const db = env.DB;
  const settings = await getSettings(db);
  const today = todayIn(settings.timezone);
  const { items } = await listSubscriptions(db, { status: 'all' });

  const created = [];
  const skipped = [];

  for (const subscription of items) {
    if (subscription.status !== 'active') continue;

    // Each subscription may override the global window (short plans).
    const window = subscription.reminderDays ?? settings.reminderDays;
    let message = null;
    if (subscription.daysLeft < 0 && force !== 'skip-expired') {
      message = buildMessage(subscription, subscription.daysLeft, window);
    } else if (subscription.daysLeft >= 0 && subscription.daysLeft <= window) {
      message = buildMessage(subscription, subscription.daysLeft, window);
    }
    if (!message) continue;

    const id = uuid();
    const insert = await db
      .prepare(
        `INSERT OR IGNORE INTO notifications
           (id, subscription_id, kind, title, body, due_date, days_left, channel, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id, subscription.id, message.kind, message.title, message.body,
        subscription.endDate, subscription.daysLeft, '', 'pending', nowIso(),
      )
      .run();

    if ((insert.meta?.changes ?? 0) === 0) {
      skipped.push(subscription.id);
      continue;
    }

    const results = await deliverAll(
      settings,
      {
        ...message,
        subscriptionId: subscription.id,
        dueDate: subscription.endDate,
        daysLeft: subscription.daysLeft,
        amount: subscription.amount,
        currency: subscription.currency,
      },
      { db, env, pushTag: `subtrack-${subscription.id}-${subscription.endDate}`, pushUrl: '/reminders' },
    );
    const summary = summarise(results);
    const firstError = results.find((result) => result.error)?.error ?? null;
    const sentAt = summary.sent > 0 ? nowIso() : null;
    // With the in-app channel off, the row is history only — don't leave it
    // sitting in the unread badge.
    const readAt = isEnabled(settings, 'inapp') ? null : nowIso();

    await db
      .prepare(
        `UPDATE notifications
            SET status = ?, error = ?, sent_at = ?, channel = ?, deliveries = ?, read_at = ?
          WHERE id = ?`,
      )
      .bind(summary.status, firstError, sentAt, summary.channel, JSON.stringify(results), readAt, id)
      .run();

    created.push({
      id,
      subscriptionId: subscription.id,
      kind: message.kind,
      title: message.title,
      body: message.body,
      daysLeft: subscription.daysLeft,
      status: summary.status,
      channels: summary.channel,
      deliveries: results,
    });
  }

  return {
    today,
    windowEndsAt: addDays(today, settings.reminderDays),
    reminderDays: settings.reminderDays,
    scanned: items.length,
    created: created.length,
    duplicatesSkipped: skipped.length,
    notifications: created,
  };
}
