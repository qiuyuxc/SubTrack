<script setup>
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import MeshGradient from './MeshGradient.vue';
import { store } from '../store.js';
import { openSubscriptionDialog } from '../lib/dialog.js';

const props = defineProps({
  compact: { type: Boolean, default: false },
  /** Signed-out visitor: swap the app actions for a single sign-in CTA. */
  guest: { type: Boolean, default: false },
});

const reminderDays = computed(
  () => store.publicSettings?.reminderDays ?? store.settings.reminderDays ?? 7,
);
</script>

<template>
  <section class="hero" :class="{ 'hero--compact': compact }">
    <MeshGradient v-if="!compact" />
    <div class="container hero__inner">
      <p class="eyebrow">订阅总览 / subscription overview</p>
      <h1 :class="compact ? 'display-lg' : 'display-xl'" class="hero__title">
        {{ compact ? '订阅概览。' : '管好每一笔订阅，不再为忘记续费买单。' }}
      </h1>
      <p v-if="!compact" class="body-lg hero__lead">
        记录订阅金额、开始时间与到期时间，系统会在到期前
        {{ reminderDays }} 天自动提醒你处理续费或停用。
      </p>
      <div class="hero__actions">
        <template v-if="guest">
          <RouterLink to="/login" class="btn btn--primary" :class="compact ? 'btn--sm btn--pill' : 'btn--lg'">
            登录查看订阅
          </RouterLink>
          <RouterLink to="/dashboard" class="btn btn--secondary" :class="compact ? 'btn--sm btn--pill' : 'btn--lg'">
            进入概览
          </RouterLink>
        </template>
        <template v-else>
          <button type="button" class="btn btn--primary" :class="compact ? 'btn--sm btn--pill' : 'btn--lg'" @click="openSubscriptionDialog()">
            添加订阅
          </button>
          <RouterLink
            to="/subscriptions"
            class="btn btn--secondary"
            :class="compact ? 'btn--sm btn--pill' : 'btn--lg'"
          >
            查看全部订阅
          </RouterLink>
        </template>
      </div>
      <p v-if="!guest" class="caption hero__stamp mono">
        {{ store.stats?.today ?? '—' }} · {{ store.settings.timezone }} · 共
        {{ store.stats?.counts.total ?? 0 }} 条订阅
      </p>
    </div>
  </section>
</template>

<style scoped>
.hero {
  position: relative;
  overflow: hidden;
  border-bottom: 1px solid var(--hairline);
  background: var(--canvas);
}

.hero__inner {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-md);
  padding-block: var(--sp-4xl) var(--sp-5xl);
  text-align: center;
}

.hero__title {
  max-width: 18ch;
}

.hero__lead {
  max-width: 54ch;
}

.hero__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--sp-sm);
  margin-top: var(--sp-xs);
}

.hero__stamp {
  margin-top: var(--sp-xxs);
}

/* Compact mode: same identity, no gradient, minimal vertical rhythm. */
.hero--compact .hero__inner {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-lg);
  padding-block: var(--sp-xl);
  text-align: left;
}

.hero--compact .hero__title {
  max-width: none;
}

.hero--compact .hero__actions {
  flex: none;
  margin-top: 0;
}

.hero--compact .hero__stamp {
  margin-top: 0;
}

@media (max-width: 800px) {
  .hero--compact .hero__inner {
    flex-direction: column;
    align-items: flex-start;
  }

  .hero--compact .hero__actions {
    width: 100%;
  }
}

@media (max-width: 640px) {
  .hero__inner {
    padding-block: var(--sp-xl) var(--sp-4xl);
  }
}
</style>
