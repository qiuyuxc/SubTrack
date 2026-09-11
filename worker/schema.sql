-- Subscription manager schema (Cloudflare D1 / SQLite)
-- Generated from worker/src/schema.js by tools/gen-schema.mjs — edit that file, not this one.

CREATE TABLE IF NOT EXISTS subscriptions (
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
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_end_date ON subscriptions (end_date);

CREATE INDEX IF NOT EXISTS idx_subscriptions_status   ON subscriptions (status);

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
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
);

CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications (created_at DESC);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id           TEXT PRIMARY KEY,
  endpoint     TEXT NOT NULL UNIQUE,
  p256dh       TEXT NOT NULL,
  auth         TEXT NOT NULL,
  user_agent   TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES
  ('monthly_budget', '0', datetime('now')),
  ('currency', 'CNY', datetime('now')),
  ('reminder_days', '7', datetime('now')),
  ('timezone', 'Asia/Shanghai', datetime('now')),
  ('show_hero', '0', datetime('now')),
  ('app_mode', '0', datetime('now')),
  ('vapid_public_key', '', datetime('now')),
  ('vapid_private_key', '', datetime('now')),
  ('channel_inapp_enabled', '1', datetime('now')),
  ('channel_push_enabled', '0', datetime('now')),
  ('channel_webhook_enabled', '0', datetime('now')),
  ('webhook_provider', 'generic', datetime('now')),
  ('webhook_url', '', datetime('now')),
  ('webhook_secret', '', datetime('now')),
  ('webhook_token', '', datetime('now')),
  ('channel_telegram_enabled', '0', datetime('now')),
  ('telegram_bot_token', '', datetime('now')),
  ('telegram_chat_id', '', datetime('now')),
  ('channel_email_enabled', '0', datetime('now')),
  ('email_provider', 'resend', datetime('now')),
  ('smtp_host', '', datetime('now')),
  ('smtp_port', '0', datetime('now')),
  ('smtp_secure', 'tls', datetime('now')),
  ('smtp_user', '', datetime('now')),
  ('smtp_password', '', datetime('now')),
  ('email_api_key', '', datetime('now')),
  ('email_endpoint', '', datetime('now')),
  ('email_from', '', datetime('now')),
  ('email_to', '', datetime('now'));
