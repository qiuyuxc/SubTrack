<script setup>
import { RouterLink } from 'vue-router';
import { openSubscriptionDialog } from '../lib/dialog.js';

const ICONS = {
  overview: { paths: ['M4 4h6v7H4zM14 4h6v4h-6zM14 12h6v8h-6zM4 15h6v5H4z'] },
  bills: { paths: ['M6 3h12v18l-3-2-3 2-3-2-3 2z', 'M9 8h6M9 12h6'] },
  subscriptions: { paths: ['M4 7h16M4 12h16M4 17h10'] },
  settings: { paths: ['M4 8h4M12 8h8M4 16h8M16 16h4'], circles: [{ cx: 10, cy: 8, r: 2 }, { cx: 14, cy: 16, r: 2 }] },
};

// 「提醒」 lives behind the bell in the app bar, so the tab bar keeps four
// destinations with the add action raised in the middle.
const LEFT_TABS = [
  { to: '/dashboard', label: '概览', icon: 'overview' },
  { to: '/bills', label: '账单', icon: 'bills' },
];

const RIGHT_TABS = [
  { to: '/subscriptions', label: '订阅', icon: 'subscriptions' },
  { to: '/settings', label: '设置', icon: 'settings' },
];
</script>

<template>
  <nav class="tabbar" aria-label="主导航">
    <RouterLink v-for="tab in LEFT_TABS" :key="tab.to" :to="tab.to" class="tab" active-class="tab--active">
      <span class="tab__icon">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path v-for="d in ICONS[tab.icon].paths" :key="d" :d="d" />
          <circle v-for="c in ICONS[tab.icon].circles ?? []" :key="`${c.cx}-${c.cy}`" :cx="c.cx" :cy="c.cy" :r="c.r" />
        </svg>
      </span>
      <span class="tab__label">{{ tab.label }}</span>
    </RouterLink>

    <button type="button" class="tab tab--add" aria-label="添加订阅" @click="openSubscriptionDialog()">
      <span class="tab__icon">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </span>
    </button>

    <RouterLink v-for="tab in RIGHT_TABS" :key="tab.to" :to="tab.to" class="tab" active-class="tab--active">
      <span class="tab__icon">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path v-for="d in ICONS[tab.icon].paths" :key="d" :d="d" />
          <circle v-for="c in ICONS[tab.icon].circles ?? []" :key="`${c.cx}-${c.cy}`" :cx="c.cx" :cy="c.cy" :r="c.r" />
        </svg>
      </span>
      <span class="tab__label">{{ tab.label }}</span>
    </RouterLink>
  </nav>
</template>

<style scoped>
.tabbar {
  position: fixed;
  inset: auto 0 0 0;
  z-index: 45;
  display: flex;
  align-items: stretch;
  padding-bottom: env(safe-area-inset-bottom, 0px);
  border-top: 1px solid var(--hairline);
  background: color-mix(in srgb, var(--canvas) 92%, transparent);
  backdrop-filter: saturate(180%) blur(16px);
}

.tab {
  flex: 1 1 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  min-height: 56px;
  padding: 6px 2px;
  border: 0;
  background: none;
  color: var(--mute);
  font: inherit;
  cursor: pointer;
  appearance: none;
  -webkit-tap-highlight-color: transparent;
  transition: color 0.15s var(--ease);
}

.tab:active {
  background: var(--canvas-soft-2);
}

.tab__icon {
  position: relative;
  display: grid;
  place-items: center;
  line-height: 0;
}

.tab__label {
  font-size: 10px;
  line-height: 12px;
  letter-spacing: 0;
}

.tab--active {
  color: var(--ink);
}

/* A plus needs no caption, so it is centred in the bar instead of sitting on
   the icon baseline the labelled tabs use. */
.tab--add {
  justify-content: center;
  color: var(--ink);
}

.tab--add .tab__icon {
  margin-top: 2px;
}
</style>
