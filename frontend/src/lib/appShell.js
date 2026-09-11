import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { state } from '../store.js';

/** Phone-sized viewports get the app shell instead of the desktop layout. */
export const APP_SHELL_QUERY = '(max-width: 720px)';
/** Set by the browser once the PWA is installed / launched from the home screen. */
export const STANDALONE_QUERY = '(display-mode: standalone)';

function matchMedia(query) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  return window.matchMedia(query);
}

/** True when running installed (Android/desktop PWA or iOS home-screen app). */
export function isStandalone() {
  if (typeof window === 'undefined') return false;
  if (window.navigator?.standalone === true) return true;
  return Boolean(matchMedia(STANDALONE_QUERY)?.matches);
}

/**
 * Whether the mobile-app shell (bottom tab bar + app bar) should be used.
 *
 * Requires the `app_mode` setting, and then only kicks in on phone-sized
 * viewports or when the app runs installed — desktop windows keep the full web
 * layout. Preview it on desktop by narrowing the window.
 */
export function useAppShell() {
  const narrow = ref(false);
  const installed = ref(false);
  let narrowMql = null;
  let installedMql = null;

  const sync = () => {
    narrow.value = Boolean(narrowMql?.matches);
    installed.value = isStandalone();
  };

  onMounted(() => {
    narrowMql = matchMedia(APP_SHELL_QUERY);
    installedMql = matchMedia(STANDALONE_QUERY);
    sync();
    narrowMql?.addEventListener?.('change', sync);
    installedMql?.addEventListener?.('change', sync);
  });

  onBeforeUnmount(() => {
    narrowMql?.removeEventListener?.('change', sync);
    installedMql?.removeEventListener?.('change', sync);
    narrowMql = null;
    installedMql = null;
  });

  // Public config decides before login; full settings win once bootstrapped.
  const enabled = computed(() => {
    const mode = state.ready ? state.settings.appMode : state.publicSettings?.appMode ?? state.settings.appMode;
    return Boolean(mode);
  });

  return computed(() => enabled.value && (narrow.value || installed.value));
}
