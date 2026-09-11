<script setup>
import { computed, ref, watch } from 'vue';
import BaseModal from './BaseModal.vue';
import StatusBadge from './StatusBadge.vue';
import { api } from '../api.js';
import { cycleLabel, formatMoney } from '../lib/format.js';
import { formatDateLong } from '../lib/date.js';

const props = defineProps({
  open: { type: Boolean, default: false },
  month: { type: String, default: '' },
  label: { type: String, default: '' },
});

defineEmits(['close']);

const bill = ref(null);
const loading = ref(false);
const error = ref('');

const currency = computed(() => bill.value?.currency ?? 'CNY');

/** Group the charges by day so the sheet reads like a bank statement. */
const days = computed(() => {
  const groups = new Map();
  for (const item of bill.value?.items ?? []) {
    const bucket = groups.get(item.chargeDate) ?? [];
    bucket.push(item);
    groups.set(item.chargeDate, bucket);
  }
  return [...groups.entries()].map(([date, items]) => ({
    date,
    items,
    // displayAmount is the charge converted onto the bill currency by the Worker.
    subtotal: items.reduce((sum, item) => sum + (item.displayAmount ?? item.amount), 0),
  }));
});

const share = (amount) => (bill.value?.total ? Math.round((amount / bill.value.total) * 100) : 0);

watch(
  () => [props.open, props.month],
  async ([open, month]) => {
    if (!open || !month) return;
    loading.value = true;
    error.value = '';
    bill.value = null;
    try {
      const payload = await api.getBill(month);
      bill.value = payload.bill;
    } catch (problem) {
      error.value = problem?.message ?? '账单加载失败';
    } finally {
      loading.value = false;
    }
  },
  { immediate: true },
);
</script>

<template>
  <BaseModal
    :open="open"
    :title="`${label || bill?.label || ''}账单`"
    description="按扣费日排列的当月明细，金额与订阅列表一致。"
    width="620px"
    @close="$emit('close')"
  >
    <div v-if="loading" class="bill-loading">
      <span class="spinner" aria-hidden="true" />
      <p class="body-sm">正在读取账单…</p>
    </div>

    <p v-else-if="error" class="field-error">{{ error }}</p>

    <div v-else-if="bill" class="bill">
      <div class="bill__hero">
        <div class="stack gap-xxs">
          <p class="caption">本月合计</p>
          <p class="display-md tabular">{{ formatMoney(bill.total, currency) }}</p>
          <p class="caption">{{ bill.count }} 笔扣费 · {{ bill.label }}</p>
        </div>
        <span v-if="bill.current" class="badge badge--success">本月</span>
      </div>

      <section v-if="bill.byCategory.length" class="breakdown">
        <p class="eyebrow">分类占比</p>
        <ul class="breakdown__list">
          <li v-for="entry in bill.byCategory" :key="entry.category" class="breakdown__row">
            <span class="body-sm truncate">{{ entry.category }}</span>
            <span class="caption tabular">{{ share(entry.amount) }}%</span>
            <span class="body-sm strong tabular">{{ formatMoney(entry.amount, currency) }}</span>
            <span class="breakdown__bar">
              <span class="breakdown__fill" :style="{ width: `${share(entry.amount)}%` }" />
            </span>
          </li>
        </ul>
      </section>

      <section class="charges">
        <p class="eyebrow">扣费明细</p>
        <ul v-if="days.length" class="charges__list">
          <li v-for="day in days" :key="day.date" class="charge-day">
            <div class="charge-day__head">
              <span class="caption mono">{{ formatDateLong(day.date) }}</span>
              <span class="caption tabular">{{ formatMoney(day.subtotal, currency) }}</span>
            </div>
            <ul class="charge-day__items">
              <li v-for="item in day.items" :key="`${item.chargeDate}-${item.id}`" class="charge">
                <span class="charge__main">
                  <span class="body-sm strong truncate">{{ item.name }}</span>
                  <span class="caption truncate">
                    {{ item.vendor || '—' }} · {{ item.category }} · {{ cycleLabel(item.cycle) }}
                  </span>
                  <span v-if="item.scheduledDate && item.scheduledDate !== item.chargeDate" class="caption muted">
                    提前续费 · 原定 {{ formatDateLong(item.scheduledDate) }}
                  </span>
                </span>
                <span class="charge__meta">
                  <span class="body-sm strong tabular">{{ formatMoney(item.amount, item.currency) }}</span>
                  <span v-if="item.currency !== currency && item.displayAmount != null" class="caption muted tabular">
                    ≈ {{ formatMoney(item.displayAmount, currency) }}
                  </span>
                  <span class="charge__flags">
                    <StatusBadge :item="item" />
                    <span v-if="item.autoRenew" class="caption">自动续费</span>
                  </span>
                </span>
              </li>
            </ul>
          </li>
        </ul>
        <p v-else class="body-sm muted">这个月没有产生扣费。</p>
      </section>
    </div>

    <template #footer>
      <span class="spacer" />
      <button type="button" class="btn btn--secondary btn--sm" @click="$emit('close')">关闭</button>
    </template>
  </BaseModal>
</template>

<style scoped>
.bill-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--sp-sm);
  padding: var(--sp-2xl);
  color: var(--mute);
}

.bill {
  display: flex;
  flex-direction: column;
  gap: var(--sp-lg);
}

.bill__hero {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--sp-md);
  padding: var(--sp-md);
  border: 1px solid var(--hairline);
  border-radius: var(--r-md);
  background: var(--canvas-soft);
}

.breakdown__list {
  display: flex;
  flex-direction: column;
  gap: var(--sp-xs);
  margin: var(--sp-xs) 0 0;
  padding: 0;
  list-style: none;
}

.breakdown__row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: var(--sp-xs) var(--sp-sm);
  align-items: center;
}

.breakdown__bar {
  grid-column: 1 / -1;
  height: 4px;
  border-radius: var(--r-full);
  background: var(--canvas-soft-2);
  overflow: hidden;
}

.breakdown__fill {
  display: block;
  height: 100%;
  border-radius: var(--r-full);
  background: var(--ink);
}

.charges__list {
  display: flex;
  flex-direction: column;
  gap: var(--sp-sm);
  margin: var(--sp-xs) 0 0;
  padding: 0;
  list-style: none;
}

.charge-day {
  border: 1px solid var(--hairline);
  border-radius: var(--r-md);
  overflow: hidden;
}

.charge-day__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-sm);
  padding: var(--sp-xs) var(--sp-sm);
  background: var(--canvas-soft);
}

.charge-day__items {
  margin: 0;
  padding: 0;
  list-style: none;
}

.charge {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-sm);
  padding: var(--sp-sm);
  border-top: 1px solid var(--hairline);
}

.charge-day__items .charge:first-child {
  border-top: none;
}

.charge__main {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.charge__meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  flex: none;
}

.charge__flags {
  display: flex;
  align-items: center;
  gap: var(--sp-xxs);
}
</style>
