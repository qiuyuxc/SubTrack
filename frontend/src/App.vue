<script setup>
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import AppNav from './components/AppNav.vue';
import AppTabBar from './components/AppTabBar.vue';
import AppFooter from './components/AppFooter.vue';
import ToastHost from './components/ToastHost.vue';
import SubscriptionForm from './components/SubscriptionForm.vue';
import { state } from './store.js';
import { useAppShell } from './lib/appShell.js';

const route = useRoute();
const blankLayout = computed(() => route.meta.layout === 'blank');
const booting = computed(() => !blankLayout.value && state.auth.authenticated && !state.ready);
// The footer is marketing chrome: it belongs to the landing page only.
const isLanding = computed(() => route.name === 'home');

// Mobile-app shell: app bar + bottom tab bar, used when the app-mode setting is
// on and we are on a phone-sized viewport or running as an installed PWA.
const shell = useAppShell();
const showFooter = computed(() => isLanding.value && !shell.value);
const showTabBar = computed(() => shell.value && state.auth.authenticated);
</script>

<template>
  <div class="app" :class="{ 'app--shell': shell }">
    <template v-if="!blankLayout">
      <AppNav />

      <div v-if="booting" class="boot">
        <span class="spinner" aria-hidden="true" />
        <p class="body-sm">正在加载订阅数据…</p>
      </div>

      <main v-else class="app__main" :class="{ 'app__main--app': !isLanding }">
        <RouterView v-slot="{ Component }">
          <Transition name="view" mode="out-in">
            <component :is="Component" />
          </Transition>
        </RouterView>
      </main>

      <AppFooter v-if="showFooter" />
      <AppTabBar v-if="showTabBar" />
      <SubscriptionForm />
    </template>

    <RouterView v-else />

    <ToastHost />
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.app__main {
  flex: 1;
  padding-bottom: var(--sp-xl);
}

/* No footer on app pages, so the content needs its own bottom breathing room. */
.app__main--app {
  padding-bottom: var(--sp-4xl);
}

/* The bottom tab bar floats over the content; the spacer must match it. */
.app--shell .app__main,
.app--shell .app__main--app {
  padding-bottom: calc(72px + env(safe-area-inset-bottom, 0px));
}

.app--shell :deep(.nav) {
  padding-top: env(safe-area-inset-top, 0px);
}

.boot {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--sp-sm);
  padding-block: var(--sp-2xl);
  color: var(--mute);
}

.view-enter-active,
.view-leave-active {
  transition: opacity 0.18s var(--ease), transform 0.18s var(--ease);
}

.view-enter-from {
  opacity: 0;
  transform: translateY(4px);
}

.view-leave-to {
  opacity: 0;
}
</style>
