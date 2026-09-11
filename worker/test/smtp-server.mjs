/**
 * A tiny in-process SMTP server, plus a socket connector for it.
 *
 * The Worker's SMTP client is written against the `cloudflare:sockets` shape
 * (`readable` / `writable` web streams), so the tests inject `smtpConnector()`
 * through `env.SMTP_CONNECT` and drive the real protocol code over a real TCP
 * connection — the conversation itself is never mocked.
 */
import { connect as netConnect, createServer } from 'node:net';
import { Readable, Writable } from 'node:stream';

const CRLF = '\r\n';

/** Wraps node sockets into the web-stream shape `worker/src/smtp.js` expects. */
export function smtpConnector() {
  return (host, port) =>
    new Promise((resolve, reject) => {
      const socket = netConnect({ host, port });
      socket.once('connect', () => {
        const wrapped = {
          readable: Readable.toWeb(socket),
          writable: Writable.toWeb(socket),
          close: () => socket.destroy(),
        };
        // No real TLS in tests: the upgrade just returns the same transport,
        // which still exercises the client's ordering and re-EHLO.
        wrapped.startTls = async () => ({ ...wrapped, secured: true });
        resolve(wrapped);
      });
      socket.once('error', reject);
    });
}

/**
 * @param {object} [options]
 * @param {string[]} [options.capabilities] EHLO response lines (without the code prefix).
 * @param {string} [options.dataReply] Reply to the terminating dot.
 * @param {string} [options.rejectRecipient] Reject RCPT TO containing this string.
 */
export async function startSmtpServer(options = {}) {
  const capabilities = options.capabilities ?? ['fake.local', 'AUTH PLAIN LOGIN', 'SIZE 10485760'];
  const sessions = [];
  const connections = new Set();

  const server = createServer((socket) => {
    connections.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => connections.delete(socket));

    const session = { commands: [], data: null, secured: false, auth: null, stages: [] };
    sessions.push(session);

    let buffer = '';
    let inData = false;
    let loginStage = 0;
    const reply = (line) => socket.write(`${line}${CRLF}`);
    reply('220 fake.local ESMTP ready');

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      for (;;) {
        if (inData) {
          const end = buffer.indexOf(`${CRLF}.${CRLF}`);
          if (end < 0) return;
          session.data = buffer.slice(0, end);
          buffer = buffer.slice(end + CRLF.length + 3);
          inData = false;
          reply(options.dataReply ?? '250 2.0.0 Ok: queued as FAKE1');
          continue;
        }
        const newline = buffer.indexOf(CRLF);
        if (newline < 0) return;
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + CRLF.length);
        session.commands.push(line);
        const upper = line.toUpperCase();

        if (loginStage === 1) {
          loginStage = 2;
          session.auth = { user: Buffer.from(line, 'base64').toString('utf8') };
          reply('334 UGFzc3dvcmQ6');
          continue;
        }
        if (loginStage === 2) {
          loginStage = 0;
          session.auth.password = Buffer.from(line, 'base64').toString('utf8');
          reply('235 2.7.0 Accepted');
          continue;
        }

        if (upper.startsWith('EHLO') || upper.startsWith('HELO')) {
          capabilities.forEach((capability, index) =>
            reply(`250${index === capabilities.length - 1 ? ' ' : '-'}${capability}`),
          );
        } else if (upper === 'STARTTLS') {
          session.secured = true;
          reply('220 2.0.0 Ready to start TLS');
        } else if (upper.startsWith('AUTH PLAIN')) {
          session.auth = { plain: line.split(' ')[2] };
          reply('235 2.7.0 Accepted');
        } else if (upper === 'AUTH LOGIN') {
          loginStage = 1;
          reply('334 VXNlcm5hbWU6');
        } else if (upper.startsWith('MAIL FROM')) {
          reply('250 2.1.0 Ok');
        } else if (upper.startsWith('RCPT TO')) {
          if (options.rejectRecipient && line.includes(options.rejectRecipient)) reply('550 5.1.1 No such user');
          else reply('250 2.1.5 Ok');
        } else if (upper === 'DATA') {
          inData = true;
          reply('354 End data with <CR><LF>.<CR><LF>');
        } else if (upper === 'QUIT') {
          reply('221 2.0.0 Bye');
          socket.end();
        } else {
          reply('502 5.5.2 Command not recognized');
        }
      }
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  return {
    port: server.address().port,
    sessions,
    close: () =>
      new Promise((resolve) => {
        for (const socket of connections) socket.destroy();
        server.close(resolve);
      }),
  };
}

/** Reads the base64 body back out of a captured DATA payload. */
export function decodeBase64Body(data) {
  const [, body = ''] = data.split(`${CRLF}${CRLF}`);
  return Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8');
}

export function headerLines(data) {
  const [head = ''] = data.split(`${CRLF}${CRLF}`);
  return head.split(CRLF);
}

export function decodeHeaderWord(line) {
  const match = /=\?UTF-8\?B\?([^?]+)\?=/.exec(line);
  return match ? Buffer.from(match[1], 'base64').toString('utf8') : null;
}
