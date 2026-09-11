/**
 * Shared helpers for the subscription worker.
 * Dates are handled as plain `YYYY-MM-DD` strings in the configured timezone so
 * that "days left" never drifts because of UTC offsets.
 */

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...(init.headers || {}),
    },
  });
}

export function fail(status, message, details) {
  return json({ error: { message, details: details ?? null } }, { status });
}

/** `YYYY-MM-DD` for "now" in the given IANA timezone. */
export function todayIn(timezone = 'Asia/Shanghai') {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export function toDate(value) {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function addDays(value, days) {
  const date = toDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`. Negative when `to` is in the past. */
export function daysBetween(from, to) {
  return Math.round((toDate(to) - toDate(from)) / 86400000);
}

export function isValidDate(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  return toDate(value).toISOString().slice(0, 10) === value;
}

export function startOfMonth(value) {
  return `${value.slice(0, 7)}-01`;
}

export function endOfMonth(value) {
  const [y, m] = value.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

export function monthKey(value) {
  return value.slice(0, 7);
}

export function uuid() {
  return crypto.randomUUID();
}

export function nowIso() {
  return new Date().toISOString();
}

export function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export function str(value, { max = 200, fallback = '' } = {}) {
  if (value === undefined || value === null) return fallback;
  return String(value).trim().slice(0, max);
}

export function num(value, fallback = 0) {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}
