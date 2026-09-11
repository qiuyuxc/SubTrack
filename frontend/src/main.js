import { createApp, watch } from 'vue';
import App from './App.vue';
import { createAppRouter } from './router.js';
import { ensureSession, initTheme, loadBootstrap, registerAuthHandlers, state } from './store.js';
import { registerServiceWorker } from './lib/pwa.js';
import './styles/tokens.css';
import './styles/base.css';

const router = createAppRouter();

initTheme();

registerAuthHandlers({
  onExpired: () => {
    if (router.currentRoute.value.name !== 'login') router.replace('/login');
  },
});

const app = createApp(App);
app.use(router);
app.mount('#app');

// The router guard resolves the session for navigation; this covers a direct
// landing on /login with a still-valid token, and warms the cache otherwise.
router.isReady().then(async () => {
  if (await ensureSession()) loadBootstrap({ silent: true });
});

// The service worker is what makes the app installable and push-capable. It
// comes up with app mode, and also whenever the push channel is on — push needs
// a worker even on the plain web layout.
watch(
  () => [
    Boolean(state.settings.appMode || state.publicSettings?.appMode),
    Boolean(state.settings.channelPushEnabled),
  ],
  ([appMode, pushEnabled]) => {
    if (appMode || pushEnabled) registerServiceWorker();
  },
  { immediate: true },
);
