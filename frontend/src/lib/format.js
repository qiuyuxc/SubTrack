const SYMBOLS = { CNY: '¥', USD: '$', EUR: '€', JPY: '¥', GBP: '£', HKD: 'HK$' };

export function currencySymbol(currency = 'CNY') {
  return SYMBOLS[currency] ?? `${currency} `;
}

export function formatMoney(amount, currency = 'CNY', { compact = false } = {}) {
  const value = Number(amount) || 0;
  if (compact && Math.abs(value) >= 10000) {
    return `${currencySymbol(currency)}${(value / 10000).toFixed(2)}万`;
  }
  const fractionDigits = Number.isInteger(value) ? 0 : 2;
  return `${currencySymbol(currency)}${value.toLocaleString('zh-CN', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: 2,
  })}`;
}

export function formatPercent(ratio) {
  return `${Math.round((Number(ratio) || 0) * 100)}%`;
}

export const CYCLES = [
  { value: 'weekly', label: '每周', months: 0.23 },
  { value: 'monthly', label: '每月', months: 1 },
  { value: 'quarterly', label: '每季', months: 3 },
  { value: 'yearly', label: '每年', months: 12 },
  { value: 'once', label: '一次性', months: 0 },
];

export function cycleLabel(cycle) {
  return CYCLES.find((item) => item.value === cycle)?.label ?? cycle;
}

export const STATUS_LABELS = {
  active: '生效中',
  expired: '已过期',
  paused: '已暂停',
  cancelled: '已取消',
};

export function statusMeta(item) {
  if (item.status === 'cancelled') return { label: '已取消', tone: 'default' };
  if (item.status === 'paused') return { label: '已暂停', tone: 'default' };
  if (item.daysLeft < 0) return { label: '已过期', tone: 'error' };
  if (item.daysLeft <= 3) return { label: '即将到期', tone: 'error' };
  if (item.daysLeft <= 7) return { label: '临近到期', tone: 'warning' };
  return { label: '生效中', tone: 'success' };
}
