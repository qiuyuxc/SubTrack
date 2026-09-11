<script setup>
import { computed } from 'vue';
import { formatMoney } from '../lib/format.js';
import { monthLabel } from '../lib/date.js';

const props = defineProps({
  timeline: { type: Array, required: true },
  currency: { type: String, default: 'CNY' },
  currentMonth: { type: String, default: '' },
});

const peak = computed(() => Math.max(...props.timeline.map((point) => point.amount), 1));
</script>

<template>
  <div class="chart">
    <div class="chart__grid" aria-hidden="true">
      <span v-for="line in 4" :key="line" class="chart__line" />
    </div>
    <ul class="chart__bars">
      <li v-for="point in timeline" :key="point.month" class="chart__bar">
        <span class="chart__value caption tabular">{{ formatMoney(point.amount, currency, { compact: true }) }}</span>
        <span
          class="chart__fill"
          :class="{ 'chart__fill--current': point.month === currentMonth }"
          :style="{ height: `${Math.max((point.amount / peak) * 100, point.amount > 0 ? 4 : 0)}%` }"
          :title="`${point.month} · ${formatMoney(point.amount, currency)}`"
        />
        <span class="chart__label caption">{{ monthLabel(point.month) }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.chart {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 200px;
  padding-top: var(--sp-md);
}

.chart__grid {
  position: absolute;
  inset: var(--sp-md) 0 var(--sp-lg);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.chart__line {
  height: 1px;
  background: var(--hairline);
}

.chart__bars {
  position: relative;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--sp-sm);
  flex: 1;
  margin: 0;
  padding: 0;
  list-style: none;
}

.chart__bar {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: center;
  gap: 6px;
  flex: 1;
  height: 100%;
}

.chart__value {
  color: var(--mute);
  white-space: nowrap;
}

.chart__fill {
  width: 100%;
  max-width: 56px;
  min-height: 2px;
  border-radius: var(--r-xs) var(--r-xs) 0 0;
  background: var(--hairline-strong);
  transition: height 0.5s var(--ease), background 0.2s var(--ease);
}

.chart__fill--current {
  background: var(--ink);
}

.chart__bar:hover .chart__fill {
  background: var(--ink);
}

.chart__label {
  height: 16px;
  color: var(--mute);
}

.chart__bar:hover .chart__label {
  color: var(--ink);
}
</style>
