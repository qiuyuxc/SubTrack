/**
 * Notification channels.
 *
 * Every channel is optional and independently enabled. Each sender validates
 * its own configuration and returns a uniform `{ channel, status, error }`
 * result so the reminder engine can record exactly what happened.
 *
 * The email channel has three transports:
 *   - `smtp`   — talk to a mail server directly
 *   - `resend` — Resend's HTTP API
 *   - `http`   — any gateway that accepts `{ from, to, subject, text }`
 *
 * SMTP is viable from a Worker because `cloudflare:sockets` exposes raw TCP and
 * explicitly supports SMTP: port 465 (implicit TLS) and 587 (STARTTLS) both
 * work, and only port 25 is prohibited by the runtime.
 */
import { sendPush } from './push.js';
import { DEFAULT_PORTS, sendMail } from './smtp.js';

export const CHANNELS = [
  {
    id: 'inapp',
    label: '站内提醒',
    description: '在「提醒」页面生成记录，导航栏显示未读红点。',
    enabledKey: 'channelInappEnabled',
  },
  {
    id: 'push',
    label: '浏览器推送',
    description: '通过系统通知中心推送到手机 / 电脑，安装成 PWA 后体验最佳。',
    enabledKey: 'channelPushEnabled',
  },
  {
    id: 'webhook',
    label: 'Webhook 推送',
    description: '推送到企业微信 / 钉钉 / 飞书群机器人，也可对接自己的服务。',
    enabledKey: 'channelWebhookEnabled',
  },
  {
    id: 'telegram',
    label: 'Telegram Bot',
    description: '通过 Bot API 推送消息，需要一个 Bot Token 与 Chat ID。',
    enabledKey: 'channelTelegramEnabled',
  },
  {
    id: 'email',
    label: '邮件通知',
    description: '直连 SMTP 邮件服务器，或走 Resend API / 自建网关。',
    enabledKey: 'channelEmailEnabled',
  },
];

export const CHANNEL_IDS = CHANNELS.map((channel) => channel.id);

const CURRENCY_SYMBOLS = { CNY: '¥', USD: '$', EUR: '€', JPY: '¥', HKD: 'HK$' };

export function formatAmount(amount, currency = 'CNY') {
  const symbol = CURRENCY_SYMBOLS[currency] ?? '';
  return `${symbol}${Number(amount).toFixed(2)}`;
}

export function isEnabled(settings, id) {
  const channel = CHANNELS.find((item) => item.id === id);
  return Boolean(channel && settings[channel.enabledKey]);
}

export function enabledChannels(settings) {
  return CHANNELS.filter((channel) => settings[channel.enabledKey]).map((channel) => channel.id);
}

/* ------------------------------------------------------------------ helpers */

function ok(channel, detail) {
  return { channel, status: 'sent', error: null, detail: detail ?? null };
}

function failed(channel, error) {
  return { channel, status: 'failed', error, detail: null };
}

function missing(channel, label) {
  return failed(channel, `${label}未配置完整`);
}

async function postJson(url, body, headers = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const text = await response.text().catch(() => '');
  return { response, text: text.slice(0, 300) };
}

/* ----------------------------------------------------------------- channels */

/**
 * Webhook targets.
 *
 * Web Push does not work everywhere — some browsers/builds ship without a push
 * service — so the webhook channel doubles as the escape hatch: every provider
 * below is an app or service that has a working push channel of its own
 * (WeCom, DingTalk, ntfy, Bark, …).
 *
 * Each entry only has to produce the request body; the URL stays user-supplied.
 */
function shellText(message) {
  return `【订阅提醒】${message.title}\n${message.body}`;
}

const encoder = new TextEncoder();

async function hmacSha256(keyBytes, dataBytes) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, dataBytes));
}

function base64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Feishu signs by using `timestamp + "\n" + secret` as the HMAC key and an
 * empty message — the reverse of the usual order, which is what the official
 * SDKs and signing documentation specify. Timestamp is in seconds.
 */
async function feishuSign(timestamp, secret) {
  return base64(await hmacSha256(encoder.encode(`${timestamp}\n${secret}`), new Uint8Array(0)));
}

/**
 * DingTalk uses the conventional order — key = secret, message = timestamp +
 * "\n" + secret — and expects the raw Base64 in the `sign` query parameter.
 * Timestamp is in milliseconds.
 */
async function dingtalkSign(timestamp, secret) {
  return base64(await hmacSha256(encoder.encode(secret), encoder.encode(`${timestamp}\n${secret}`)));
}

/** Adds or replaces query parameters without dropping the existing ones. */
function withQuery(url, params) {
  const target = new URL(url);
  for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value);
  return target.toString();
}

/** Group robots answer HTTP 200 even when they rejected the message. */
function robotFailure(payload) {
  if (!payload || typeof payload !== 'object') return null;
  for (const field of ['errcode', 'code', 'StatusCode']) {
    if (!(field in payload)) continue;
    const value = Number(payload[field]);
    if (Number.isNaN(value)) return null;
    if (value === 0) return null;
    return `${value}：${payload.errmsg ?? payload.msg ?? payload.message ?? payload.StatusMessage ?? '推送被拒绝'}`;
  }
  return null;
}

function ntfyTopic(url) {
  try {
    return new URL(url).pathname.split('/').filter(Boolean).pop() ?? '';
  } catch {
    return '';
  }
}

export const WEBHOOK_PROVIDERS = {
  // The original payload: a superset of the WeCom/DingTalk robot shape.
  generic: {
    label: '通用 JSON',
    body: (message) => ({
      msgtype: 'text',
      text: { content: shellText(message) },
      subscriptionId: message.subscriptionId,
      dueDate: message.dueDate,
      daysLeft: message.daysLeft,
    }),
  },
  wecom: {
    label: '企业微信群机器人',
    body: (message) => ({ msgtype: 'text', text: { content: shellText(message) } }),
  },
  dingtalk: {
    label: '钉钉群机器人',
    // With 「加签」 enabled, timestamp + sign go in the query string, not the
    // body — see the API reference `custom-robots-send-group-messages`.
    prepare: async (message, url, settings) => {
      const body = { msgtype: 'text', text: { content: shellText(message) } };
      const secret = settings?.webhookSecret?.trim();
      if (!secret) return { url, body };
      const timestamp = String(Date.now());
      return { url: withQuery(url, { timestamp, sign: await dingtalkSign(timestamp, secret) }), body };
    },
  },
  // Feishu spells both keys differently from WeCom/DingTalk, and needs a
  // signature whenever the bot has signature verification switched on.
  feishu: {
    label: '飞书群机器人',
    body: async (message, url, settings) => {
      const payload = { msg_type: 'text', content: { text: shellText(message) } };
      const secret = settings?.webhookSecret?.trim();
      if (secret) {
        const timestamp = String(Math.floor(Date.now() / 1000));
        payload.timestamp = timestamp;
        payload.sign = await feishuSign(timestamp, secret);
      }
      return payload;
    },
  },
  ntfy: {
    label: 'ntfy',
    // ntfy has no signature; access control is a token (`tk_…`) sent as a
    // Bearer header, or `user:password` sent as Basic auth.
    prepare: (message, url, settings) => {
      const token = settings?.webhookToken?.trim();
      const headers = {};
      if (token) headers.authorization = token.includes(':') ? `Basic ${base64(encoder.encode(token))}` : `Bearer ${token}`;
      return {
        url,
        headers,
        body: {
          topic: ntfyTopic(url),
          title: message.title,
          message: message.body,
          tags: ['bell'],
          priority: 4,
        },
      };
    },
  },
  bark: {
    label: 'Bark',
    body: (message) => ({
      title: message.title,
      body: message.body,
      group: 'SubTrack',
      level: 'active',
    }),
    // Bark answers { code: 200 } on success, unlike everyone else's 0.
    failure: (payload) =>
      payload && typeof payload === 'object' && Number(payload.code) !== 200
        ? `${payload.code}：${payload.message ?? '推送被拒绝'}`
        : null,
  },
  serverchan: {
    label: 'Server 酱',
    body: (message) => ({
      title: message.title,
      desp: `${message.body}\n\n到期日：${message.dueDate}`,
    }),
  },
};

export const WEBHOOK_PROVIDER_IDS = Object.keys(WEBHOOK_PROVIDERS);

async function sendWebhook(settings, message) {
  const url = settings.webhookUrl?.trim();
  if (!url) return missing('webhook', 'Webhook 地址');

  const provider = WEBHOOK_PROVIDERS[settings.webhookProvider] ?? WEBHOOK_PROVIDERS.generic;
  // `prepare` may rewrite the URL (DingTalk signing) or add headers (ntfy auth);
  // providers that only need a payload keep the simpler `body` hook.
  const request = provider.prepare
    ? await provider.prepare(message, url, settings)
    : { url, body: await provider.body(message, url, settings) };
  const { response, text } = await postJson(request.url, request.body, request.headers ?? {});
  if (!response.ok) return failed('webhook', `Webhook 返回 ${response.status}：${text}`);

  // Group robots reject with HTTP 200 and an error code in the body, so a
  // failed delivery must not be reported as sent.
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    /* not JSON — fall back to the HTTP status alone */
  }
  const rejected = provider.failure ? provider.failure(payload) : robotFailure(payload);
  if (rejected) return failed('webhook', `${provider.label} 拒绝：${rejected}`);

  return ok('webhook', `${provider.label}：${text.slice(0, 100) || '已发送'}`);
}

async function sendTelegram(settings, message) {
  const token = settings.telegramBotToken?.trim();
  const chatId = settings.telegramChatId?.trim();
  if (!token) return missing('telegram', 'Bot Token');
  if (!chatId) return missing('telegram', 'Chat ID');

  const { response, text } = await postJson(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      chat_id: chatId,
      text: `订阅提醒\n\n${message.title}\n${message.body}`,
      disable_web_page_preview: true,
    },
  );

  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    /* non-JSON body — fall through to the status check */
  }
  if (!response.ok || payload?.ok === false) {
    return failed('telegram', `Telegram 返回 ${response.status}：${payload?.description ?? text}`);
  }
  return ok('telegram', '已推送');
}

/** Direct SMTP delivery; `context.env.SMTP_CONNECT` swaps the transport locally. */
async function sendSmtp(settings, mail, context) {
  const host = settings.smtpHost?.trim();
  if (!host) return missing('email', 'SMTP 服务器地址');

  const secure = settings.smtpSecure === 'starttls' ? 'starttls' : 'tls';
  const port = Number(settings.smtpPort) > 0 ? Number(settings.smtpPort) : DEFAULT_PORTS[secure];
  const user = settings.smtpUser?.trim();

  try {
    const { accepted } = await sendMail({
      connector: context.env?.SMTP_CONNECT,
      host,
      port,
      secure,
      user,
      password: user ? settings.smtpPassword ?? '' : '',
      from: mail.from,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
    });
    return ok('email', `SMTP ${host}:${port} 已投递给 ${accepted} 位收件人`);
  } catch (error) {
    return failed('email', `SMTP ${host}:${port}：${String(error?.message ?? error).slice(0, 180)}`);
  }
}

async function sendEmail(settings, message, context = {}) {
  const from = settings.emailFrom?.trim();
  const to = (settings.emailTo ?? '').split(',').map((entry) => entry.trim()).filter(Boolean);
  if (!from) return missing('email', '发件人');
  if (!to.length) return missing('email', '收件人');

  const payload = {
    from,
    to,
    subject: `【订阅提醒】${message.title}`,
    text: `${message.title}\n\n${message.body}\n\n到期日：${message.dueDate}`,
  };

  if (settings.emailProvider === 'smtp') return sendSmtp(settings, payload, context);

  if (settings.emailProvider === 'http') {
    const endpoint = settings.emailEndpoint?.trim();
    if (!endpoint) return missing('email', '邮件网关地址');
    const { response, text } = await postJson(endpoint, payload, { accept: 'application/json' });
    if (!response.ok) return failed('email', `邮件网关返回 ${response.status}：${text}`);
    return ok('email', '已提交到邮件网关');
  }

  const apiKey = settings.emailApiKey?.trim();
  if (!apiKey) return missing('email', 'Resend API Key');
  const { response, text } = await postJson('https://api.resend.com/emails', payload, {
    authorization: `Bearer ${apiKey}`,
  });
  if (!response.ok) return failed('email', `Resend 返回 ${response.status}：${text}`);
  return ok('email', '已提交到 Resend');
}

/**
 * Web Push needs the database (one row per registered browser), so it reads its
 * context off the third argument every sender receives.
 */
async function pushChannel(settings, message, context = {}) {
  if (!context.db) return failed('push', '浏览器推送缺少数据库上下文');
  const result = await sendPush(context.db, settings, message, {
    env: context.env ?? {},
    url: context.pushUrl,
    tag: context.pushTag,
  });
  if (result.error) return failed('push', result.error);
  return ok('push', `已推送到 ${result.delivered}/${result.total} 台设备`);
}

const SENDERS = {
  inapp: async () => ok('inapp', '已写入提醒记录'),
  push: pushChannel,
  webhook: sendWebhook,
  telegram: sendTelegram,
  email: sendEmail,
};

/** Delivers one message through every enabled channel. */
export async function deliverAll(settings, message, context = {}) {
  const ids = enabledChannels(settings);
  const results = [];
  for (const id of ids) {
    try {
      results.push(await SENDERS[id](settings, message, context));
    } catch (error) {
      results.push(failed(id, String(error?.message ?? error).slice(0, 200)));
    }
  }
  return results;
}

/** Used by the "发送测试消息" button in the settings UI. */
export async function deliverOne(settings, id, message, context = {}) {
  const sender = SENDERS[id];
  if (!sender) return failed(id, '未知的推送渠道');
  try {
    return await sender(settings, message, context);
  } catch (error) {
    return failed(id, String(error?.message ?? error).slice(0, 200));
  }
}

export function summarise(results) {
  const sent = results.filter((result) => result.status === 'sent');
  const failedResults = results.filter((result) => result.status !== 'sent');
  const status = !results.length
    ? 'skipped'
    : failedResults.length === 0
      ? 'sent'
      : sent.length === 0
        ? 'failed'
        : 'partial';
  return {
    status,
    // Channels that actually accepted the message; falls back to the attempted
    // set so the UI can still show "tried but failed".
    channel: (sent.length ? sent : results).map((result) => result.channel).join(','),
    sent: sent.length,
    failed: failedResults.length,
  };
}
