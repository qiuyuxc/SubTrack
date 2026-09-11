<script setup>
import { store, dismissToast } from '../store.js';
</script>

<template>
  <div class="toasts" role="status" aria-live="polite">
    <TransitionGroup name="toast">
      <div v-for="toast in store.toasts" :key="toast.id" class="toast" :class="`toast--${toast.tone}`">
        <span class="toast__icon" aria-hidden="true">
          <svg v-if="toast.tone === 'error'" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" />
          </svg>
          <svg v-else-if="toast.tone === 'warning'" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M12 4l9 16H3z" /><path d="M12 10v4M12 17h.01" />
          </svg>
          <svg v-else viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <circle cx="12" cy="12" r="9" /><path d="m8.5 12.5 2.5 2.5 4.5-5" />
          </svg>
        </span>
        <p class="toast__text">{{ toast.message }}</p>
        <button type="button" class="toast__close" aria-label="关闭提示" @click="dismissToast(toast.id)">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toasts {
  position: fixed;
  right: var(--sp-lg);
  bottom: var(--sp-lg);
  z-index: 90;
  display: flex;
  flex-direction: column;
  gap: var(--sp-xs);
  pointer-events: none;
}

.toast {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-sm);
  width: min(380px, calc(100vw - var(--sp-xl)));
  padding: var(--sp-sm) var(--sp-md);
  border: 1px solid var(--hairline);
  border-radius: var(--r-md);
  background: var(--canvas);
  box-shadow: var(--shadow-lg);
  pointer-events: auto;
}

.toast__icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 20px;
  height: 20px;
  margin-top: 1px;
  color: var(--link);
}

.toast--error .toast__icon { color: var(--error); }
.toast--warning .toast__icon { color: var(--warning); }
.toast--success .toast__icon { color: var(--link); }

.toast__text {
  flex: 1;
  font-size: 14px;
  line-height: 20px;
  letter-spacing: -0.28px;
  color: var(--ink);
}

.toast__close {
  flex: none;
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--mute);
  cursor: pointer;
}

.toast__close:hover { color: var(--ink); }

.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.22s var(--ease), transform 0.22s var(--ease);
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(8px) scale(0.98);
}

@media (max-width: 600px) {
  .toasts {
    right: var(--sp-md);
    left: var(--sp-md);
    bottom: var(--sp-md);
  }

  .toast { width: 100%; }
}
</style>
