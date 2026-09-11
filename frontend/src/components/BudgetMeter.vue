<script setup>
import { computed } from 'vue';
import { formatMoney, formatPercent } from '../lib/format.js';

const props = defineProps({
  budget: { type: Object, required: true },
  currency: { type: String, default: 'CNY' },
  spent: { type: Number, default: 0 },
  showLegend: { type: Boolean, default: true },
});

const ratio = computed(() => {
  if (!props.budget.monthly) return 0;
  return Math.min(props.spent / props.budget.monthly, 1);
});

const width = computed(() => `${Math.round(ratio.value * 100)}%`);
const over = computed(() => props.budget.monthly > 0 && props.spent > props.budget.monthly);
</script>

<template>
  <div class="budget">
    <div v-if="showLegend" class="budget__legend">
      <span class="caption">
        已用
        <strong class="strong tabular">{{ formatMoney(spent, currency) }}</strong>
      </span>
      <span class="caption">
        {{ budget.monthly ? formatPercent(over ? 1 : ratio) : '未设置预算' }}
      </span>
    </div>
    <div class="meter" role="progressbar" :aria-valuenow="Math.round((over ? 1 : ratio) * 100)" aria-valuemin="0" aria-valuemax="100">
      <span class="meter__fill" :class="{ 'meter__fill--over': over }" :style="{ width }" />
    </div>
  </div>
</template>

<style scoped>
.budget {
  display: flex;
  flex-direction: column;
  gap: var(--sp-xs);
}

.budget__legend {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--sp-sm);
}

.budget__legend .strong {
  color: var(--ink);
}
</style>
