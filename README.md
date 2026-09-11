# SubTrack

记录每一笔订阅的**金额 / 开始时间 / 到期时间**，首页展示**总消费金额、剩余额度、即将到期的订阅**，并在到期前 **7 天**自动提醒；另有按自然月汇总的**账单**页，可点开任意月份查看扣费明细。

后端是 Cloudflare Worker + D1，前端是 Vue 3 + Vite，界面按 `DESIGN.md` 里的 Vercel 设计规范实现。

## 功能

- **登录保护** — 单人管理后台，账号来自 Worker 环境变量，没有注册入口；接口除健康检查、公开配置与登录相关外都需要 Bearer Token。
- **订阅管理** — 名称、服务商、分类、金额、币种、计费周期、开始时间、到期时间、自动续费开关、独立提醒窗口、状态、备注。
- **首页总览** — 总消费金额、剩余额度（月度预算 − 本月支出）、即将到期订阅，另有分类占比与未来 6 个月趋势。
- **到期提醒** — 全局默认到期前 7 天（可调 1–90 天），**每个订阅还可以单独设置**：只有 7 天的短期订阅可以把窗口设成 3 天，否则「提前 7 天」在创建当天就会触发。每日 Cron 自动扫描生成提醒，并可通过站内 / 浏览器推送 / Webhook / Telegram / 邮件多通道推送。
- **账单** — 按自然月自动汇总每一笔订阅支出，给出本月账单、近 12 个月合计与月均支出；点击任意月份打开明细弹窗，按扣费日分组列流水（类似支付宝 / 微信账单）。
- **落地页即首页** — 打开「启用落地页」后，根路径 `/` 就是品牌落地页（渐变色带、核心能力、使用步骤），未登录访客看到的是「登录查看」入口；关闭后访问 `/` 则直接进入登录页（已登录时进入概览）。概览页固定在 `/dashboard`，始终是紧凑的数据看板。
- **移动端适配** — 订阅列表在窄屏下不再是需要横向滚动的表格，而是改成账单式卡片：一行一条，点击卡片直接弹出编辑弹窗，删除按钮独立在右侧。账单页、仪表盘、设置页（渠道卡片）同理；弹窗在手机上从底部弹出，关闭按钮有 44px 触控区，不会被浏览器地址栏遮住。
- **App 模式（PWA）** — 打开「App 模式」后，手机尺寸或从桌面安装启动时会换成原生 App 壳：顶栏只留当前页面名与通知铃铛（页面正文里不再重复写一遍标题），底部是「概览 / 账单 / ＋ / 订阅 / 设置」标签栏：提醒收进铃铛，加号居中并承担唯一的新增入口，页面内不再重复放添加按钮；所有页面带安全区留白；桌面宽窗口仍然用完整的 Web 布局，把窗口收窄到 720px 就能预览。内置 `manifest.webmanifest` 与手写 Service Worker，因此可以「添加到主屏幕」独立运行，且离线时导航仍能打开应用外壳。
- **多通道提醒** — Web Push 依赖浏览器自带的推送服务，并非所有浏览器都可用，所以提醒也可以走服务端推送：Webhook 渠道内置企业微信 / 钉钉 / 飞书 / **ntfy** / **Bark** / **Server 酱**（推到微信）等目标，按目标自动适配请求体，选好服务、粘贴地址就能用。
- **浏览器推送** — 「浏览器推送」渠道把到期提醒直接送进系统通知中心（Web Push，VAPID + RFC 8291 `aes128gcm`，Worker 内用 WebCrypto 自实现，无第三方依赖）。每个设备各自授权、可单独关闭；通知点开就是「提醒」页。VAPID 密钥首次投递时自动生成并存入 D1，也可以用 `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` 覆盖；密钥轮换后旧订阅会被自动替换并清理。
- **其他** — 状态筛选、搜索、排序；顶栏只显示当前页面名、并在页面滚动时收窄，页面正文标题只保留一行且 App 模式下不再重复显示，品牌图标与页脚只在落地页出现；表单里不使用浏览器原生控件（下拉是自绘 listbox，开关是自绘 switch）；深色模式。

页面路径：

| 路径 | 内容 | 是否需要登录 |
|---|---|---|
| `/` | 落地页（`show_hero` 开启）；否则跳转登录页 / 概览 | 否 |
| `/dashboard` | 概览：总消费金额、剩余额度、即将到期、分类与趋势 | 是 |
| `/sw.js`、`/manifest.webmanifest` | Service Worker 与 PWA 清单（App 模式 / 浏览器推送使用） | 否 |
| `/bills` | 月度账单与明细 | 是 |
| `/subscriptions` `/reminders` `/settings` | 订阅列表 / 提醒 / 设置 | 是 |
| `/login` | 登录 | 否 |

## 技术栈

| 层 | 选型 |
|---|---|
| 后端 | Cloudflare Workers（零运行时依赖，手写路由） |
| 数据库 | Cloudflare D1（SQLite） |
| 前端 | Vue 3 + Vue Router + Vite |
| 设计 | Vercel 设计规范（`DESIGN.md` 中的 color / typography / spacing token） |

Worker 不引入任何 npm 运行时依赖，只需要 `wrangler` 作为开发依赖，冷启动与体积都最省。

## 目录结构

```
├── worker/                 Cloudflare Worker + D1
│   ├── src/index.js        fetch 入口、路由表、CORS、scheduled 定时任务
│   ├── src/router.js       极简路由器（支持 :param）
│   ├── src/auth.js         HMAC-SHA256 无状态 Token、登录校验与限流
│   ├── src/db.js           订阅 / 设置 / 通知的数据访问、统计计算与月度账单
│   ├── src/notify.js       通知渠道投递（站内 / 浏览器推送 / Webhook / Telegram / 邮件）
│   ├── src/push.js         Web Push：VAPID 签名 + RFC 8291 载荷加密
│   ├── src/smtp.js         极简 SMTP 客户端（EHLO / STARTTLS / AUTH / DATA）
│   ├── src/reminder.js     到期提醒引擎（幂等 + 多通道投递）
│   ├── src/utils.js        时区安全的日期与数值工具
│   ├── src/schema.js       表结构、默认设置与增量列（唯一事实来源）
│   ├── src/bootstrap.js    首次请求时自动建表 / 补列
│   ├── schema.sql          由 src/schema.js 生成（`npm run schema`），仅供手工执行
│   ├── seed.sql            演示数据
│   └── test/smoke.mjs      222 条 API 断言（含一个进程内 SMTP 服务器）
├── frontend/               Vue 3 单页应用
│   ├── src/styles/         设计 token + 基础组件样式
│   ├── src/components/     AppNav / AppSelect / ChannelDialog / SubscriptionTable / BillDetailDialog 等 20 个组件
│   ├── src/views/          登录 / 概览 / 落地页 / 账单 / 订阅 / 提醒 / 设置
│   ├── public/sw.js        手写 Service Worker（导航缓存 + Web Push 渲染）
│   ├── public/manifest.webmanifest  PWA 清单与图标
│   └── test/               SSR 渲染检查 + jsdom 交互检查
├── tools/                  本地开发服务、node:sockets 适配器与种子数据脚本
└── DESIGN.md               设计规范（输入文件）
```

## 快速开始

```bash
npm run install:all     # 安装前端与 Worker 依赖
npm run seed            # 写入 7 条演示订阅（SQLite）
npm run serve           # 构建前端并启动 → http://localhost:8787
```

启动后打开 `http://localhost:8787`。默认未开启落地页，因此根路径会直接进入登录页，用 **`admin` / `admin12345`** 登录（本地默认值，可用环境变量覆盖）后抵达 `/dashboard` 概览；在「设置 → 界面」里打开落地页，`/` 就会变成品牌首页。

`npm start` 只启动服务（不重新构建）。这一条命令用 Node 内置的 SQLite 跑起真实的 Worker 代码，前后端同源、无需 `wrangler`／Miniflare。

```bash
ADMIN_USERNAME=me ADMIN_PASSWORD='一串足够长的口令' AUTH_SECRET='随机字符串' npm run serve
```

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `8787` | 本地服务端口 |
| `DB_PATH` | `.data/subtrack.db` | 本地 SQLite 文件 |
| `ADMIN_USERNAME` | `admin` | 管理员用户名 |
| `ADMIN_PASSWORD` | `admin12345` | 管理员密码（未设置时启动日志会给出默认凭据提醒） |
| `AUTH_SECRET` | 回退到 `ADMIN_PASSWORD` | Token 签名密钥，生产环境务必单独设置 |
| `SMTP_INSECURE` | 未设置 | 设为 `1` 时本地开发跳过 SMTP 的证书校验（仅用于自签证书的测试服务器） |

> 为什么提供它：`wrangler dev` 依赖的 `workerd` 没有 Android/arm64 二进制，在 Termux 上无法安装。若 `npm run install:all` 在 `worker` 一步失败，用 `npm run install:web` 只装前端依赖即可（`wrangler` 只在部署时需要，且部署通常在 x64/arm64 桌面环境进行）。

### 热更新开发（wrangler + vite）

```bash
# 终端 1 —— Worker + 本地 D1（表结构由 Worker 首次请求时自动创建）
npm --prefix worker run db:seed
npm --prefix worker run dev          # http://127.0.0.1:8787

# 终端 2 —— Vite（/api 已代理到 8787）
npm --prefix frontend run dev        # http://localhost:5173
```

## 部署

### 1. 创建 D1

```bash
cd worker
npx wrangler d1 create subtrack_db      # 把返回的 database_id 填进 wrangler.toml
npx wrangler deploy
```

> 库里已经有一个叫别的名字的 D1 也没关系：把 `wrangler.toml` 里的 `database_name` 改成那个名字、`database_id` 填对即可，表结构照样自动建。

**表结构会在第一次请求（或第一次定时任务）时自动创建**，不需要手动执行 SQL：`src/bootstrap.js` 会依次执行 `src/schema.js` 里的建表语句与默认设置，并给旧库补上后来新增的列（`notifications.deliveries`、`subscriptions.reminder_days`）。所有语句都是幂等的，每次冷启动只跑一遍。

想手工执行也可以，文件由 `src/schema.js` 生成，两者由测试保证不会跑偏：

```bash
npm run schema                                              # 重新生成 worker/schema.sql
npx wrangler d1 execute subtrack_db --remote --file=./schema.sql
```

`/api/public` 会告诉未登录访客是否开启落地页，因此 `show_hero` 与 `app_mode` 改完即刻生效，无需重新部署。

### 2. 配置管理员账号并部署 Worker

```bash
# wrangler.toml: 把 ALLOWED_ORIGIN 改成前端域名，例如 https://subtrack.vercel.app
npx wrangler secret put ADMIN_PASSWORD      # 管理员密码
npx wrangler secret put AUTH_SECRET         # Token 签名密钥（换掉默认值）
npx wrangler deploy
# → https://subtrack-api.<your-subdomain>.workers.dev
```

`ADMIN_USERNAME` 默认 `admin`，可直接写在 `wrangler.toml` 的 `[vars]` 里；`ADMIN_PASSWORD` / `AUTH_SECRET` 必须用 `wrangler secret put` 写入，不要提交进仓库。

部署时会一并注册 Cron Trigger（`crons = ["0 1 * * *"]`，即每天 09:00 北京时间）。

### 3. 前端部署到 Vercel

Vercel 导入 `frontend/` 目录，添加环境变量后构建即可：

```
VITE_API_BASE = https://subtrack-api.<your-subdomain>.workers.dev/api
```

`frontend/vercel.json` 已配置 SPA rewrites。若不想暴露跨域，也可以把 `/api/*` rewrite 到 Worker 域名，此时 `VITE_API_BASE` 保持默认的 `/api`。

## 认证

- 单一管理员账号，由 Worker 环境变量 `ADMIN_USERNAME` / `ADMIN_PASSWORD` 决定，**不提供注册流程**（多用户没有使用场景）。
- 登录成功后签发 7 天有效的 HMAC-SHA256 无状态 Token，前端存在 `localStorage` 的 `subtrack-token`，刷新页面后自动恢复会话。
- `/api/health`、`/api/public`、`/api/auth/login`、`/api/auth/session`、`/api/auth/logout` 之外的所有 `/api/*` 都需要 `Authorization: Bearer <token>`。
- `/api/public` 只返回 `showHero` / `appMode` / `reminderDays` / `currency` 四个字段，供未登录访客判断根路径该渲染落地页还是登录页、以及要不要启用 App 壳；它不下发任何密钥。
- 登录失败按来源 IP 限流：5 分钟窗口内最多 8 次，超出返回 `429`。
- 任意接口返回 `401` 时前端会清空本地会话并跳回登录页。

### 密钥存放与安全边界

- **密钥在 D1 里是明文**：`webhook_url` / `webhook_secret` / `webhook_token` / `telegram_bot_token` / `smtp_password` / `email_api_key` / `vapid_private_key` 都存在 `settings` 表的 `value` 列，靠 Cloudflare 账号本身保护，没有做字段级加密。能读到这个库的人（账号、API Token、导出文件）就能看到密钥——给 CI / wrangler 用的 API Token 请只授这一个 D1 与 Worker 的最小权限，D1 导出文件也别随手丢。
- **浏览器永远拿不到密钥**：`GET /api/settings` 与 `/api/bootstrap` 都经过 `publicSettings()`，密钥字段一律返回空串，只用 `hasSecrets` 布尔值告诉前端「已配置」。`PUT` 时留空表示保持不变，传 `null` 才清除。`GET /api/public` 只回 `showHero` / `appMode` / `reminderDays` / `currency`。
- **传输**：生产环境全程 HTTPS；本地 `npm start` 是明文 HTTP，只用于本机调试。
- **会话**：7 天 HMAC-SHA256 无状态 Token，存在浏览器 `localStorage`，服务端不保存也无法吊销，退出登录只清本地副本。`AUTH_SECRET` 没设置时会退化成用 `ADMIN_PASSWORD` 当签名密钥，所以务必单独 `wrangler secret put AUTH_SECRET`，并换成长随机串。
- **登录限流是内存级的**（每个 isolate 5 分钟 8 次），能挡住单点暴力破解，但不是跨节点的分布式限流；管理员密码请用足够长的随机串。
- **失败信息不回显内部细节**：500 只返回 `服务器内部错误`，驱动原文只进 `console.error`（`DEBUG_ERRORS=1` 才会下发，本地开发默认开）。
- **Webhook 地址按密钥处理**：`webhook_url` 里含企业微信 key / 飞书 hook ID / Server 酱 SendKey / Bark DeviceKey 等凭据，所以它和密钥字段一样只写不回显——表单重新打开时显示「已配置，留空则不修改」，需要时点「清除」再填新的。代价是看不到已存的地址，改之前得重新填一遍。
- 本地数据库（`.data/subtrack.db`）与 `.dev.vars` 里存着同样的密钥，都已在 `.gitignore` 中。

## 配置项

前端「设置」页会写入 D1 的 `settings` 表，也可以直接改表：

| 键 | 默认值 | 说明 |
|---|---|---|
| `monthly_budget` | `0` | 月度预算，`剩余额度 = 月度预算 − 本月支出`；0 表示不追踪 |
| `currency` | `CNY` | 展示币种（CNY / USD / EUR / JPY / HKD） |
| `reminder_days` | `7` | 全局提前提醒天数，取值 1–90；单个订阅可在表单里覆盖 |
| `timezone` | `Asia/Shanghai` | 决定「今天」与每日扫描的日期口径 |
| `show_hero` | `0` | 是否把根路径 `/` 变成品牌落地页；关闭时 `/` 直接进登录页（已登录则进概览） |
| `app_mode` | `0` | App 模式（PWA 壳）：手机尺寸或安装后启动时启用底部标签栏与 App 顶栏，桌面端保持 Web 布局 |
| `channel_inapp_enabled` | `1` | 站内提醒，生成提醒记录与未读红点 |
| `channel_push_enabled` | `0` | 浏览器推送（Web Push），是否把提醒推送到已订阅的设备 |
| `channel_webhook_enabled` / `webhook_url` | `0` / 空 | 推送到群机器人、ntfy / Bark / Server 酱或自有服务 |
| `webhook_provider` | `generic` | Webhook 目标类型：`generic` / `wecom` / `dingtalk` / `feishu` / `ntfy` / `bark` / `serverchan`；`generic` 保持原始请求体，升级不影响已有 webhook |
| `webhook_secret` | 空 | 钉钉「加签」/ 飞书「签名校验」的密钥（密钥类，永不下发）。留空表示机器人没开签名；开了但留空会被对方拒绝（飞书报 `19021 sign match fail`） |
| `webhook_token` | 空 | ntfy 访问令牌（密钥类，永不下发）：`tk_…` 以 `Authorization: Bearer` 发送，填 `用户名:密码` 则改用 Basic |
| `channel_telegram_enabled` / `telegram_bot_token` / `telegram_chat_id` | `0` / 空 / 空 | Telegram Bot 推送 |
| `channel_email_enabled` / `email_provider` / `email_from` / `email_to` | `0` / `resend` / 空 / 空 | 邮件推送；`email_provider` 取 `smtp` / `resend` / `http` |
| `smtp_host` / `smtp_secure` / `smtp_port` | 空 / `tls` / `0` | SMTP 服务器；`smtp_secure` 取 `tls`（465 隐式 TLS）或 `starttls`（587）；端口为 0 时按加密方式自动选择 |
| `smtp_user` / `smtp_password` | 空 / 空 | SMTP 认证凭据，不需要认证时留空；`smtp_password` 属于密钥，永不下发 |
| `email_api_key` | 空 | Resend API Key（`email_provider = resend` 时使用） |
| `email_endpoint` | 空 | 自定义 HTTP 邮件网关地址（`email_provider = http` 时使用） |
| `vapid_public_key` / `vapid_private_key` | 首次推送时自动生成 | Web Push 的 VAPID 密钥对，也可以用同名 Worker 变量覆盖（`vapid_private_key` 属于密钥，永不下发） |

密钥类配置（`webhook_secret` / `webhook_token` / `telegram_bot_token` / `smtp_password` / `email_api_key` / `vapid_private_key`）永远不会下发到浏览器：接口只返回 `hasSecrets` 布尔标记，表单留空表示「保持不变」，点「清除」则写入 `null` 删除。

Worker 变量 `ALLOWED_ORIGIN`（`wrangler.toml`）控制 CORS，多个域名用逗号分隔，`*` 表示不限制；`DEBUG_ERRORS=1` 会让 500 响应带上内部错误文本（本地 `npm start` 默认打开，线上不要开）。

### 通知渠道

设置页用「渠道卡片 → 弹窗」的方式配置，每个渠道独立保存、互不影响：

| 渠道 | 配置项 | 备注 |
|---|---|---|
| 站内提醒 | 无 | 在「提醒」页生成记录并显示未读红点 |
| 浏览器推送 | 无（每个设备点一次「在此设备开启推送」授权） | Web Push：Worker 用 VAPID + `aes128gcm` 加密后 POST 到浏览器端点，410/404 会自动清理失效设备。只在 Chrome / Edge / Firefox / Safari 可用——部分 Chromium 发行版没有内置推送服务 |
| Webhook 推送 | 服务类型 + Webhook 地址 +（钉钉/飞书）签名密钥 +（ntfy）访问令牌 | 可在企业微信 / 钉钉 / 飞书群机器人、ntfy、Bark、Server 酱、通用 JSON 之间切换，按目标服务自动适配请求体（飞书用的是 `msg_type` / `content.text`，与另两家不同）。机器人开启「加签 / 签名校验」后，把密钥填进「签名密钥」，请求会自动带上签名 |
| Telegram Bot | Bot Token、Chat ID | 调用 `https://api.telegram.org/bot<token>/sendMessage` |
| 邮件通知 | 发送方式、发件人、收件人，以及对应方式的凭据 | `smtp` 直连邮件服务器；`resend` 走 Resend HTTP API；`http` 走自定义网关 |

> **关于 SMTP**：Workers 的 `connect()` 提供原始 TCP 并明确支持 SMTP，因此邮件可以直接投递：465 端口用隐式 TLS（`secureTransport: "on"`），587 端口用 STARTTLS（`secureTransport: "starttls"` + `socket.startTls()`），只有 25 端口被运行时禁止。`worker/src/smtp.js` 实现了 EHLO / STARTTLS / AUTH PLAIN / AUTH LOGIN / MAIL FROM / RCPT TO / DATA，正文以 UTF-8 + base64 编码投递，中文主题使用 RFC 2047 编码字。
>
> 另外两种方式仍然保留：`resend` 对接 [Resend](https://resend.com) 的 HTTP API；`http` 会向 `email_endpoint` POST `{ from, to, subject, text }`。
>
> SMTP 的传输是可替换的（connector）：生产环境使用 `cloudflare:sockets`，`npm start` 与测试则注入 `node:net` / `node:tls`，所以本地也能直接对着真实邮件服务器联调。

每个渠道弹窗里都有「发送测试消息」按钮，会先用当前表单保存一次配置，再立即投递一条测试消息并显示结果。

### 各渠道的鉴权方式

按官方文档逐个核对过，只有钉钉和飞书自带签名，其余渠道都是「URL 里的凭据即鉴权」：

| 目标 | 官方提供的安全设置 | 本项目如何处理 |
|---|---|---|
| 企业微信（消息推送 / 群机器人） | 没有签名，Webhook 地址里的 `key` 就是唯一凭据，官方只提示不要外泄 | 直接 POST，不做签名 |
| 钉钉自定义机器人 | 自定义关键词、加签、IP 地址段，三选一或多选 | 「加签」时按文档把 `timestamp`（毫秒）与 `sign` 拼进 **URL 查询参数**，`sign = Base64(HMAC-SHA256(key = secret, msg = timestamp + "\n" + secret))` |
| 飞书自定义机器人 | 自定义关键词、IP 白名单、签名校验 | 「签名校验」时把 `timestamp`（秒）与 `sign` 放进 **JSON 请求体**，`sign = Base64(HMAC-SHA256(key = timestamp + "\n" + secret, msg = 空))` |
| ntfy | 无签名，可启用用户名密码或访问令牌（`tk_…`） | 填了「访问令牌」就带 `Authorization`，`tk_` 前缀走 Bearer，`用户名:密码` 走 Basic |
| Bark | 无签名，DeviceKey 即凭据；另有可选的推送加密（自定义 KEY + AES） | 直接 POST，暂不支持推送加密 |
| Server 酱 | 无签名，SendKey 即凭据 | 直接 POST `title` / `desp` |

> 钉钉和飞书若把安全设置选成「自定义关键词」，消息里必须出现关键词才会被接收。提醒正文固定以「【订阅提醒】」开头，把 `订阅提醒` 加进关键词即可，无需改代码。


## 数据模型

| 表 | 用途 |
|---|---|
| `subscriptions` | 订阅主体：金额、币种、周期、`start_date` / `end_date`（`YYYY-MM-DD`）、`auto_renew`、`reminder_days`（NULL = 跟随全局）、状态 |
| `settings` | 键值配置，见上表 |
| `notifications` | 提醒记录，`UNIQUE(subscription_id, due_date, kind)` 保证同一次到期只提醒一次；`deliveries` 保存各渠道投递结果 |
| `push_subscriptions` | 每个订阅了浏览器推送的设备一行：`endpoint`（唯一）、`p256dh`、`auth`、`user_agent`、`last_seen_at` |

状态说明：存库的 `status` 只区分 `active / paused / cancelled`；「已过期」「即将到期」由 `end_date` 与今天实时推导，因此不需要额外定时任务去改状态。

**统计口径**

- 总消费金额 = 所有未取消订阅的金额合计。
- 本月支出 = 生效中且 `[start_date, end_date]` 覆盖本月的订阅金额合计。
- 剩余额度 = 月度预算 − 本月支出（超支时为负数并标红）。
- 月度账单沿用同一口径：某月的合计 = 该月内 `[start_date, end_date]` 有覆盖且未取消的订阅金额之和，因此「本月账单」与首页的「本月支出」永远一致；扣费日取订阅的开始日（跨月时夹到当月最后一天）。

## API

除 `/api/health`、`/api/public` 与 `/api/auth/*` 外都需要 `Authorization: Bearer <token>`。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 健康检查（公开） |
| GET | `/api/public` | 未登录访客可读的公开配置（`showHero` / `appMode` / `reminderDays` / `currency`） |
| POST | `/api/auth/login` | 登录，返回 `token` 与 `username` |
| GET | `/api/auth/session` | 当前会话是否有效 |
| POST | `/api/auth/logout` | 退出（客户端丢弃 Token 即可） |
| GET | `/api/bootstrap` | 首屏聚合：settings + stats + notifications + unread |
| GET | `/api/stats` | 首页统计（预算、支出、分类、6 个月趋势、即将到期、已过期） |
| GET | `/api/bills` | 月度账单列表，`?months=` 取 1–36（默认 12），返回每月合计、分类占比与汇总 |
| GET | `/api/bills/:month` | 单月明细（`YYYY-MM`），按扣费日排列，格式非法返回 `422` |
| GET | `/api/subscriptions` | 列表，支持 `?status=all\|active\|expiring\|expired\|paused\|cancelled`、`?q=`、`?sort=` |
| POST | `/api/subscriptions` | 新建，校验失败返回 `422` 与 `error.details[]` |
| GET/PUT/DELETE | `/api/subscriptions/:id` | 详情 / 更新 / 删除（删除会一并清理提醒） |
| GET | `/api/notifications` | 提醒列表，支持 `?unread=1&limit=` |
| POST | `/api/notifications/read` | 标记已读，`ids: []` 表示全部已读 |
| POST | `/api/reminders/run` | 手动触发一次到期扫描 |
| GET/PUT | `/api/settings` | 读取 / 更新配置 |
| POST | `/api/settings/test` | 用当前配置给指定渠道（含 `push`）发一条测试消息 |
| GET | `/api/push/key` | VAPID 公钥（`applicationServerKey`）与已订阅设备数 |
| POST | `/api/push/subscribe` | 注册一台设备，`{ endpoint, keys: { p256dh, auth } }`，同一 endpoint 幂等更新 |
| POST | `/api/push/unsubscribe` | 取消一台设备，`{ endpoint }` |

## 提醒机制

1. 每天 01:00 UTC 由 Cron Trigger 触发 `scheduled()`，调用 `runReminders()`。
2. 扫描所有 `status = active` 的订阅，提醒窗口取 `订阅自身 reminder_days ?? 全局 reminder_days`：
   - `0 ≤ 剩余天数 ≤ 窗口` → 生成 `expiring_soon` 提醒；
   - `剩余天数 < 0` → 生成 `expired` 提醒，提示确认续费或停用。
3. 写入 `notifications` 时使用 `INSERT OR IGNORE` + 唯一索引，重复扫描不会重复提醒。
4. 对已启用的渠道依次投递（站内 / 浏览器推送 / Webhook / Telegram / 邮件），每个渠道的结果记录在 `deliveries` 里，「提醒」页会显示「已发送 / 发送失败 / 未推送」徽章。浏览器推送会扇出到 `push_subscriptions` 里的每一台设备，失效端点（404 / 410）顺手删除。

本地测试定时任务：

```bash
curl "http://127.0.0.1:8787/__scheduled?cron=0+1+*+*+*"   # wrangler dev
curl -X POST http://localhost:8787/api/reminders/run      # npm start
```

## 测试

```bash
npm test              # 后端：222 条断言
npm run test:render   # 前端：79 条 SSR 渲染 + 211 条 jsdom 交互断言
npm run test:all      # 全部 512 条
```

- `worker/test/smoke.mjs` — 用 `node:sqlite` 模拟 D1，启动真实的 Worker fetch 入口，覆盖登录与限流、未授权拦截、CRUD、校验、筛选、统计口径、7 天窗口边界（第 7 天 / 第 8 天 / 当天）、单个订阅的提醒窗口覆盖、月度账单一览与明细（含参数边界与短月夹取）、提醒幂等性与各渠道投递；Web Push 部分会按 RFC 8291 真解密一次投递载荷、用 ES256 验签 VAPID JWT，并验证 410 端点会被清理；SMTP 部分会在进程内启动一个真实的 TCP 邮件服务器，跑完 EHLO / AUTH / STARTTLS / DATA 全流程并还原报文；Webhook 部分逐个校验企业微信 / 钉钉 / 飞书 / ntfy / Bark / Server 酱的请求体形状、钉钉加签（签名进 URL 查询参数、原参数不丢）与飞书签名（对齐官方 HMAC 顺序）、ntfy 的 Bearer / Basic 令牌，并确认「HTTP 200 但 body 里 error code 非 0」会被判为失败；另外覆盖自动建表（空库首次请求即建表并写入全部默认设置、旧库自动补列、重复执行是空操作、`schema.sql` 与运行时表结构不漂移）与请求加固：畸形路径参数不会把请求打崩，500 默认不下发驱动错误原文。
- `frontend/test/render.mjs` — 用真实路由表把各页面 SSR 成字符串，覆盖登录门禁、匿名访客的根路径分流（落地页 / 登录页）、落地页开关、账单页外壳与真实数据下的模板渲染。
- `frontend/test/client.mjs` — 在 jsdom 中挂载真实应用（真实路由与导航守卫）并模拟操作：未登录访问根路径、登录（含错误口令）、顶栏标题跟随路由、搜索、筛选、弹窗新增、校验拦截、确认删除、独立提醒窗口与自动续费往返、提醒扫描、主题切换、自定义下拉、渠道弹窗配置与测试消息（含 Webhook 目标切换后地址占位、提示与签名密钥字段联动，以及已存地址重新打开时只显示「已配置」）、浏览器推送的设备授权与取消（用假的 `PushManager` 走完整订阅链路，含 VAPID 密钥轮换后的订阅替换、以及浏览器没有推送服务时的降级提示）、App 模式切换与底部标签栏、落地页开关与根路径跳转、打开月度账单明细并关闭、保存设置。

## 设计规范落地

`DESIGN.md` 的 token 一一映射为 CSS 变量（`frontend/src/styles/tokens.css`），未新增第六种强调色：

| 规范 | 实现 |
|---|---|
| `display-xl` 48px / 600 / -2.4px | `.display-xl`（首页主标题） |
| `caption-mono` 12px | `.eyebrow`（区块眉标，Geist Mono 大写） |
| `colors.primary` `#171717` | `--primary`，所有主 CTA 的底色 |
| `rounded.pill` 100px | 营销级按钮；导航按钮用 `rounded.pill-sm` 64px |
| 三段品牌渐变 | `.mesh` 用于登录页与根路径落地页 hero，概览页不使用 |
| 叠加式阴影 + 发丝描边 | `--shadow-xs/sm/md/lg` 多层小偏移，不用单层重投影 |
| 反转色带 | `[data-theme="dark"]` 下 canvas/ink 极性反转 |

浏览器原生控件一律不用：下拉框是 `AppSelect`（listbox 语义 + 键盘操作），开关是 `ToggleSwitch`，弹窗是 `BaseModal`。

## 已知限制

- 一个订阅只有一段 `start_date → end_date`，没有自动续期滚动：`auto_renew` 目前是「标记 + 提醒里带上续费金额」，不会自动把到期时间往后推，续费时手动调整到期时间。
- 只有单一管理员账号，不支持多用户或权限分级。
- SMTP 只实现了发信所需的最小指令集（EHLO / STARTTLS / AUTH PLAIN / AUTH LOGIN / MAIL FROM / RCPT TO / DATA / QUIT），不支持 OAuth2、附件与 DKIM 签名；正文固定为纯文本。
- 群机器人的失败常常是 **HTTP 200 + 错误码**（例如飞书 `19021 sign match fail`、钉钉 `310000`），接口不会返回 4xx，所以「发送测试消息」会解析响应体里的 `code` / `errcode` 再判定成败；卡片上的红字就是对方给的原因。
- 浏览器推送只在 HTTPS（或 localhost）下可用，iOS 还要求先把应用「添加到主屏幕」；系统通知的样式由浏览器决定，无法自定义。
- **部分浏览器收不到 Web Push**：Web Push 依赖浏览器自带的推送服务，没有内置推送服务的浏览器收不到通知。真要在手机上收到提醒，可以用 Webhook 渠道推到 ntfy / Bark / Server 酱（微信）或群机器人，这些 App/服务自带可用的推送通道。
- 浏览器推送需要浏览器自带推送服务。Chrome / Edge（FCM）、Firefox、Safari（APNs）都行，但发行版 Chromium（例如 Termux 的 `chromium-browser`）没有内置推送服务，`pushManager.subscribe()` 要么抛 `Registration failed - push service error`，要么干脆一直不返回——前端为此加了 15 秒超时，超时后设置页会提示「当前浏览器没有可用的推送服务」，并且不会把渠道开关留在开启状态。
- Service Worker 采用「网络优先 + 缓存兜底」，不预缓存构建产物：离线只能打开已经访问过的页面外壳，数据仍需要联网。

## 许可证

[MIT](LICENSE) © 2026 qiuyuxc
