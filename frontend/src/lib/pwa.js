/** Service-worker plumbing. The push helpers live in `push.js`. */

export function serviceWorkerSupported() {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
}

let registration = null;

/** Registers `/sw.js` once; resolves to null when unsupported or blocked. */
export async function registerServiceWorker() {
  if (!serviceWorkerSupported()) return null;
  if (registration) return registration;
  try {
    registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    return registration;
  } catch {
    return null;
  }
}

export function getServiceWorkerRegistration() {
  return registration;
}

/** True when the app was launched from the home screen / installed window. */
export function isStandaloneDisplay() {
  if (typeof window === 'undefined') return false;
  if (window.navigator?.standalone === true) return true;
  return Boolean(window.matchMedia?.('(display-mode: standalone)')?.matches);
}
