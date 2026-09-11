<script setup>
import { onBeforeUnmount, onMounted, ref, watch, nextTick } from 'vue';

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '' },
  description: { type: String, default: '' },
  width: { type: String, default: '560px' },
});

const emit = defineEmits(['close']);
const panel = ref(null);

function onKeydown(event) {
  if (event.key === 'Escape') emit('close');
}

function lockScroll(locked) {
  document.body.style.overflow = locked ? 'hidden' : '';
}

watch(
  () => props.open,
  async (open) => {
    lockScroll(open);
    if (open) {
      await nextTick();
      panel.value?.querySelector('input, select, textarea, button')?.focus();
    }
  },
);

onMounted(() => document.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown);
  lockScroll(false);
});
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="open" class="overlay" @mousedown.self="emit('close')">
        <div
          ref="panel"
          class="modal"
          role="dialog"
          aria-modal="true"
          :aria-label="title"
          :style="{ '--modal-width': width }"
        >
          <header class="modal__head">
            <div class="stack gap-xxs">
              <h2 class="display-sm">{{ title }}</h2>
              <p v-if="description" class="body-sm">{{ description }}</p>
            </div>
            <button type="button" class="icon-btn" aria-label="关闭" @click="emit('close')">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </header>

          <div class="modal__body">
            <slot />
          </div>

          <footer v-if="$slots.footer" class="modal__foot">
            <slot name="footer" />
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: var(--sp-4xl) var(--sp-md) var(--sp-lg);
  overflow-y: auto;
  background: var(--canvas-overlay);
  backdrop-filter: blur(4px);
}

.modal {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: var(--modal-width);
  max-height: calc(100vh - var(--sp-4xl) - var(--sp-lg));
  max-height: calc(100dvh - var(--sp-4xl) - var(--sp-lg));
  border: 1px solid var(--hairline);
  border-radius: var(--r-lg);
  background: var(--canvas);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.modal__head {
  flex: none;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--sp-md);
  padding: var(--sp-lg);
  border-bottom: 1px solid var(--hairline);
  background: var(--canvas);
}

.modal__body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: var(--sp-lg);
}

.modal__foot {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--sp-xs);
  padding: var(--sp-md) var(--sp-lg);
  border-top: 1px solid var(--hairline);
  background: var(--canvas-soft);
}

/* Phones: tighter sheet padding and a footer that can wrap. */
@media (max-width: 640px) {
  .modal__head,
  .modal__body {
    padding: var(--sp-md);
  }

  /* Give the sheet a little more breathing room under mobile browser chrome
     so the close button is never clipped by the URL bar. */
  .modal__head {
    padding-top: calc(var(--sp-md) + 6px);
  }

  .modal__head .icon-btn {
    flex: none;
    width: 44px;
    height: 44px;
    margin: -6px -8px -8px 0;
    border-radius: var(--r-full);
    background: var(--canvas-soft-2);
  }

  .modal__head .icon-btn svg {
    width: 18px;
    height: 18px;
  }

  .modal__foot {
    flex-wrap: wrap;
    padding: var(--sp-sm) var(--sp-md);
  }
}

.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s var(--ease);
}

.modal-enter-active .modal,
.modal-leave-active .modal {
  transition: transform 0.2s var(--ease), opacity 0.2s var(--ease);
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from .modal,
.modal-leave-to .modal {
  opacity: 0;
  transform: translateY(-8px) scale(0.98);
}

@media (max-width: 600px) {
  .overlay {
    padding: calc(var(--sp-md) + env(safe-area-inset-top, 0px)) 0 0;
    align-items: flex-end;
  }

  .modal {
    max-width: none;
    max-height: 92vh;
    max-height: 92dvh;
    border-radius: var(--r-lg) var(--r-lg) 0 0;
  }
}
</style>
