<script setup>
import { formatMoney } from '../lib/format.js';
import { countdownLabel, formatDateLong, urgencyOf } from '../lib/date.js';

defineProps({
  items: { type: Array, required: true },
  compact: { type: Boolean, default: false },
});

const emit = defineEmits(['edit', 'renew']);
</script>

<template>
  <ul class="upcoming">
    <li
      v-for="item in items"
      :key="item.id"
      class="upcoming__row"
      :class="`upcoming__row--${urgencyOf(item.daysLeft)}`"
      :tabindex="compact ? -1 : 0"
      @click="emit('edit', item)"
      @keydown.enter="emit('edit', item)"
    >
      <span class="upcoming__rail" aria-hidden="true" />
      <div class="upcoming__main">
        <span class="body-sm strong truncate">{{ item.name }}</span>
        <span class="caption truncate">
          {{ countdownLabel(item.daysLeft) }} · {{ formatDateLong(item.endDate) }}
        </span>
      </div>
      <div class="upcoming__meta">
        <span class="body-sm strong tabular">{{ formatMoney(item.amount, item.currency) }}</span>
        <span class="caption">到期金额</span>
      </div>
      <button
        type="button"
        class="icon-btn icon-btn--sm upcoming__renew"
        aria-label="续期"
        title="按周期顺延到期时间"
        @click.stop="emit('renew', item)"
      >
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20.5 12a8.5 8.5 0 1 1-2.8-6.3" /><path d="M20.5 3.5v4.2h-4.2" />
        </svg>
      </button>
    </li>
  </ul>
</template>

<style scoped>
.upcoming {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}

.upcoming__row {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--sp-md);
  padding: var(--sp-sm) var(--sp-lg) var(--sp-sm) calc(var(--sp-lg) + 6px);
  border-bottom: 1px solid var(--hairline);
  cursor: pointer;
  transition: background 0.12s var(--ease);
}

.upcoming__row:last-child {
  border-bottom: none;
}

.upcoming__row:hover {
  background: var(--canvas-soft);
}

.upcoming__rail {
  position: absolute;
  left: var(--sp-md);
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 24px;
  border-radius: var(--r-full);
  background: var(--hairline-strong);
}

.upcoming__row--warning .upcoming__rail { background: var(--warning); }
.upcoming__row--critical .upcoming__rail { background: var(--error); }
.upcoming__row--expired .upcoming__rail { background: var(--mute); }

.upcoming__main {
  display: flex;
  flex-direction: column;
  gap: 1px;
  flex: 1;
  min-width: 0;
}

.upcoming__meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 1px;
  flex: none;
}

.upcoming__renew {
  flex: none;
  color: var(--mute);
}

.upcoming__renew:hover {
  color: var(--ink);
}

.upcoming__row--warning .upcoming__main .caption { color: var(--warning-deep); }
.upcoming__row--critical .upcoming__main .caption { color: var(--error); }
</style>
