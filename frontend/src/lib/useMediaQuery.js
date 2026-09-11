import { onBeforeUnmount, onMounted, ref } from 'vue';

/**
 * Reactive `matchMedia` wrapper.
 *
 * Stays `false` during SSR and in environments without `matchMedia` (jsdom in
 * the test harness), so the desktop markup is the default render everywhere.
 */
export function useMediaQuery(query) {
  const matches = ref(false);
  let mql = null;
  const update = () => {
    matches.value = Boolean(mql?.matches);
  };

  onMounted(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    mql = window.matchMedia(query);
    update();
    mql.addEventListener?.('change', update);
  });

  onBeforeUnmount(() => {
    mql?.removeEventListener?.('change', update);
    mql = null;
  });

  return matches;
}
