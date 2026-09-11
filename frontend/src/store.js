import { computed, reactive, readonly } from 'vue';
import { api, ApiError, setToken, setUnauthorizedHandler, getToken } from './api.js';
import { currentSubscription, pushSupported, subscribe as subscribeBrowser, unsubscribe as unsubscribeBrowser } from './lib/push.js';
import { registerServiceWorker } from './lib/pwa.js';

const EMPTY_SETTINGS = {
  monthlyBudget: 0,
  currency: 'CNY',
  reminderDays: 7,
  timezone: 'Asia/Shanghai',
  showHero: false,
  appMode: false,
  channelInappEnabled: true,
  channelPushEnabled: false,
  channelWebhookEnabled: false,
  webhookUrl: '',
  channelTelegramEnabled: false,
  telegramBotToken: '',
  telegramChatId: '',
  channelEmailEnabled: false,
  emailProvider: 'resend',
  emailApiKey: '',
  emailEndpoint: '',
  emailFrom: '',
  emailTo: '',
  hasSecrets: {},
};

const state = reactive({
  auth: { checked: false, authenticated: false, username: '' },
  publicSettings: null,
  ready: false,
  loading: false,
  error: null,
  settings: { ...EMPTY_SETTINGS },
  stats: null,
  subscriptions: [],
  notifications: [],
  unread: 0,
  push: { ready: false, supported: false, subscribed: false, devices: 0, publicKey: '' },
  toasts: [],
  theme: 'light',
  revision: 0,
});

let toastSeq = 0;

/* ------------------------------------------------------------------- toasts */

export function pushToast(message, { tone = 'default', timeout = 3600 } = {}) {
  const id = ++toastSeq;
  state.toasts.push({ id, message, tone });
  if (timeout) {
    setTimeout(() => dismissToast(id), timeout);
  }
  return id;
}

export function dismissToast(id) {
  const index = state.toasts.findIndex((toast) => toast.id === id);
  if (index >= 0) state.toasts.splice(index, 1);
}

function reportError(error, fallback = '操作失败') {
  const message = error instanceof ApiError ? error.message : error?.message ?? fallback;
  const details = error instanceof ApiError && Array.isArray(error.details) ? error.details : [];
  pushToast(details.length ? `${message}：${details[0]}` : message, { tone: 'error', timeout: 6000 });
  state.error = message;
  return message;
}

/* -------------------------------------------------------------------- theme */

export function applyTheme(theme) {
  state.theme = theme;
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem('subtrack-theme', theme);
  } catch {
    /* storage unavailable — theme still applies for this session */
  }
}

export function toggleTheme() {
  applyTheme(state.theme === 'dark' ? 'light' : 'dark');
}

export function initTheme() {
  let stored = null;
  try {
    stored = localStorage.getItem('subtrack-theme');
  } catch {
    /* ignore */
  }
  const prefersDark =
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  applyTheme(stored ?? (prefersDark ? 'dark' : 'light'));
}

/* ---------------------------------------------------------------------- auth */

function resetWorkspace() {
  state.ready = false;
  state.push = { ready: false, supported: false, subscribed: false, devices: 0, publicKey: '' };
  state.stats = null;
  state.subscriptions = [];
  state.notifications = [];
  state.unread = 0;
  state.settings = { ...EMPTY_SETTINGS };
}

/**
 * A tiny slice of settings that anonymous visitors are allowed to read: it
 * decides whether `/` renders the landing page or bounces to the login screen.
 */
let publicConfigPromise = null;
let publicConfigLoaded = false;

export function loadPublicConfig({ force = false } = {}) {
  if (publicConfigLoaded && !force && state.publicSettings) return Promise.resolve(state.publicSettings);
  if (publicConfigPromise) return publicConfigPromise;

  publicConfigPromise = api
    .publicConfig()
    .then((payload) => {
      state.publicSettings = {
        showHero: Boolean(payload?.showHero),
        appMode: Boolean(payload?.appMode),
        reminderDays: payload?.reminderDays ?? 7,
        currency: payload?.currency ?? 'CNY',
      };
      publicConfigLoaded = true;
      return state.publicSettings;
    })
    .catch(() => {
      // An unreachable API must not trap the visitor: fall back to "no landing".
      state.publicSettings = { showHero: false, appMode: false, reminderDays: 7, currency: 'CNY' };
      return state.publicSettings;
    })
    .finally(() => {
      publicConfigPromise = null;
    });

  return publicConfigPromise;
}

let sessionPromise = null;

/** Resolves whether a usable session exists (cached until one is invalidated). */
export function ensureSession({ force = false } = {}) {
  if (state.auth.checked && !force) return Promise.resolve(state.auth.authenticated);
  if (sessionPromise) return sessionPromise;

  sessionPromise = (async () => {
    if (!getToken()) {
      state.auth = { checked: true, authenticated: false, username: '' };
      return false;
    }
    try {
      const { authenticated, username } = await api.session();
      state.auth = { checked: true, authenticated, username: username ?? '' };
    } catch {
      state.auth = { checked: true, authenticated: false, username: '' };
    }
    return state.auth.authenticated;
  })().finally(() => {
    sessionPromise = null;
  });

  return sessionPromise;
}

export async function login(username, password) {
  const { token: issued, username: name } = await api.login(username, password);
  setToken(issued);
  state.auth = { checked: true, authenticated: true, username: name };
  await loadBootstrap({ silent: true });
}

export async function logout() {
  try {
    await api.logout();
  } catch {
    /* the token is dropped locally regardless */
  }
  setToken('');
  resetWorkspace();
  state.auth = { checked: true, authenticated: false, username: '' };
}

function handleUnauthorized() {
  setToken('');
  resetWorkspace();
  state.auth = { checked: true, authenticated: false, username: '' };
}

/** Wired from main.js so a 401 anywhere lands back on the login screen. */
export function registerAuthHandlers({ onExpired }) {
  setUnauthorizedHandler(() => {
    const wasAuthenticated = state.auth.authenticated;
    handleUnauthorized();
    if (wasAuthenticated) pushToast('登录已过期，请重新登录', { tone: 'error' });
    onExpired?.();
  });
}

/* ------------------------------------------------------------------- loading */

function applyBootstrap(payload) {
  state.settings = payload.settings;
  state.stats = payload.stats;
  state.unread = payload.unread ?? 0;
  state.notifications = payload.notifications ?? [];
  state.subscriptions = payload.stats?.monthlySubscriptions ?? [];
}

export async function loadBootstrap({ silent = false } = {}) {
  if (!state.auth.authenticated) return;
  if (!silent) state.loading = true;
  try {
    applyBootstrap(await api.bootstrap());
    state.ready = true;
    state.error = null;
  } catch (error) {
    state.error = error?.message ?? '加载失败';
    if (!silent) reportError(error, '加载数据失败');
  } finally {
    state.loading = false;
  }
}

export async function refreshStats({ silent = true } = {}) {
  try {
    const { stats } = await api.stats();
    state.stats = stats;
    state.subscriptions = stats.monthlySubscriptions ?? [];
    state.revision += 1;
    state.error = null;
  } catch (error) {
    if (!silent) reportError(error, '刷新统计失败');
  }
}

export async function refreshNotifications() {
  try {
    const payload = await api.listNotifications({ limit: 50 });
    state.notifications = payload.notifications ?? [];
    state.unread = payload.unread ?? 0;
  } catch (error) {
    reportError(error, '加载提醒失败');
  }
}

/* ------------------------------------------------------------------ mutation */

export async function createSubscription(payload) {
  try {
    const { subscription } = await api.createSubscription(payload);
    pushToast(`已添加订阅「${subscription.name}」`, { tone: 'success' });
    await Promise.all([refreshStats(), refreshNotifications()]);
    return subscription;
  } catch (error) {
    reportError(error, '添加订阅失败');
    throw error;
  }
}

export async function updateSubscription(id, payload) {
  try {
    const { subscription } = await api.updateSubscription(id, payload);
    pushToast(`已更新订阅「${subscription.name}」`, { tone: 'success' });
    await Promise.all([refreshStats(), refreshNotifications()]);
    return subscription;
  } catch (error) {
    reportError(error, '更新订阅失败');
    throw error;
  }
}

/**
 * Manual renewal: the end date jumps to the next cycle. Handy when the payment
 * already went through but the panel still shows the old due date.
 */
export async function renewSubscription(id, name) {
  try {
    const { subscription, previousEndDate } = await api.renewSubscription(id);
    pushToast(
      `${name ? `「${name}」` : '订阅'}已续期至 ${subscription.endDate}` +
        (previousEndDate ? `（原 ${previousEndDate}）` : '') +
        '，已记入本月账单',
      { tone: 'success' },
    );
    await Promise.all([refreshStats(), refreshNotifications()]);
    return subscription;
  } catch (error) {
    reportError(error, '续期失败');
    throw error;
  }
}

export async function deleteSubscription(id, name) {
  try {
    await api.deleteSubscription(id);
    pushToast(`已删除订阅${name ? `「${name}」` : ''}`, { tone: 'success' });
    await Promise.all([refreshStats(), refreshNotifications()]);
  } catch (error) {
    reportError(error, '删除订阅失败');
    throw error;
  }
}

export async function saveSettings(payload) {
  try {
    const { settings } = await api.saveSettings(payload);
    state.settings = settings;
    state.publicSettings = {
      showHero: Boolean(settings.showHero),
      appMode: Boolean(settings.appMode),
      reminderDays: settings.reminderDays,
      currency: settings.currency,
    };
    publicConfigLoaded = true;
    pushToast('设置已保存', { tone: 'success' });
    await Promise.all([refreshStats(), refreshNotifications()]);
    return state.settings;
  } catch (error) {
    reportError(error, '保存设置失败');
    throw error;
  }
}

export async function saveChannelSettings(patch) {
  try {
    const { settings } = await api.saveSettings(patch);
    state.settings = settings;
    return settings;
  } catch (error) {
    reportError(error, '保存渠道配置失败');
    throw error;
  }
}

/* ------------------------------------------------------------ browser push */

/** Reads the VAPID key, the device count and this browser's own subscription. */
export async function refreshPushStatus() {
  const supported = pushSupported();
  const subscribed = Boolean(await currentSubscription());
  let devices = state.push.devices;
  let publicKey = state.push.publicKey;
  try {
    const payload = await api.pushKey();
    publicKey = payload.publicKey ?? '';
    devices = payload.devices ?? 0;
  } catch {
    /* offline or signed out — keep whatever we already knew */
  }
  state.push = { ready: true, supported, subscribed, devices, publicKey };
  return state.push;
}

/** Turns on this device: permission + service worker + server-side registration. */
export async function enableBrowserPush() {
  // Push always needs the service worker, even with app mode switched off.
  await registerServiceWorker();
  if (!state.push.publicKey) await refreshPushStatus();

  const { subscription, replacedEndpoint } = await subscribeBrowser(state.push.publicKey);
  if (replacedEndpoint) {
    try {
      await api.unsubscribePush(replacedEndpoint);
    } catch {
      /* the server prunes dead endpoints on the next push as well */
    }
  }
  const payload = subscription.toJSON ? subscription.toJSON() : subscription;
  await api.subscribePush({
    endpoint: payload.endpoint,
    keys: payload.keys,
    userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
  });
  await refreshPushStatus();
  pushToast('已在此设备开启浏览器推送', { tone: 'success' });
  return state.push;
}

/** Turns this device off; other devices keep their subscriptions. */
export async function disableBrowserPush() {
  const endpoint = await unsubscribeBrowser();
  if (endpoint) await api.unsubscribePush(endpoint);
  await refreshPushStatus();
  pushToast('已关闭此设备的浏览器推送');
  return state.push;
}

export async function testChannel(id) {
  const { result } = await api.testChannel(id);
  return result;
}

export async function markAllRead() {
  try {
    const result = await api.markNotificationsRead([]);
    state.unread = result.unread ?? 0;
    state.notifications = state.notifications.map((item) => ({
      ...item,
      readAt: item.readAt ?? new Date().toISOString(),
    }));
  } catch (error) {
    reportError(error, '标记已读失败');
  }
}

export async function runReminders() {
  try {
    const { result } = await api.runReminders();
    pushToast(
      result.created > 0 ? `扫描完成，新增 ${result.created} 条提醒` : '扫描完成，没有新的到期提醒',
      { tone: result.created > 0 ? 'warning' : 'success' },
    );
    await refreshNotifications();
    return result;
  } catch (error) {
    reportError(error, '执行提醒扫描失败');
    throw error;
  }
}

/* ------------------------------------------------------------------- exports */

export const store = readonly(state);

export const subscriptionCount = computed(() => state.subscriptions.length);

export const budgetState = computed(() => {
  const stats = state.stats;
  if (!stats) return { monthly: 0, remaining: 0, usedRatio: 0, overBudget: false };
  return stats.budget;
});

export { state, reportError };
