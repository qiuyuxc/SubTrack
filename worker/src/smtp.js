/**
 * Minimal SMTP client.
 *
 * Cloudflare's `connect()` runtime API exposes raw TCP sockets and explicitly
 * supports SMTP, so a Worker can talk to a mail server directly:
 *
 *   - port 465 → implicit TLS (`secureTransport: "on"`)
 *   - port 587 → STARTTLS (`secureTransport: "starttls"` + `socket.startTls()`)
 *   - port 25  → prohibited by the runtime
 *
 * Only what a notification needs is implemented: EHLO, optional STARTTLS,
 * AUTH PLAIN / LOGIN, MAIL FROM / RCPT TO / DATA, QUIT.
 *
 * The socket is obtained through a connector so the transport stays swappable
 * (Workers in production, `node:net` / `node:tls` in local development).
 */
import { uuid } from './utils.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const CRLF = '\r\n';

/* ---------------------------------------------------------------- transport */

/** Production transport: the Workers runtime TCP socket. */
async function cloudflareConnect(host, port, secure) {
  const { connect } = await import('cloudflare:sockets');
  const secureTransport = secure === 'starttls' ? 'starttls' : secure === 'tls' ? 'on' : 'off';
  return connect({ hostname: host, port }, { secureTransport });
}

/**
 * A connector receives `(host, port, secure)` and resolves to an object with
 * `readable` / `writable` web streams, `close()`, and — for STARTTLS — an
 * optional `startTls()` that resolves to the upgraded socket.
 */
export function resolveConnector(connector) {
  return typeof connector === 'function' ? connector : cloudflareConnect;
}

/* ------------------------------------------------------------------ session */

class Session {
  constructor(socket) {
    this.socket = socket;
    this.writer = socket.writable.getWriter();
    this.reader = socket.readable.getReader();
    this.buffer = '';
  }

  async readLine() {
    for (;;) {
      const end = this.buffer.indexOf(CRLF);
      if (end >= 0) {
        const line = this.buffer.slice(0, end);
        this.buffer = this.buffer.slice(end + CRLF.length);
        return line;
      }
      const { value, done } = await this.reader.read();
      if (done) {
        if (this.buffer.length) {
          const rest = this.buffer;
          this.buffer = '';
          return rest;
        }
        throw new Error('SMTP 服务器关闭了连接');
      }
      this.buffer += decoder.decode(value, { stream: true });
    }
  }

  /** Reads one reply, following `250-` continuation lines until `250 `. */
  async readReply() {
    const lines = [];
    for (;;) {
      const line = await this.readLine();
      lines.push(line);
      if (!/^\d{3}-/.test(line)) break;
    }
    return { code: Number(lines[lines.length - 1]?.slice(0, 3)), lines, text: lines.join('\n') };
  }

  async write(text) {
    await this.writer.write(encoder.encode(text));
  }

  async command(line, expected) {
    await this.write(`${line}${CRLF}`);
    const reply = await this.readReply();
    if (expected && reply.code !== expected) {
      const last = reply.lines[reply.lines.length - 1] ?? '';
      throw new Error(`SMTP ${line.split(' ')[0]} 被拒绝（${last}）`);
    }
    return reply;
  }

  async close() {
    try {
      await this.writer.close();
    } catch {
      /* the server may have closed first */
    }
    try {
      this.socket.close?.();
    } catch {
      /* already gone */
    }
  }
}

/* -------------------------------------------------------------------- parts */

function base64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function encodeHeaderValue(value) {
  // RFC 2047 encoded-word: keeps non-ASCII subjects intact.
  return `=?UTF-8?B?${base64(encoder.encode(value))}?=`;
}

/** `提醒 <bot@example.com>` → `bot@example.com`. */
export function addressOf(value) {
  const match = /<([^>]+)>/.exec(value ?? '');
  return (match ? match[1] : String(value ?? '')).trim();
}

function displayName(value) {
  const match = /^\s*(.*?)\s*<[^>]+>\s*$/.exec(value ?? '');
  return match?.[1]?.trim() ?? '';
}

function fromHeader(value) {
  const name = displayName(value);
  const address = addressOf(value);
  return name ? `${encodeHeaderValue(name)} <${address}>` : address;
}

function chunk76(value) {
  return value.replace(/(.{76})/g, `$1${CRLF}`).replace(/\s+$/, '');
}

/** A plain-text, base64-encoded UTF-8 message — no 8-bit or dot-stuffing risk. */
export function buildMessage({ from, to, subject, text }) {
  const headers = [
    `From: ${fromHeader(from)}`,
    `To: ${to.map(addressOf).join(', ')}`,
    `Subject: ${encodeHeaderValue(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${uuid()}@subtrack.local>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
  ];
  return `${headers.join(CRLF)}${CRLF}${CRLF}${chunk76(base64(encoder.encode(text)))}`;
}

/** Leading dots are doubled so a body line can never end the DATA section. */
function dotStuff(message) {
  return message.replace(/\r\n\./g, `\r\n..`).replace(/^\./, '..');
}

/* ------------------------------------------------------------------- sending */

async function authenticate(session, capabilities, user, password) {
  const nul = String.fromCharCode(0);
  if (/AUTH[^A-Z]*PLAIN/i.test(capabilities)) {
    await session.command(`AUTH PLAIN ${base64(encoder.encode(`${nul}${user}${nul}${password}`))}`, 235);
    return;
  }
  await session.command('AUTH LOGIN', 334);
  await session.command(base64(encoder.encode(user)), 334);
  await session.command(base64(encoder.encode(password)), 235);
}

/**
 * Delivers one message. Throws on any protocol-level rejection so the caller
 * can surface the server's own words in the UI.
 */
export async function sendMail({
  connector,
  host,
  port,
  secure = 'tls',
  user = '',
  password = '',
  from,
  to,
  subject,
  text,
  heloName = 'subtrack.local',
}) {
  const connect = resolveConnector(connector);
  const socket = await connect(host, port, secure);
  await socket.opened?.catch?.(() => {});
  const session = new Session(socket);

  try {
    const greeting = await session.readReply();
    if (greeting.code !== 220) {
      throw new Error(`SMTP 服务器未就绪（${greeting.lines[0] ?? greeting.code}）`);
    }

    let ehlo = await session.command(`EHLO ${heloName}`, 250);

    if (secure === 'starttls') {
      if (!/STARTTLS/i.test(ehlo.text)) {
        throw new Error('SMTP 服务器未提供 STARTTLS，请改用 465 端口（隐式 TLS）');
      }
      await session.command('STARTTLS', 220);
      if (typeof socket.startTls !== 'function') throw new Error('当前运行时不支持 STARTTLS 升级');
      await socket.startTls();
      ehlo = await session.command(`EHLO ${heloName}`, 250);
    }

    if (user) await authenticate(session, ehlo.text, user, password);

    await session.command(`MAIL FROM:<${addressOf(from)}>`, 250);
    for (const recipient of to) {
      const reply = await session.command(`RCPT TO:<${addressOf(recipient)}>`);
      if (reply.code !== 250 && reply.code !== 251) {
        throw new Error(`收件人被拒绝（${addressOf(recipient)}）：${reply.lines[reply.lines.length - 1]}`);
      }
    }

    await session.command('DATA', 354);
    await session.write(`${dotStuff(buildMessage({ from, to, subject, text }))}${CRLF}.${CRLF}`);
    const accepted = await session.readReply();
    if (accepted.code !== 250) {
      throw new Error(`投递失败：${accepted.lines[accepted.lines.length - 1] ?? accepted.code}`);
    }

    await session.command('QUIT', 221).catch(() => {});
    return { accepted: to.length };
  } finally {
    await session.close();
  }
}

export const DEFAULT_PORTS = { tls: 465, starttls: 587 };
