-- Demo data for local development only: npm run seed:demo
--   (or: npm --prefix worker run db:seed:local)
--
-- Do NOT run this against a deployed database: it deletes every row in
-- `subscriptions` and `notifications` before inserting the demo set. The
-- worker never applies it on its own.
--
-- All dates are relative to "now" so the 7-day reminder window always has entries.

INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES
  ('monthly_budget', '1400', datetime('now')),
  ('currency',       'CNY', datetime('now')),
  ('reminder_days',  '7',   datetime('now'));

DELETE FROM notifications;
DELETE FROM subscriptions;

INSERT INTO subscriptions
  (id, name, vendor, category, amount, currency, cycle, start_date, end_date, auto_renew, status, notes, created_at, updated_at)
VALUES
  ('seed-netflix',  'Netflix 高级版',  'Netflix',  '影音娱乐', 78,   'CNY', 'monthly',   date('now','-25 day'), date('now','+3 day'),  1, 'active',  '4K + 4 台设备',      datetime('now'), datetime('now')),
  ('seed-figma',    'Figma 专业版',    'Figma',    '设计工具', 96,   'CNY', 'monthly',   date('now','-24 day'), date('now','+6 day'),  1, 'active',  '团队协作席位',        datetime('now'), datetime('now')),
  ('seed-chatgpt',  'ChatGPT Plus',   'OpenAI',   '效率工具', 140,  'CNY', 'monthly',   date('now','-12 day'), date('now','+18 day'), 1, 'active',  '',                    datetime('now'), datetime('now')),
  ('seed-aliyun',   '阿里云 ECS',      'Aliyun',   '云服务',   899,  'CNY', 'yearly',    date('now','-40 day'), date('now','+325 day'), 0, 'active', '2 核 4G 抢占式实例',  datetime('now'), datetime('now')),
  ('seed-icloud',   'iCloud+ 200GB',  'Apple',    '云存储',   21,   'CNY', 'monthly',   date('now','-8 day'),  date('now','+22 day'), 1, 'active',  '家庭共享',            datetime('now'), datetime('now')),
  ('seed-adobe',    'Adobe 摄影计划',  'Adobe',    '设计工具', 68,   'CNY', 'monthly',   date('now','-33 day'), date('now','-3 day'),  0, 'active',  '已到期未续费',        datetime('now'), datetime('now')),
  ('seed-spotify',  'Spotify 家庭版',  'Spotify',  '影音娱乐', 43,   'CNY', 'monthly',   date('now','-60 day'), date('now','-30 day'), 0, 'cancelled', '已退订',            datetime('now'), datetime('now'));
