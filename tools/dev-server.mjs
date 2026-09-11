#!/usr/bin/env node
/**
 * Local all-in-one server: serves the built frontend and runs the Cloudflare
 * Worker (with a SQLite-backed D1 shim) on the same origin.
 *
 *   npm run build && npm start        # http://localhost:8787
 *
 * Useful when `wrangler dev` is unavailable (its workerd runtime has no
 * Android/Termux build) or when you just want one command to see the app.
 * Deployment still uses wrangler + real D1 — this only replaces local dev.
 *
 * Env: PORT (default 8787), DB_PATH (default .data/subtrack.db),
 *      ADMIN_USERNAME / ADMIN_PASSWORD / AUTH_SECRET (admin login),
 *      SMTP_INSECURE=1 (skip TLS certificate checks for local mail servers),
 *      DEBUG_ERRORS=0 (hide internal error text from 500 responses)
 *
 * The SMTP channel is wired to `node:net` / `node:tls` here, so the same client
 * code that runs on `cloudflare:sockets` in production also works locally.
 */
import { createServer } from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import worker from '../worker/src/index.js';
import { createD1 } from '../worker/test/d1-shim.mjs';
import { nodeConnect } from './node-sockets.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(root, 'frontend', 'dist');
const DB_PATH = process.env.DB_PATH ?? join(root, '.data', 'subtrack.db');
const PORT = Number(process.env.PORT ?? 8787);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
};

await mkdir(join(root, '.data'), { recursive: true });
const db = createD1(DB_PATH);

// The worker creates the tables itself (`ensureSchema`), so there is nothing to
// apply here — an empty .data/subtrack.db fills in on the first request.

const usingDefaultCreds = !process.env.ADMIN_PASSWORD;
const env = {
  DB: db,
  ALLOWED_ORIGIN: process.env.ALLOWED_ORIGIN ?? '*',
  ADMIN_USERNAME: process.env.ADMIN_USERNAME ?? 'admin',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD ?? 'admin12345',
  AUTH_SECRET: process.env.AUTH_SECRET ?? 'local-dev-signing-key',
  DEBUG_ERRORS: process.env.DEBUG_ERRORS ?? '1',
  SMTP_CONNECT: (host, port, secure) =>
    nodeConnect(host, port, secure, { rejectUnauthorized: process.env.SMTP_INSECURE !== '1' }),
};

async function serveStatic(pathname, res) {
  const relative = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  let filePath = join(DIST, relative);

  const exists = await stat(filePath).then((s) => s.isFile()).catch(() => false);
  if (!exists) {
    // SPA fallback — unknown paths render the app shell.
    filePath = join(DIST, 'index.html');
  }

  const body = await readFile(filePath).catch(() => null);
  if (!body) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404 — 未找到前端构建产物。请先运行 npm run build。');
    return;
  }

  const type = MIME[extname(filePath)] ?? 'application/octet-stream';
  res.writeHead(200, {
    'content-type': type,
    'cache-control': filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  res.end(body);
}

async function toRequest(nodeReq, body) {
  const url = `http://${nodeReq.headers.host ?? `localhost:${PORT}`}${nodeReq.url}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(nodeReq.headers)) {
    if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  }
  return new Request(url, {
    method: nodeReq.method,
    headers,
    body: ['GET', 'HEAD'].includes(nodeReq.method) ? undefined : body.length ? body : undefined,
  });
}

const server = createServer(async (nodeReq, nodeRes) => {
  const body = [];
  for await (const chunk of nodeReq) body.push(chunk);
  const payload = Buffer.concat(body);

  let pathname = '/';
  try {
    pathname = new URL(nodeReq.url, 'http://localhost').pathname;
  } catch {
    /* fall through to static handler, which will 404 */
  }

  if (pathname.startsWith('/api/')) {
    try {
      const response = await worker.fetch(await toRequest(nodeReq, payload), env);
      nodeRes.writeHead(response.status, Object.fromEntries(response.headers));
      nodeRes.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      console.error('api error', error);
      nodeRes.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      nodeRes.end(JSON.stringify({ error: { message: String(error?.message ?? error) } }));
    }
    return;
  }

  try {
    await serveStatic(pathname, nodeRes);
  } catch (error) {
    nodeRes.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    nodeRes.end(String(error?.message ?? error));
  }
});

server.listen(PORT, () => {
  console.log(`\n  SubTrack 本地服务已启动`);
  console.log(`  → http://localhost:${PORT}`);
  console.log(`  → 数据库：${DB_PATH}`);
  console.log(`  → 提示：npm run seed:demo 可写入演示数据`);
  console.log(`  → 登录账号：${env.ADMIN_USERNAME} / ${usingDefaultCreds ? 'admin12345（本地默认，可用 ADMIN_PASSWORD 覆盖）' : '（来自 ADMIN_PASSWORD 环境变量）'}\n`);
});
