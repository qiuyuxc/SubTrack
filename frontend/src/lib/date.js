const DAY = 86400000;

export function parseDate(value) {
  if (!value) return null;
  const [y, m, d] = String(value).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

export function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function todayISO() {
  return toISODate(new Date());
}

export function addDays(value, days) {
  const date = parseDate(value) ?? new Date();
  date.setDate(date.getDate() + days);
  return toISODate(date);
}

export function daysUntil(value) {
  const date = parseDate(value);
  if (!date) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((date - today) / DAY);
}

/** `2026-09-11` → `09/11` (or `2026/09/11`). */
export function formatDate(value, { withYear = false } = {}) {
  const date = parseDate(value);
  if (!date) return '—';
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return withYear ? `${date.getFullYear()}/${m}/${d}` : `${m}/${d}`;
}

export function formatDateLong(value) {
  const date = parseDate(value);
  if (!date) return '—';
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

/** Human countdown used by the reminder surfaces. */
export function countdownLabel(daysLeft) {
  if (daysLeft < 0) return `已过期 ${Math.abs(daysLeft)} 天`;
  if (daysLeft === 0) return '今天到期';
  if (daysLeft === 1) return '明天到期';
  return `${daysLeft} 天后到期`;
}

export function urgencyOf(daysLeft) {
  if (daysLeft < 0) return 'expired';
  if (daysLeft <= 3) return 'critical';
  if (daysLeft <= 7) return 'warning';
  return 'calm';
}

/** Percentage of the subscription period already elapsed. */
export function periodProgress(startDate, endDate) {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  if (!start || !end || end <= start) return 0;
  const elapsed = Date.now() - start.getTime();
  const total = end.getTime() - start.getTime();
  return Math.min(100, Math.max(0, Math.round((elapsed / total) * 100)));
}

export function monthLabel(key) {
  const [y, m] = String(key).split('-');
  return `${Number(m)}月`;
}

export function isValidISODate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ''))) return false;
  const date = parseDate(value);
  return !!date && toISODate(date) === value;
}
