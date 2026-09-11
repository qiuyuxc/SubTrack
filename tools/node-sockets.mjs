/**
 * `cloudflare:sockets` stand-in for the local dev server.
 *
 * The Worker reaches SMTP through a connector so the transport can be swapped:
 * production uses the runtime's `connect()`, while `npm start` passes
 * `nodeConnect` below (node:net / node:tls) to the same SMTP client.
 */
import { connect as netConnect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { Readable, Writable } from 'node:stream';

function wrap(socket) {
  return {
    readable: Readable.toWeb(socket),
    writable: Writable.toWeb(socket),
    close: () => socket.destroy(),
    startTls: (options = {}) =>
      new Promise((resolve, reject) => {
        const secured = tlsConnect({ socket, servername: options.servername, ...options });
        secured.once('secureConnect', () => resolve(wrap(secured)));
        secured.once('error', reject);
      }),
  };
}

/**
 * @param {string} host
 * @param {number} port
 * @param {'tls'|'starttls'|'off'} secure
 * @param {{ rejectUnauthorized?: boolean }} [options]
 */
export function nodeConnect(host, port, secure, options = {}) {
  return new Promise((resolve, reject) => {
    if (secure === 'tls') {
      const socket = tlsConnect({ host, port, servername: host, ...options });
      socket.once('secureConnect', () => resolve(wrap(socket)));
      socket.once('error', reject);
      return;
    }
    const socket = netConnect({ host, port });
    socket.once('connect', () => {
      const wrapped = wrap(socket);
      wrapped.startTls = () =>
        new Promise((res, rej) => {
          const secured = tlsConnect({ socket, servername: host, ...options });
          secured.once('secureConnect', () => res(wrap(secured)));
          secured.once('error', rej);
        });
      resolve(wrapped);
    });
    socket.once('error', reject);
  });
}
