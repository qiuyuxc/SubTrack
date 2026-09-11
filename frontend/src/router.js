import { createMemoryHistory, createRouter, createWebHistory } from 'vue-router';
import { ensureSession, loadBootstrap, loadPublicConfig, state } from './store.js';

export const routes = [
  {
    path: '/login',
    name: 'login',
    component: () => import('./views/LoginView.vue'),
    meta: { public: true, layout: 'blank', title: '登录' },
  },
  // `/` is the front door: the landing page when it is enabled, otherwise the
  // guard sends visitors to the login screen (or straight to the overview).
  {
    path: '/',
    name: 'home',
    component: () => import('./views/LandingView.vue'),
    meta: { public: true, title: '首页' },
  },
  { path: '/dashboard', name: 'dashboard', component: () => import('./views/DashboardView.vue'), meta: { title: '概览' } },
  { path: '/bills', name: 'bills', component: () => import('./views/BillsView.vue'), meta: { title: '账单' } },
  { path: '/subscriptions', name: 'subscriptions', component: () => import('./views/SubscriptionsView.vue'), meta: { title: '订阅' } },
  { path: '/reminders', name: 'reminders', component: () => import('./views/RemindersView.vue'), meta: { title: '提醒' } },
  { path: '/settings', name: 'settings', component: () => import('./views/SettingsView.vue'), meta: { title: '设置' } },
  { path: '/landing', redirect: '/' },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

export async function guard(to) {
  const authenticated = await ensureSession();

  if (to.name === 'home') {
    const { showHero } = await loadPublicConfig();
    if (showHero) {
      if (authenticated && !state.ready) await loadBootstrap({ silent: true });
      return true;
    }
    // Landing page switched off: the root becomes the way into the app.
    return authenticated ? { name: 'dashboard', replace: true } : { name: 'login', replace: true };
  }

  if (!to.meta.public && !authenticated) {
    return { path: '/login', query: to.name === 'dashboard' ? undefined : { redirect: to.fullPath } };
  }
  if (to.meta.public && authenticated) return { name: 'dashboard' };

  // Load the workspace before the first protected view renders so the
  // dashboard never flashes empty state.
  if (authenticated && !state.ready) await loadBootstrap({ silent: true });

  return true;
}

const inBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';

/**
 * Built per call so tests can inject a memory history over the real routes.
 * Importing this module during SSR falls back to a memory history, which is
 * never used for rendering — the tests build their own router.
 */
export function createAppRouter(history) {
  const router = createRouter({
    history: history ?? (inBrowser ? createWebHistory(import.meta.env.BASE_URL) : createMemoryHistory()),
    routes,
    scrollBehavior: () => ({ top: 0 }),
  });

  router.beforeEach(guard);

  router.afterEach((to) => {
    // `afterEach` also runs during SSR, where there is no document.
    if (typeof document !== 'undefined') {
      document.title = `${to.meta.title ?? 'SubTrack'} · SubTrack`;
    }
  });

  return router;
}
