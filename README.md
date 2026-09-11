# SubTrack

记录每笔订阅的**金额 / 开始时间 / 到期时间**，到期前提醒（默认提前 7 天，每条订阅可单独设置）；首页是总消费金额、剩余额度与即将到期，另有按自然月汇总、可点开看明细的账单页。订阅可以记成不同币种，账单、预算与首页合计会按汇率统一换算成设置里的展示币种，不会把 `$` 和 `¥` 按 1:1 相加。

Cloudflare Worker + D1 做后端，Vue 3 + Vite 做前端。前端构建产物作为静态资源随 Worker 一起部署，`/api/*` 走 Worker，其余交给资源层，一个域名搞定。

```
├── wrangler.toml           Worker 配置：脚本入口 / D1 / 静态资源 / Cron
├── worker/src/             Worker：路由、认证、db、提醒引擎、通知渠道、推送、SMTP
├── worker/schema.sql       由 src/schema.js 生成（npm run schema），仅供手工执行
├── worker/seed.sql         本地演示数据
├── frontend/src/           Vue：components / views / styles / lib
├── frontend/public/        PWA 清单与 Service Worker
└── tools/                  Termux 可用的本地服务与种子脚本
```

## 快速开始

```bash
npm run install:all
npm run seed:demo      # 可选：写入 7 条演示订阅（只动本地 SQLite）
npm run serve          # 构建前端并启动 → http://localhost:8787
```

默认账号 `admin` / `admin12345`，未开启落地页时根路径直接进登录页。`npm start` 只启动不重建；本地服务用 Node 内置 SQLite 跑真实 Worker 代码，Termux 上装不了 workerd 也能开发（只装前端依赖用 `npm run install:web`）。

| 本地变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `8787` | 端口 |
| `DB_PATH` | `.data/subtrack.db` | 本地 SQLite 文件 |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | `admin` / `admin12345` | 管理员账号 |
| `AUTH_SECRET` | 回退到 `ADMIN_PASSWORD` | Token 签名密钥 |
| `SMTP_INSECURE` | — | 设为 `1` 时跳过 SMTP 证书校验 |

热更新开发：终端 1 `npm run build && npm --prefix worker run dev`，终端 2 `npm --prefix frontend run dev`（`/api` 已代理到 8787）。

## 部署

1. 控制台 → **存储和数据库 → D1 → 创建数据库**，复制数据库 ID。
2. 填仓库根目录的 `wrangler.toml`：`database_name` 与 `database_id`。表由 Worker 首次请求自动创建，线上库不会有演示数据。
3. 控制台 → **Workers 和 Pages → 创建 → 连接到 Git**，选本仓库：

| 字段 | 值 |
|---|---|
| Root directory | 留空（仓库根目录） |
| Build command | `npm run install:web && npm run build` |
| Deploy command | `npx wrangler deploy` |
| Non-production branch deploy command | `npx wrangler versions upload` |

Root directory 必须留空：构建要先装前端依赖再打包，而 `wrangler.toml` 就在仓库根目录，默认的 deploy 命令即可读到脚本、D1 与 `[assets]`。命令行等价于 `npm run install:web && npm run build && npm run deploy`。

4. **设置 → 变量和机密**：

| 名称 | 类型 | 值 |
|---|---|---|
| `ADMIN_USERNAME` | 文本 | 登录用户名 |
| `ADMIN_PASSWORD` | 机密 | 管理员密码 |
| `AUTH_SECRET` | 机密 | 随机串，`openssl rand -hex 32` |
| `ALLOWED_ORIGIN` | 文本 | 同源部署填 `*` |

`wrangler.toml` 开了 `keep_vars`，控制台里的变量不会被部署覆盖。部署后 `https://<worker>.workers.dev/` 是界面，`/api/health` 返回 `{"ok":true}`。

## 认证

单一管理员账号，由环境变量决定，没有注册流程；登录后签发 7 天有效的 HMAC-SHA256 无状态 Token，前端存在 `localStorage`。除 `/api/health`、`/api/public`、`/api/auth/*` 外都要 `Authorization: Bearer <token>`；登录失败按 IP 限流（5 分钟 8 次），任意接口返回 `401` 前端就跳回登录页。

密钥（`webhook_secret` / `webhook_token` / `telegram_bot_token` / `smtp_password` / `email_api_key` / `vapid_private_key` 与含凭据的 `webhook_url`）以明文存在 D1 的 `settings` 表，接口只回 `hasSecrets` 布尔值告诉前端「已配置」，永不下发明文。

## 配置项

「设置」页写的就是 D1 的 `settings` 表，也可以直接改表：

| 键 | 默认值 | 说明 |
|---|---|---|
| `monthly_budget` | `0` | 月度预算，`剩余额度 = 月度预算 − 本月支出`；0 表示不追踪 |
| `currency` | `CNY` | 展示 / 结算币种（CNY / USD / EUR / JPY / HKD） |
| `exchange_rates` | `{"CNY":1,"USD":6.7,…}` | 汇率，含义是「1 外币 = ? 人民币」，JSON 对象；账单、预算与首页合计按此换算到 `currency` |
| `reminder_days` | `7` | 全局提前提醒天数，1–90；单个订阅可覆盖 |
| `timezone` | `Asia/Shanghai` | 决定「今天」与每日扫描的日期口径 |
| `show_hero` | `0` | 根路径 `/` 是否显示品牌落地页；关闭时 `/` 直接进登录页 |
| `app_mode` | `0` | App 模式（PWA 壳）：手机尺寸或安装启动时用 App 顶栏与底部标签栏 |
| `channel_inapp_enabled` | `1` | 站内提醒 |
| `channel_push_enabled` | `0` | 浏览器推送（Web Push） |
| `channel_webhook_enabled` / `webhook_url` | `0` / 空 | 群机器人、ntfy / Bark / Server 酱或自有服务 |
| `webhook_provider` | `generic` | `generic` / `wecom` / `dingtalk` / `feishu` / `ntfy` / `bark` / `serverchan` |
| `webhook_secret` | 空 | 钉钉加签 / 飞书签名校验的密钥，留空表示机器人没开签名 |
| `webhook_token` | 空 | ntfy 访问令牌：`tk_…` 走 Bearer，`用户名:密码` 走 Basic |
| `channel_telegram_enabled` / `telegram_bot_token` / `telegram_chat_id` | `0` / 空 / 空 | Telegram Bot 推送 |
| `channel_email_enabled` / `email_provider` / `email_from` / `email_to` | `0` / `resend` / 空 / 空 | 邮件推送，`email_provider` 取 `smtp` / `resend` / `http` |
| `smtp_host` / `smtp_secure` / `smtp_port` | 空 / `tls` / `0` | `tls`（465 隐式 TLS）或 `starttls`（587）；端口 0 时按加密方式自动选 |
| `smtp_user` / `smtp_password` | 空 / 空 | 不需要认证时留空 |
| `email_api_key` | 空 | Resend API Key（`email_provider = resend`） |
| `email_endpoint` | 空 | 自定义 HTTP 邮件网关（`email_provider = http`），POST `{ from, to, subject, text }` |
| `vapid_public_key` / `vapid_private_key` | 首次推送时生成 | Web Push 密钥对，可用同名 Worker 变量覆盖 |

密钥留空表示「保持不变」，点「清除」写入 `null` 删除。Worker 变量 `ALLOWED_ORIGIN` 控制 CORS（逗号分隔，`*` 不限制）；`DEBUG_ERRORS=1` 让 500 响应带上内部错误文本，线上不要开。

### 通知渠道

| 渠道 | 配置 | 说明 |
|---|---|---|
| 站内提醒 | 无 | 在「提醒」页生成记录与未读红点 |
| 浏览器推送 | 每台设备点一次「在此设备开启推送」 | VAPID + RFC 8291 `aes128gcm`，Worker 内用 WebCrypto 自实现；410 / 404 的失效端点自动清理 |
| Webhook | 服务类型 + 地址 +（钉钉 / 飞书）签名密钥 +（ntfy）令牌 | 按目标自动适配请求体（飞书用 `msg_type` / `content.text`） |
| Telegram Bot | Bot Token、Chat ID | 调 `api.telegram.org/bot<token>/sendMessage` |
| 邮件 | 发送方式、发件人、收件人及对应凭据 | `smtp` 直连（465 隐式 TLS / 587 STARTTLS，25 被运行时禁止）；`resend` 走 HTTP API；`http` 走自定义网关 |

每个渠道弹窗都有「发送测试消息」，会先保存当前表单再投递一条并显示结果，失败原因（含对方返回的错误码）直接显示在卡片上。

### 各渠道鉴权

只有钉钉和飞书自带签名，其余都是「URL 里的凭据即鉴权」：

| 目标 | 本项目如何处理 |
|---|---|
| 企业微信 | 直接 POST，不签名 |
| 钉钉 | 加签时把 `timestamp`（毫秒）与 `sign` 拼进 **URL 查询参数**，`sign = Base64(HMAC-SHA256(secret, timestamp + "\n" + secret))` |
| 飞书 | 签名校验时把 `timestamp`（秒）与 `sign` 放进 **JSON 请求体**，`sign = Base64(HMAC-SHA256(timestamp + "\n" + secret, ""))` |
| ntfy | 填了令牌就带 `Authorization`，`tk_` 前缀走 Bearer，`用户名:密码` 走 Basic |
| Bark | 直接 POST，暂不支持推送加密 |
| Server 酱 | 直接 POST `title` / `desp` |

钉钉 / 飞书若选「自定义关键词」，消息里必须出现关键词；提醒正文固定以「【订阅提醒】」开头，把 `订阅提醒` 填成关键词即可。

## 数据模型

| 表 | 用途 |
|---|---|
| `subscriptions` | 订阅主体：金额、币种、周期、`start_date` / `end_date`（`YYYY-MM-DD`）、`auto_renew`、`reminder_days`（NULL = 跟随全局）、状态 |
| `settings` | 键值配置，见上表 |
| `notifications` | 提醒记录，`UNIQUE(subscription_id, due_date, kind)` 保证同一次到期只提醒一次；`deliveries` 存各渠道投递结果 |
| `push_subscriptions` | 每台订阅了推送的设备一行（`endpoint` / `p256dh` / `auth` / `user_agent` / `last_seen_at`） |
| `payments` | 手动续期的付款记录（`subscription_id` + `period_start` 为主键），账单据此落到付款当月 |

存库的 `status` 只有 `active / paused / cancelled`，「已过期」「即将到期」由 `end_date` 与今天实时推导。

计费口径：每笔扣费按周期推导（第 1 期在开始日，之后每个完整周期一笔，直到到期日），所以按周的订阅一个月记 4–5 笔、按年只在续费当月记 1 笔、一次性买断只记 1 笔。续期（自动滚动或手动 ⟳）把到期日往后推，账单随之多出这一期；手动续期按付款当天落账，明细里标「提前续费 · 原定 …」。首页「本月支出」与账单页共用同一口径。

## API

除 `/api/health`、`/api/public` 与 `/api/auth/*` 外都需要 `Authorization: Bearer <token>`。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 健康检查（公开） |
| GET | `/api/public` | 公开配置：`showHero` / `appMode` / `reminderDays` / `currency` |
| POST | `/api/auth/login` | 登录，返回 `token` 与 `username` |
| GET | `/api/auth/session` | 当前会话是否有效 |
| POST | `/api/auth/logout` | 退出（客户端丢弃 Token 即可） |
| GET | `/api/bootstrap` | 首屏聚合：settings + stats + notifications + unread |
| GET | `/api/stats` | 预算、支出、分类、6 个月趋势、即将到期、已过期 |
| GET | `/api/bills` | 月度账单列表，`?months=` 取 1–36（默认 12） |
| GET | `/api/bills/:month` | 单月明细（`YYYY-MM`），按扣费日排列 |
| GET/POST | `/api/subscriptions` | 列表（`?status=&q=&sort=`）/ 新建 |
| GET/PUT/DELETE | `/api/subscriptions/:id` | 详情 / 更新 / 删除 |
| POST | `/api/subscriptions/:id/renew` | 手动续期，顺延一个周期；一次性买断返回 `422` |
| GET | `/api/notifications` | 提醒列表，支持 `?unread=1&limit=` |
| POST | `/api/notifications/read` | 标记已读，`ids: []` 表示全部 |
| POST | `/api/reminders/run` | 手动触发一次到期扫描 |
| GET/PUT | `/api/settings` | 读取 / 更新配置 |
| POST | `/api/settings/test` | 给指定渠道（含 `push`）发一条测试消息 |
| GET | `/api/push/key` | VAPID 公钥与已订阅设备数 |
| POST | `/api/push/subscribe` | 注册设备 `{ endpoint, keys: { p256dh, auth } }` |
| POST | `/api/push/unsubscribe` | 取消设备 `{ endpoint }` |

## 提醒机制

每天 01:00 UTC（09:00 北京时间）由 Cron 触发 `scheduled()`，扫描 `status = active` 的订阅，窗口取「订阅自身 `reminder_days` ?? 全局 `reminder_days`」：`0 ≤ 剩余天数 ≤ 窗口` 生成 `expiring_soon`，`剩余天数 < 0` 生成 `expired`。写 `notifications` 用 `INSERT OR IGNORE` + 唯一索引，重复扫描不会重复提醒；随后对已启用渠道依次投递，结果记在 `deliveries` 里。

本地触发：`curl -X POST http://localhost:8787/api/reminders/run`（`wrangler dev` 用 `curl "http://127.0.0.1:8787/__scheduled?cron=0+1+*+*+*"`）。

## 测试

```bash
npm test              # 后端 255 条断言
npm run test:render   # 前端 79 条 SSR + 220 条 jsdom
npm run test:all      # 全部
```

`worker/test/smoke.mjs` 用 `node:sqlite` 模拟 D1 跑真实 fetch 入口（含进程内 SMTP 服务器、Web Push 真解密一次载荷、各家 Webhook 请求体校验）；`frontend/test/render.mjs` 做 SSR 渲染检查，`frontend/test/client.mjs` 在 jsdom 里驱动真实交互。

## 许可证

[MIT](LICENSE) © 2026 qiuyuxc
