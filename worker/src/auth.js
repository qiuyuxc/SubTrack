/**
 * Single-admin authentication.
 *
 * There is deliberately no registration flow: the one account is provisioned
 * through worker environment variables (ADMIN_USERNAME / ADMIN_PASSWORD), and
 * sessions are stateless HMAC-signed tokens carried in an `Authorization:
 * Bearer` header. Bearer tokens (rather than cookies) keep the API immune to
 * CSRF and let the SPA live on a different origin than the Worker without any
 * SameSite/credentials juggling.
 */
const encoder = new TextEncoder();
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const LOGIN_WINDOW_MS = 5 * 60 * 1000;
const LOGIN_MAX_FAILURES = 8;
const attempts = new Map();

/* ------------------------------------------------------------ base64url */

function toBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(data)));
}

/** Length-independent comparison so failures never leak timing. */
function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function secretMatches(secret, expected, provided) {
  const [a, b] = await Promise.all([hmac(secret, expected), hmac(secret, provided)]);
  return constantTimeEqual(a, b);
}

/* --------------------------------------------------------------- config */

export function getAuthConfig(env) {
  const username = String(env.ADMIN_USERNAME ?? '').trim();
  const password = String(env.ADMIN_PASSWORD ?? '');
  // AUTH_SECRET is recommended; falling back to the password keeps a
  // single-variable setup working.
  const secret = String(env.AUTH_SECRET ?? '') || password;
  return { username, password, secret, configured: Boolean(username && password && secret) };
}

/* --------------------------------------------------------------- tokens */

export async function createToken(username, secret, ttlMs = TOKEN_TTL_MS) {
  const now = Date.now();
  const payload = toBase64Url(
    encoder.encode(JSON.stringify({ sub: username, iat: now, exp: now + ttlMs })),
  );
  return `${payload}.${toBase64Url(await hmac(secret, payload))}`;
}

export async function verifyToken(token, secret) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;

  let provided;
  try {
    provided = fromBase64Url(signature);
  } catch {
    return null;
  }
  if (!constantTimeEqual(await hmac(secret, payload), provided)) return null;

  try {
    const data = JSON.parse(new TextDecoder().decode(fromBase64Url(payload)));
    if (typeof data.exp !== 'number' || data.exp < Date.now()) return null;
    if (typeof data.sub !== 'string' || !data.sub) return null;
    return data;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------ sessions */

export async function authenticate(request, env) {
  const config = getAuthConfig(env);
  if (!config.configured) {
    return {
      ok: false,
      status: 503,
      message: '服务端未配置管理员账号，请设置 ADMIN_USERNAME / ADMIN_PASSWORD 后重试',
    };
  }

  const header = request.headers.get('authorization') ?? '';
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  if (!token) return { ok: false, status: 401, message: '请先登录' };

  const session = await verifyToken(token, config.secret);
  if (!session) return { ok: false, status: 401, message: '登录已过期，请重新登录' };

  return { ok: true, username: session.sub, expiresAt: session.exp };
}

/* ------------------------------------------------------------- sign in */

function clientKey(request) {
  return (
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  );
}

export function loginThrottle(request) {
  const key = clientKey(request);
  const entry = attempts.get(key);
  if (entry && entry.resetAt > Date.now() && entry.count >= LOGIN_MAX_FAILURES) {
    return { blocked: true, retryAfter: Math.ceil((entry.resetAt - Date.now()) / 1000) };
  }
  return { blocked: false };
}

export function recordLoginFailure(request) {
  const key = clientKey(request);
  const entry = attempts.get(key);
  if (!entry || entry.resetAt <= Date.now()) {
    attempts.set(key, { count: 1, resetAt: Date.now() + LOGIN_WINDOW_MS });
  } else {
    entry.count += 1;
  }
}

export function clearLoginFailures(request) {
  attempts.delete(clientKey(request));
}

export async function verifyCredentials(username, password, env) {
  const config = getAuthConfig(env);
  if (!config.configured) return { error: 'config' };

  // Always run both comparisons so a wrong username and a wrong password take
  // the same amount of time.
  const [userOk, passwordOk] = await Promise.all([
    secretMatches(config.secret, config.username, String(username ?? '').trim()),
    secretMatches(config.secret, config.password, String(password ?? '')),
  ]);

  if (userOk && passwordOk) return { ok: true, username: config.username };
  return { error: 'invalid' };
}

export { TOKEN_TTL_MS };
