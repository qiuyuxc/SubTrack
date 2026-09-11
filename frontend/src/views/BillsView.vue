<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import BillDetailDialog from '../components/BillDetailDialog.vue';
import EmptyState from '../components/EmptyState.vue';
import { api } from '../api.js';
import { store } from '../store.js';
import { formatMoney } from '../lib/format.js';
import { useAppShell } from '../lib/appShell.js';

const shell = useAppShell();
const loading = ref(true);
const error = ref('');
const data = ref(null);
const selected = ref(null);

const months = computed(() => data.value?.months ?? []);
const summary = computed(() => data.value?.summary ?? null);
const currency = computed(() => data.value?.currency ?? store.settings.currency ?? 'CNY');
const peak = computed(() => Math.max(1, ...months.value.map((entry) => entry.total)));

async function load() {
  loading.value = true;
  error.value = '';
  try {
    data.value = await api.listBills({ months: 12 });
  } catch (problem) {
    error.value = problem?.message ?? '账单加载失败';
  } finally {
    loading.value = false;
  }
}

function open(entry) {
  selected.value = entry;
}

onMounted(load);

// Reload after any mutation so the statement never shows stale amounts.
watch(() => store.revision, load);
</script>

<template>
  <div class="container page">
    <header v-if="!shell" class="page__head">
      <h1 class="display-lg page__title">账单</h1>
      <button type="button" class="btn btn--secondary" :disabled="loading" @click="load">
        {{ loading ? '刷新中…' : '刷新账单' }}
      </button>
    </header>

    <section class="summary" aria-label="账单概览">
      <article class="card card--soft">
        <p class="eyebrow">本月账单</p>
        <p class="display-md tabular">{{ formatMoney(months.find((m) => m.current)?.total ?? 0, currency) }}</p>
        <p class="caption">
          {{ months.find((m) => m.current)?.count ?? 0 }} 笔订阅 ·
          {{ months.find((m) => m.current)?.label ?? '—' }}
        </p>
      </article>
      <article class="card card--soft">
        <p class="eyebrow">近 12 个月合计</p>
        <p class="display-md tabular">{{ formatMoney(summary?.total ?? 0, currency) }}</p>
        <p class="caption">覆盖 {{ summary?.months ?? 0 }} 个自然月</p>
      </article>
      <article class="card card--soft">
        <p class="eyebrow">月均支出</p>
        <p class="display-md tabular">{{ formatMoney(summary?.average ?? 0, currency) }}</p>
        <p class="caption">
          最高 {{ summary?.busiest ? `${summary.busiest.label} · ${formatMoney(summary.busiest.total, currency)}` : '—' }}
        </p>
      </article>
    </section>

    <article class="card card--flush">
      <header class="card__header">
        <div class="stack gap-xxs">
          <h2 class="display-sm">月度账单</h2>
          <p class="caption">按月份倒序，点击查看当月明细</p>
        </div>
        <span v-if="!loading && months.length" class="badge">{{ months.length }} 个月</span>
      </header>

      <div v-if="loading" class="loading">
        <span class="spinner" aria-hidden="true" />
        <p class="body-sm">正在生成账单…</p>
      </div>

      <p v-else-if="error" class="loading field-error">{{ error }}</p>

      <ul v-else-if="months.length" class="months">
        <li v-for="entry in months" :key="entry.month">
          <button type="button" class="month" @click="open(entry)">
            <span class="month__main">
              <span class="month__title">
                <span class="body-sm strong">{{ entry.label }}</span>
                <span v-if="entry.current" class="badge badge--success">本月</span>
                <span v-else-if="!entry.count" class="badge">无扣费</span>
              </span>
              <span class="caption">{{ entry.count }} 笔订阅</span>
            </span>

            <span class="month__cats">
              <span v-for="cat in entry.byCategory.slice(0, 3)" :key="cat.category" class="badge badge--ghost">
                {{ cat.category }}
              </span>
              <span v-if="entry.byCategory.length > 3" class="caption">+{{ entry.byCategory.length - 3 }}</span>
            </span>

            <span class="month__amount">
              <span class="body-md strong tabular">{{ formatMoney(entry.total, currency) }}</span>
              <span class="month__bar">
                <span
                  class="month__fill"
                  :class="{ 'month__fill--current': entry.current }"
                  :style="{ width: `${Math.round((entry.total / peak) * 100)}%` }"
                />
              </span>
            </span>

            <svg class="month__arrow" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="m9 6 6 6-6 6" />
            </svg>
          </button>
        </li>
      </ul>

      <EmptyState
        v-else
        title="还没有账单"
        description="添加订阅后，系统会按自然月自动生成账单。"
      />
    </article>

    <BillDetailDialog
      :open="Boolean(selected)"
      :month="selected?.month ?? ''"
      :label="selected?.label ?? ''"
      @close="selected = null"
    />
  </div>
</template>

<style scoped>
.page {
  padding-block: var(--sp-lg) var(--sp-xl);
}

.page__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-md);
  margin-bottom: var(--sp-lg);
}

.summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--sp-md);
  margin-bottom: var(--sp-md);
}

.loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--sp-sm);
  padding: var(--sp-4xl);
  color: var(--mute);
}

.months {
  margin: 0;
  padding: 0;
  list-style: none;
}

.months > li + li {
  border-top: 1px solid var(--hairline);
}

.month {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 200px) auto;
  align-items: center;
  gap: var(--sp-md);
  width: 100%;
  padding: var(--sp-md) var(--sp-lg);
  border: 0;
  background: none;
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s var(--ease);
}

.month:hover {
  background: var(--canvas-soft);
}

.month__main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.month__title {
  display: flex;
  align-items: center;
  gap: var(--sp-xs);
  flex-wrap: wrap;
}

.month__cats {
  display: flex;
  align-items: center;
  gap: var(--sp-xxs);
  flex-wrap: wrap;
  min-width: 0;
}

.month__amount {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
}

.month__bar {
  display: block;
  width: 100%;
  height: 4px;
  border-radius: var(--r-full);
  background: var(--canvas-soft-2);
  overflow: hidden;
}

.month__fill {
  display: block;
  height: 100%;
  border-radius: var(--r-full);
  background: var(--hairline-strong);
}

.month__fill--current {
  background: var(--ink);
}

.month__arrow {
  flex: none;
  color: var(--mute);
}

@media (max-width: 860px) {
  .summary {
    grid-template-columns: minmax(0, 1fr);
  }

  .month {
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--sp-xs);
  }

  .month__cats {
    grid-column: 1 / -1;
    order: 3;
  }

  .month__amount {
    align-items: flex-end;
  }

  .month__arrow {
    display: none;
  }
}
</style>
