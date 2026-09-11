<script setup>
import { computed } from 'vue';
import { store } from '../store.js';

const reminderDays = computed(
  () => store.publicSettings?.reminderDays ?? store.settings.reminderDays ?? 7,
);
</script>

<template>
  <footer class="footer">
    <div class="container footer__inner">
      <div class="stack gap-xxs">
        <p class="body-sm strong">SubTrack · 订阅管理</p>
        <p class="caption">
          Cloudflare Workers + D1 · 到期前 {{ reminderDays }} 天自动提醒
        </p>
      </div>
      <p class="caption mono">
        {{ store.settings.timezone }} · {{ store.settings.currency }}
      </p>
    </div>
  </footer>
</template>

<style scoped>
.footer {
  margin-top: var(--sp-5xl);
  border-top: 1px solid var(--hairline);
}

.footer__inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-md);
  padding-block: var(--sp-xl);
}

@media (max-width: 600px) {
  .footer__inner {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
