/**
 * Canonical D1 schema.
 *
 * The worker applies this itself (`ensureSchema()`), so a fresh database builds
 * itself on the first request or cron tick and a database created by an earlier
 * version picks up the columns added since. Doing it in code — instead of a
 * .sql file read at runtime — keeps one source of truth and needs no manual
 * `wrangler d1 execute` step on deploy.
 *
 * `worker/schema.sql` is generated from this file (`npm run schema`) for anyone
 * who would rather apply it by hand.
 */
import { SETTINGS_SCHEMA, columnOf, serialise } from './db.js';

const TABLES = [
  `CREATE TABLE IF NOT EXISTS subscriptions (
  id          TEXT PRIMARY KEY,
  name        TEXT    NOT NULL,
  vendor      TEXT    NOT NULL DEFAULT '',
  category    TEXT    NOT NULL DEFAULT '其他',
  amount      REAL    NOT NULL DEFAULT 0,
  currency    TEXT    NOT NULL DEFAULT 'CNY',
  cycle       TEXT    NOT NULL DEFAULT 'monthly',
  start_date  TEXT    NOT NULL,
  end_date    TEXT    NOT NULL,
  auto_renew  INTEGER NOT NULL DEFAULT 0,
  reminder_days INTEGER,                     -- NULL = follow the global setting
  status      TEXT    NOT NULL DEFAULT 'active',
  notes       TEXT    NOT NULL DEFAULT '',
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL
)`,
  'CREATE INDEX IF NOT EXISTS idx_subscriptions_end_date ON subscriptions (end_date)',
  'CREATE INDEX IF NOT EXISTS idx_subscriptions_status   ON subscriptions (status)',

  `CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`,

  // One row per (subscription, due date, kind) so the daily cron stays idempotent.
  `CREATE TABLE IF NOT EXISTS notifications (
  id              TEXT PRIMARY KEY,
  subscription_id TEXT    NOT NULL,
  kind            TEXT    NOT NULL,
  title           TEXT    NOT NULL,
  body            TEXT    NOT NULL,
  due_date        TEXT    NOT NULL,
  days_left       INTEGER NOT NULL,
  channel         TEXT    NOT NULL DEFAULT 'in_app',
  status          TEXT    NOT NULL DEFAULT 'pending',
  error           TEXT,
  deliveries      TEXT,
  created_at      TEXT    NOT NULL,
  sent_at         TEXT,
  read_at         TEXT,
  UNIQUE (subscription_id, due_date, kind)
)`,
  'CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications (created_at DESC)',

  // Manual renewals, so the statement can show the day the money actually left
  // instead of the scheduled cycle date. Automatic charges need no row: they
  // are derived from the subscription's dates.
  `CREATE TABLE IF NOT EXISTS payments (
  subscription_id TEXT NOT NULL,
  period_start    TEXT NOT NULL,
  paid_at         TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  PRIMARY KEY (subscription_id, period_start)
)`,

  // One row per browser/device that subscribed to Web Push.
  `CREATE TABLE IF NOT EXISTS push_subscriptions (
  id           TEXT PRIMARY KEY,
  endpoint     TEXT NOT NULL UNIQUE,
  p256dh       TEXT NOT NULL,
  auth         TEXT NOT NULL,
  user_agent   TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
)`,
];

/** Every setting that has ever shipped, so an older database gains the newer ones. */
function settingsSeed() {
  const rows = Object.keys(SETTINGS_SCHEMA).map((key) => {
    const value = serialise(key, SETTINGS_SCHEMA[key].default).replace(/'/g, "''");
    return `  ('${columnOf(key)}', '${value}', datetime('now'))`;
  });
  return `INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES\n${rows.join(',\n')}`;
}

/** Statements that build a database from nothing; all of them are idempotent. */
export const SCHEMA_STATEMENTS = [...TABLES, settingsSeed()];

/**
 * Columns added after the first release. SQLite has no `ADD COLUMN IF NOT
 * EXISTS`, so the bootstrap runs these one by one and ignores the "duplicate
 * column name" error it gets on a database that already has them.
 */
export const COLUMN_UPGRADES = [
  'ALTER TABLE notifications ADD COLUMN deliveries TEXT',
  'ALTER TABLE subscriptions ADD COLUMN reminder_days INTEGER',
];

export const SCHEMA_SQL = `-- Subscription manager schema (Cloudflare D1 / SQLite)
-- Generated from worker/src/schema.js by tools/gen-schema.mjs — edit that file, not this one.

${SCHEMA_STATEMENTS.join(';\n\n')};
`;
