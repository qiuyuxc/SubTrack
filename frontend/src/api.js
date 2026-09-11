const BASE = (import.meta.env.VITE_API_BASE ?? '/api').replace(/\/$/, '');
const TOKEN_KEY = 'subtrack-token';

export class ApiError extends Error {
  constructor(message, { status, details } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details ?? null;
  }
}

/* ------------------------------------------------------------------ token */

let token = readStoredToken();

function readStoredToken() {
  try {
    return globalThis.localStorage?.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

export function getToken() {
  return token;
}

export function setToken(value) {
  token = value ?? '';
  try {
    if (token) globalThis.localStorage?.setItem(TOKEN_KEY, token);
    else globalThis.localStorage?.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable — the in-memory token still works for this session */
  }
}

let onUnauthorized = null;

/** Called by the store so a 401 anywhere bounces the user back to /login. */
export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler;
}

/* ---------------------------------------------------------------- request */

/** `anonymous` drops the token (login); `quiet401` keeps it but never bounces to /login. */
async function request(path, { method = 'GET', body, signal, anonymous = false, quiet401 = false } = {}) {
  const headers = {};
  if (body) headers['content-type'] = 'application/json';
  if (!anonymous && token) headers.authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new ApiError('无法连接到后端服务，请确认 Worker 已启动。', { status: 0 });
  }

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    if (response.status === 401 && !anonymous && !quiet401) onUnauthorized?.();
    throw new ApiError(payload?.error?.message ?? `请求失败（HTTP ${response.status}）`, {
      status: response.status,
      details: payload?.error?.details,
    });
  }
  return payload;
}

function query(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, value);
  }
  const string = search.toString();
  return string ? `?${string}` : '';
}

export const api = {
  publicConfig: (signal) => request('/public', { signal, anonymous: true }),
  login: (username, password) => request('/auth/login', { method: 'POST', body: { username, password }, anonymous: true }),
  logout: () => request('/auth/logout', { method: 'POST', anonymous: true }),
  session: (signal) => request('/auth/session', { signal, quiet401: true }),

  bootstrap: (signal) => request('/bootstrap', { signal }),
  stats: (signal) => request('/stats', { signal }),

  listBills: (params, signal) => request(`/bills${query(params)}`, { signal }),
  getBill: (month, signal) => request(`/bills/${month}`, { signal }),

  listSubscriptions: (params, signal) => request(`/subscriptions${query(params)}`, { signal }),
  getSubscription: (id, signal) => request(`/subscriptions/${id}`, { signal }),
  createSubscription: (payload) => request('/subscriptions', { method: 'POST', body: payload }),
  updateSubscription: (id, payload) => request(`/subscriptions/${id}`, { method: 'PUT', body: payload }),
  deleteSubscription: (id) => request(`/subscriptions/${id}`, { method: 'DELETE' }),

  getSettings: (signal) => request('/settings', { signal }),
  saveSettings: (payload) => request('/settings', { method: 'PUT', body: payload }),
  testChannel: (channel) => request('/settings/test', { method: 'POST', body: { channel } }),

  pushKey: (signal) => request('/push/key', { signal }),
  subscribePush: (subscription) => request('/push/subscribe', { method: 'POST', body: subscription }),
  unsubscribePush: (endpoint) => request('/push/unsubscribe', { method: 'POST', body: { endpoint } }),

  listNotifications: (params, signal) => request(`/notifications${query(params)}`, { signal }),
  markNotificationsRead: (ids = []) => request('/notifications/read', { method: 'POST', body: { ids } }),

  runReminders: () => request('/reminders/run', { method: 'POST' }),
};
