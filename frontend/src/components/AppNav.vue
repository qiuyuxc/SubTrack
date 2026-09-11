<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { state, store, toggleTheme } from '../store.js';
import { useAppShell } from '../lib/appShell.js';
import { openSubscriptionDialog } from '../lib/dialog.js';
import UserMenu from './UserMenu.vue';

const route = useRoute();
const menuOpen = ref(false);

const links = computed(() => [
  { to: '/dashboard', label: '概览' },
  { to: '/bills', label: '账单' },
  { to: '/subscriptions', label: '订阅' },
  { to: '/reminders', label: '提醒' },
  { to: '/settings', label: '设置' },
]);

/** Anonymous visitors only see the landing page chrome. */
const authed = computed(() => state.auth.authenticated);
const unread = computed(() => store.unread);

// Native-app style title bar: the landing page shows the brand, every other
// page shows that page's own name.
const isLanding = computed(() => route.name === 'home');
const pageTitle = computed(() => route.meta.title ?? 'SubTrack');

// In the app shell the tab bar owns navigation, so the bar keeps only the
// title and the quick actions.
const shell = useAppShell();
const budgetWarn = computed(() => Boolean(store.stats?.budget?.overBudget));

watch(() => route.fullPath, () => { menuOpen.value = false; });

// The bar thins out once the page scrolls, so long lists keep more vertical room.
const scrolled = ref(false);
function onScroll() {
  scrolled.value = (globalThis.scrollY ?? 0) > 8;
}
onMounted(() => {
  onScroll();
  globalThis.addEventListener?.('scroll', onScroll, { passive: true });
});
onBeforeUnmount(() => globalThis.removeEventListener?.('scroll', onScroll));
</script>

<template>
  <header class="nav" :class="{ 'nav--scrolled': scrolled }">
    <div class="container nav__inner">
      <RouterLink to="/" class="brand" aria-label="SubTrack 首页">
        <!-- Brand mark: landing page only. The app bar names the app itself,
             because the tab bar already tells you which section you are in. -->
        <span v-if="isLanding" class="brand__mark" aria-hidden="true">
          <svg viewBox="0 0 32 32" width="28" height="28">
            <rect width="32" height="32" rx="7" fill="var(--primary)" />
            <path d="M10 12h12M10 16h8M10 20h12" stroke="var(--on-primary)" stroke-width="2.4" stroke-linecap="round" />
          </svg>
        </span>
        <span class="brand__text">
          <template v-if="isLanding">
            <span class="brand__name">SubTrack</span>
            <span class="brand__sub">订阅管理</span>
          </template>
          <span v-else class="brand__name brand__name--page">{{ pageTitle }}</span>
        </span>
      </RouterLink>

      <nav v-if="authed && !shell" class="nav__links" aria-label="主导航">
        <RouterLink v-for="link in links" :key="link.to" :to="link.to" class="nav__link">
          {{ link.label }}
          <span v-if="link.to === '/reminders' && unread" class="nav__count mono">{{ unread }}</span>
        </RouterLink>
      </nav>

      <div class="nav__actions">
        <button
          type="button"
          class="icon-btn"
          :aria-label="store.theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'"
          @click="toggleTheme"
        >
          <svg v-if="store.theme === 'dark'" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </svg>
          <svg v-else viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />
          </svg>
        </button>

        <RouterLink
          v-if="authed"
          to="/reminders"
          class="icon-btn nav__bell"
          :aria-label="unread ? `${unread} 条未读提醒` : '提醒'"
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 8a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7" />
            <path d="M10.5 20a2 2 0 0 0 3 0" />
          </svg>
          <span v-if="unread" class="nav__dot" />
        </RouterLink>

        <button v-if="authed && !shell" type="button" class="btn btn--primary btn--sm btn--pill nav__cta" @click="openSubscriptionDialog()">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          添加订阅
        </button>

        <UserMenu v-if="authed" />

        <RouterLink v-else to="/login" class="btn btn--primary btn--sm btn--pill">登录</RouterLink>

        <button
          v-if="authed && !shell"
          type="button"
          class="icon-btn nav__burger"
          :aria-expanded="menuOpen"
          aria-label="打开菜单"
          @click="menuOpen = !menuOpen"
        >
          <svg v-if="!menuOpen" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
          <svg v-else viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>
    </div>

    <Transition name="drawer">
      <div v-if="authed && !shell && menuOpen" class="nav__drawer">
        <RouterLink v-for="link in links" :key="link.to" :to="link.to" class="nav__drawer-link">
          <span>{{ link.label }}</span>
          <span v-if="link.to === '/reminders' && unread" class="badge badge--warning">{{ unread }} 条未读</span>
        </RouterLink>
        <button type="button" class="btn btn--primary btn--pill" @click="openSubscriptionDialog(); menuOpen = false">
          添加订阅
        </button>
      </div>
    </Transition>

    <div v-if="authed && budgetWarn" class="nav__alert">
      <div class="container nav__alert-inner">
        <span class="badge badge--error">超支</span>
        <p class="body-sm">
          本月订阅支出已超出预算 — 前往
          <RouterLink to="/settings" class="link">设置</RouterLink>
          调整月度预算。
        </p>
      </div>
    </div>
  </header>
</template>

<style scoped>
.nav {
  position: sticky;
  top: 0;
  z-index: 40;
  background: color-mix(in srgb, var(--canvas) 88%, transparent);
  backdrop-filter: saturate(180%) blur(12px);
  border-bottom: 1px solid var(--hairline);
}

.nav__inner {
  display: flex;
  align-items: center;
  gap: var(--sp-lg);
  height: 64px;
  transition: height 0.18s var(--ease);
}

.nav--scrolled .nav__inner {
  height: 52px;
}

.brand {
  display: flex;
  align-items: center;
  gap: var(--sp-xs);
  flex: none;
}

.brand__mark {
  display: grid;
  place-items: center;
  line-height: 0;
}

.brand__text {
  display: flex;
  flex-direction: column;
  line-height: 1.1;
}

.brand__name {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.4px;
}

.brand__sub {
  color: var(--mute);
  font-size: 11px;
}

.brand__name--page {
  font-size: 16px;
  letter-spacing: -0.32px;
}

.nav__links {
  display: flex;
  align-items: center;
  gap: var(--sp-xxs);
}

.nav__link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 var(--sp-sm);
  border-radius: var(--r-full);
  color: var(--body);
  font-size: 14px;
  font-weight: 500;
  letter-spacing: -0.28px;
  transition: color 0.15s var(--ease), background 0.15s var(--ease);
}

.nav__link:hover {
  color: var(--ink);
  background: var(--canvas-soft-2);
}

.nav__link.router-link-exact-active {
  color: var(--ink);
  background: var(--canvas-soft-2);
}

.nav__count {
  display: inline-grid;
  place-items: center;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: var(--r-full);
  background: var(--error);
  color: #fff;
  font-size: 10px;
}

.nav__actions {
  display: flex;
  align-items: center;
  gap: var(--sp-xs);
  margin-left: auto;
}

.nav__bell {
  position: relative;
}

.nav__dot {
  position: absolute;
  top: -1px;
  right: -1px;
  width: 7px;
  height: 7px;
  border-radius: var(--r-full);
  background: var(--error);
  box-shadow: 0 0 0 2px var(--canvas);
}

.nav__burger {
  display: none;
}

.nav__drawer {
  display: none;
}

.nav__alert {
  border-top: 1px solid var(--hairline);
  background: var(--canvas-soft);
}

.nav__alert-inner {
  display: flex;
  align-items: center;
  gap: var(--sp-sm);
  padding-block: var(--sp-xs);
}

.link {
  color: var(--link);
  text-decoration: underline;
  text-underline-offset: 2px;
}

@media (max-width: 860px) {
  .nav__links {
    display: none;
  }

  .nav__burger {
    display: inline-flex;
  }

  .nav__cta {
    display: none;
  }

  .nav__drawer {
    display: flex;
    flex-direction: column;
    gap: var(--sp-xs);
    padding: var(--sp-md) var(--sp-lg) var(--sp-lg);
    border-top: 1px solid var(--hairline);
    background: var(--canvas);
  }

  .nav__drawer-link {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--sp-sm) 0;
    border-bottom: 1px solid var(--hairline);
    font-size: 15px;
    font-weight: 500;
  }

  .drawer-enter-active,
  .drawer-leave-active {
    transition: opacity 0.18s var(--ease), transform 0.18s var(--ease);
  }

  .drawer-enter-from,
  .drawer-leave-to {
    opacity: 0;
    transform: translateY(-6px);
  }
}
</style>
