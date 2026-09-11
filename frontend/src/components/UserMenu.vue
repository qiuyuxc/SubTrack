<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { logout, state } from '../store.js';

const router = useRouter();
const root = ref(null);
const open = ref(false);
const busy = ref(false);

const initial = () => (state.auth.username || 'A').slice(0, 1).toUpperCase();

async function signOut() {
  busy.value = true;
  try {
    await logout();
    await router.replace('/login');
  } finally {
    busy.value = false;
    open.value = false;
  }
}

function onPointerDown(event) {
  if (!root.value?.contains(event.target)) open.value = false;
}

function onKeydown(event) {
  if (event.key === 'Escape') open.value = false;
}

onMounted(() => {
  document.addEventListener('pointerdown', onPointerDown);
  document.addEventListener('keydown', onKeydown);
});
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onPointerDown);
  document.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <div ref="root" class="user">
    <button
      type="button"
      class="user__button"
      :aria-expanded="open"
      aria-haspopup="menu"
      :aria-label="`账号 ${state.auth.username}`"
      @click="open = !open"
    >
      <span class="user__avatar" aria-hidden="true">{{ initial() }}</span>
      <span class="user__name truncate">{{ state.auth.username }}</span>
      <svg class="user__chevron" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
        <path d="m6 9 6 6 6-6" />
      </svg>
    </button>

    <Transition name="pop">
      <div v-if="open" class="user__menu" role="menu">
        <div class="user__meta">
          <p class="body-sm strong">{{ state.auth.username }}</p>
          <p class="caption">管理员</p>
        </div>
        <RouterLink to="/settings" class="user__item" role="menuitem" @click="open = false">设置</RouterLink>
        <button type="button" class="user__item user__item--danger" role="menuitem" :disabled="busy" @click="signOut">
          {{ busy ? '退出中…' : '退出登录' }}
        </button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.user {
  position: relative;
}

.user__button {
  display: flex;
  align-items: center;
  gap: var(--sp-xs);
  height: 32px;
  padding: 0 var(--sp-xs) 0 var(--sp-xxs);
  border: 1px solid var(--hairline);
  border-radius: var(--r-full);
  background: var(--canvas);
  color: var(--ink);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: border-color 0.15s var(--ease);
}

.user__button:hover {
  border-color: var(--hairline-strong);
}

.user__avatar {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: var(--r-full);
  background: var(--primary);
  color: var(--on-primary);
  font-size: 11px;
  font-weight: 600;
}

.user__name {
  max-width: 96px;
}

.user__chevron {
  color: var(--mute);
}

.user__menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 50;
  min-width: 180px;
  padding: var(--sp-xxs);
  border: 1px solid var(--hairline);
  border-radius: var(--r-md);
  background: var(--canvas);
  box-shadow: var(--shadow-lg);
}

.user__meta {
  padding: var(--sp-xs) var(--sp-sm) var(--sp-sm);
  border-bottom: 1px solid var(--hairline);
  margin-bottom: var(--sp-xxs);
}

.user__item {
  display: block;
  width: 100%;
  padding: var(--sp-xs) var(--sp-sm);
  border: 0;
  border-radius: var(--r-sm);
  background: none;
  color: var(--body);
  font-size: 14px;
  letter-spacing: -0.28px;
  text-align: left;
  cursor: pointer;
  transition: background 0.12s var(--ease), color 0.12s var(--ease);
}

.user__item:hover {
  background: var(--canvas-soft-2);
  color: var(--ink);
}

.user__item--danger:hover {
  background: var(--error-soft);
  color: var(--error-deep);
}

.pop-enter-active,
.pop-leave-active {
  transition: opacity 0.14s var(--ease), transform 0.14s var(--ease);
}

.pop-enter-from,
.pop-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

@media (max-width: 860px) {
  .user__name,
  .user__chevron {
    display: none;
  }

  .user__button {
    padding: 0 var(--sp-xxs) 0 var(--sp-xxs);
    border-color: transparent;
    background: none;
  }
}
</style>
