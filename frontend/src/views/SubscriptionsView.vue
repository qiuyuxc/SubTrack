<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import SubscriptionTable from '../components/SubscriptionTable.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import EmptyState from '../components/EmptyState.vue';
import AppSelect from '../components/AppSelect.vue';
import { api } from '../api.js';
import { store, deleteSubscription, renewSubscription } from '../store.js';
import { openSubscriptionDialog } from '../lib/dialog.js';
import { useAppShell } from '../lib/appShell.js';
import { formatMoney } from '../lib/format.js';

const FILTERS = [
  { value: 'all', label: '全部' },
  { value: 'active', label: '生效中' },
  { value: 'expiring', label: '即将到期' },
  { value: 'expired', label: '已过期' },
  { value: 'paused', label: '已暂停' },
  { value: 'cancelled', label: '已取消' },
];

const SORTS = [
  { value: 'end-asc', label: '到期时间（近→远）' },
  { value: 'end-desc', label: '到期时间（远→近）' },
  { value: 'amount-desc', label: '金额（高→低）' },
  { value: 'amount-asc', label: '金额（低→高）' },
  { value: 'created-desc', label: '录入时间（新→旧）' },
  { value: 'name-asc', label: '名称 A→Z' },
];

const shell = useAppShell();
const items = ref([]);
const loading = ref(true);
const status = ref('all');
const sort = ref('end-asc');
const search = ref('');
const pendingDelete = ref(null);
const deleting = ref(false);
// Guards against a double click stacking two cycles onto the same subscription.
let renewing = false;
const loadError = ref(null);

let debounce = null;

const total = computed(() => items.value.reduce((sum, item) => sum + item.amount, 0));
const monthlyTotal = computed(() =>
  items.value.reduce((sum, item) => sum + (item.monthlyEquivalent ?? 0), 0),
);

async function load() {
  loading.value = true;
  loadError.value = null;
  try {
    const data = await api.listSubscriptions({
      status: status.value,
      q: search.value.trim(),
      sort: sort.value,
    });
    items.value = data.items;
  } catch (error) {
    loadError.value = error?.message ?? '加载失败';
    items.value = [];
  } finally {
    loading.value = false;
  }
}

watch([status, sort, () => store.revision], load);
watch(search, () => {
  clearTimeout(debounce);
  debounce = setTimeout(load, 250);
});

async function renew(item) {
  if (renewing) return;
  renewing = true;
  try {
    await renewSubscription(item.id, item.name);
  } catch {
    /* the store already surfaced the reason */
  } finally {
    renewing = false;
  }
}

async function confirmDelete() {
  if (!pendingDelete.value) return;
  deleting.value = true;
  try {
    await deleteSubscription(pendingDelete.value.id, pendingDelete.value.name);
    pendingDelete.value = null;
  } finally {
    deleting.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="container page">
    <header class="page__head">
      <div class="page__heading">
        <h1 v-if="!shell" class="display-lg page__title">订阅列表</h1>
        <p class="caption">
          {{ items.length }} 条记录 · 合计
          <strong class="strong tabular">{{ formatMoney(total, store.settings.currency) }}</strong>
          · 折算每月
          <strong class="strong tabular">{{ formatMoney(monthlyTotal, store.settings.currency) }}</strong>
        </p>
      </div>
      <button v-if="!shell" type="button" class="btn btn--primary" @click="openSubscriptionDialog()">添加订阅</button>
    </header>

    <div class="toolbar">
      <div class="tabs" role="tablist" aria-label="状态筛选">
        <button
          v-for="filter in FILTERS"
          :key="filter.value"
          type="button"
          role="tab"
          class="tab"
          :class="{ 'tab--active': status === filter.value }"
          :aria-selected="status === filter.value"
          @click="status = filter.value"
        >
          {{ filter.label }}
        </button>
      </div>

      <div class="toolbar__tools">
        <label class="search">
          <span class="sr-only">搜索订阅</span>
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
          </svg>
          <input v-model="search" class="search__input" type="search" placeholder="搜索名称 / 服务商 / 分类" />
        </label>
        <AppSelect v-model="sort" class="sort" :options="SORTS" size="sm" aria-label="排序方式" :block="false" />
      </div>
    </div>

    <article class="card card--flush">
      <div v-if="loading" class="loading">
        <span class="spinner" aria-hidden="true" />
        <span class="body-sm">加载中…</span>
      </div>

      <EmptyState
        v-else-if="loadError"
        title="无法加载订阅"
        :description="loadError"
        action-label="重试"
        @action="load"
      />

      <SubscriptionTable
        v-else-if="items.length"
        :items="items"
        @edit="openSubscriptionDialog"
        @delete="pendingDelete = $event"
        @renew="renew"
      />

      <EmptyState
        v-else
        :title="search ? '没有匹配的订阅' : '这里还没有订阅'"
        :description="search
          ? `没有找到与「${search}」相关的订阅，换个关键词试试。`
          : '添加第一条订阅，开始追踪金额与到期时间。'"
        :action-label="search || shell ? '' : '添加订阅'"
        @action="openSubscriptionDialog()"
      />
    </article>

    <ConfirmDialog
      :open="Boolean(pendingDelete)"
      title="删除这条订阅？"
      :description="`将永久删除「${pendingDelete?.name ?? ''}」及其提醒记录，此操作不可撤销。`"
      confirm-label="确认删除"
      :busy="deleting"
      @close="pendingDelete = null"
      @confirm="confirmDelete"
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
  gap: var(--sp-lg);
  margin-bottom: var(--sp-lg);
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-md);
  flex-wrap: wrap;
  margin-bottom: var(--sp-md);
}

.tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--hairline);
  border-radius: var(--r-pill-sm);
  background: var(--canvas-soft);
}

.tab {
  height: 30px;
  padding: 0 var(--sp-md);
  border: 0;
  border-radius: var(--r-pill-sm);
  background: transparent;
  color: var(--body);
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.15s var(--ease), color 0.15s var(--ease);
}

.tab:hover {
  color: var(--ink);
}

.tab--active {
  background: var(--canvas);
  color: var(--ink);
  box-shadow: var(--shadow-xs);
}

.toolbar__tools {
  display: flex;
  align-items: center;
  gap: var(--sp-xs);
}

.search {
  position: relative;
  display: flex;
  align-items: center;
  color: var(--mute);
}

.search svg {
  position: absolute;
  left: var(--sp-sm);
  pointer-events: none;
}

.search__input {
  width: 240px;
  height: 36px;
  padding: 0 var(--sp-sm) 0 var(--sp-xl);
  border: 1px solid var(--hairline);
  border-radius: var(--r-sm);
  background: var(--canvas);
  font-size: 14px;
  letter-spacing: -0.28px;
}

.search__input:focus {
  outline: none;
  border-color: var(--ink);
}

.search__input::placeholder {
  color: var(--mute);
}

.sort {
  width: 190px;
  flex: none;
}

.loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--sp-sm);
  padding: var(--sp-4xl);
  color: var(--mute);
}

@media (max-width: 860px) {
  .page__head {
    flex-direction: column;
    align-items: flex-start;
  }

  .tabs {
    overflow-x: auto;
    max-width: 100%;
  }

  .search__input {
    width: 100%;
  }

  .toolbar__tools {
    flex-wrap: wrap;
    width: 100%;
  }

  .sort {
    width: 100%;
  }

  .search {
    flex: 1;
  }
}
</style>
