<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import StatCard from '../components/StatCard.vue';
import BudgetMeter from '../components/BudgetMeter.vue';
import TimelineChart from '../components/TimelineChart.vue';
import UpcomingList from '../components/UpcomingList.vue';
import SubscriptionTable from '../components/SubscriptionTable.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import EmptyState from '../components/EmptyState.vue';
import { api } from '../api.js';
import { useAppShell } from '../lib/appShell.js';
import { deleteSubscription, renewSubscription, store, runReminders } from '../store.js';
import { openSubscriptionDialog } from '../lib/dialog.js';
import { formatMoney, formatPercent } from '../lib/format.js';
import { monthLabel } from '../lib/date.js';

const shell = useAppShell();
const recent = ref([]);
const loadingRecent = ref(true);
const scanning = ref(false);
const pendingDelete = ref(null);
const deleting = ref(false);

const stats = computed(() => store.stats);
const currency = computed(() => stats.value?.currency ?? 'CNY');
const upcoming = computed(() => stats.value?.upcoming ?? []);
// Summed in the Worker, already converted onto the display currency.
const upcomingAmount = computed(() => stats.value?.spend?.upcoming ?? 0);

const hasBudget = computed(() => (stats.value?.budget.monthly ?? 0) > 0);

async function loadRecent() {
  loadingRecent.value = true;
  try {
    const { items } = await api.listSubscriptions({ sort: 'created-desc' });
    recent.value = items.slice(0, 6);
  } catch {
    recent.value = [];
  } finally {
    loadingRecent.value = false;
  }
}

let renewing = false;

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

async function checkNow() {
  scanning.value = true;
  try {
    await runReminders();
  } finally {
    scanning.value = false;
  }
}

onMounted(loadRecent);
watch(() => store.revision, loadRecent);
</script>

<template>
  <div class="dashboard">
    <header v-if="!shell" class="container page__head">
      <h1 class="display-lg page__title">概览</h1>
      <div class="dashHead__actions">
        <RouterLink v-if="store.settings.showHero" to="/" class="btn btn--secondary btn--pill">
          打开落地页
        </RouterLink>
        <button type="button" class="btn btn--primary btn--pill" @click="openSubscriptionDialog()">
          添加订阅
        </button>
      </div>
    </header>

    <div class="container">
      <section class="stats" aria-label="关键指标">
        <StatCard
          eyebrow="总消费金额"
          :value="formatMoney(stats?.spend.total ?? 0, currency)"
          :caption="`共 ${stats?.counts.total ?? 0} 条订阅，已取消的不计入`"
        >
          <div class="stat-split">
            <div>
              <p class="caption">本月（{{ monthLabel(stats?.spend.monthLabel ?? '') }}）</p>
              <p class="body-sm strong tabular">{{ formatMoney(stats?.spend.month ?? 0, currency) }}</p>
            </div>
            <div>
              <p class="caption">折算每月</p>
              <p class="body-sm strong tabular">
                {{ formatMoney(stats?.spend.monthlyEquivalent ?? 0, currency) }}
              </p>
            </div>
          </div>
        </StatCard>

        <StatCard
          eyebrow="剩余额度"
          :tone="stats?.budget.overBudget ? 'error' : 'default'"
          :hint="stats?.budget.overBudget ? '已超支' : hasBudget ? `已用 ${formatPercent(stats?.budget.usedRatio ?? 0)}` : '未设置'"
          :value="hasBudget ? formatMoney(stats?.budget.remaining ?? 0, currency) : '—'"
          :caption="hasBudget
            ? `月度预算 ${formatMoney(stats?.budget.monthly ?? 0, currency)} · 本月扣费 ${formatMoney(stats?.spend.month ?? 0, currency)}`
            : '前往设置填写月度预算，即可追踪剩余额度'"
        >
          <BudgetMeter
            v-if="hasBudget"
            :budget="stats.budget"
            :spent="stats.spend.month"
            :currency="currency"
            :show-legend="false"
          />
          <RouterLink v-else to="/settings" class="btn btn--secondary btn--sm btn--pill">设置预算</RouterLink>
        </StatCard>

        <StatCard
          eyebrow="即将到期"
          :tone="upcoming.length ? 'warning' : 'default'"
          :hint="upcoming.length ? `${store.settings.reminderDays} 天窗口` : ''"
          :value="`${stats?.counts.expiringSoon ?? 0} 个`"
          :caption="upcoming.length
            ? `未来 ${store.settings.reminderDays} 天需付 ${formatMoney(upcomingAmount, currency)}`
            : `未来 ${store.settings.reminderDays} 天内没有到期的订阅`"
        >
          <button
            type="button"
            class="btn btn--secondary btn--sm btn--pill"
            :disabled="scanning"
            @click="checkNow"
          >
            {{ scanning ? '扫描中…' : '立即检查提醒' }}
          </button>
        </StatCard>
      </section>

      <section class="panels">
        <article class="card card--flush">
          <header class="card__header">
            <div class="stack gap-xxs">
              <h2 class="display-sm">即将到期</h2>
              <p class="caption">到期前 {{ store.settings.reminderDays }} 天内需要处理的订阅</p>
            </div>
            <span v-if="upcoming.length" class="badge badge--warning">{{ upcoming.length }} 个待处理</span>
          </header>
          <UpcomingList v-if="upcoming.length" :items="upcoming" @edit="openSubscriptionDialog" @renew="renew" />
          <EmptyState
            v-else
            title="近期没有到期订阅"
            :description="`所有生效中的订阅都在 ${store.settings.reminderDays} 天提醒窗口之外，可以安心。`"
            :action-label="shell ? '' : '添加订阅'"
            @action="openSubscriptionDialog()"
          />
        </article>

        <div class="panels__side">
          <article class="card">
            <header class="stack gap-xxs">
              <h2 class="display-sm">支出分布</h2>
              <p class="caption">按分类统计的累计订阅金额</p>
            </header>
            <ul v-if="stats?.byCategory.length" class="categories">
              <li v-for="entry in stats.byCategory.slice(0, 5)" :key="entry.category" class="categories__row">
                <span class="body-sm truncate">{{ entry.category }}</span>
                <span class="body-sm strong tabular">{{ formatMoney(entry.amount, currency) }}</span>
                <span class="categories__bar">
                  <span
                    class="categories__fill"
                    :style="{ width: `${Math.round((entry.amount / (stats.spend.total || 1)) * 100)}%` }"
                  />
                </span>
              </li>
            </ul>
            <p v-else class="body-sm muted">暂无数据</p>
          </article>

          <article class="card">
            <header class="stack gap-xxs">
              <h2 class="display-sm">月度趋势</h2>
              <p class="caption">未来 6 个月预计扣费（含本月剩余扣费）</p>
            </header>
            <TimelineChart
              v-if="stats?.timeline.length"
              :timeline="stats.timeline"
              :currency="currency"
              :current-month="stats.spend.monthLabel"
            />
          </article>
        </div>
      </section>

      <section class="recent">
        <header class="recent__head">
          <div class="stack gap-xxs">
            <h2 class="display-md">最近添加</h2>
            <p class="body-sm">最新录入的 {{ recent.length }} 条订阅</p>
          </div>
          <RouterLink to="/subscriptions" class="btn btn--secondary btn--sm btn--pill">全部订阅</RouterLink>
        </header>

        <article class="card card--flush">
          <SubscriptionTable
            v-if="recent.length"
            :items="recent"
            :loading="loadingRecent"
            @edit="openSubscriptionDialog"
            @delete="pendingDelete = $event"
            @renew="renew"
          />
          <EmptyState
            v-else
            title="还没有订阅记录"
            description="添加第一条订阅后，这里会显示金额、周期与到期时间。"
            :action-label="shell ? '' : '添加订阅'"
            @action="openSubscriptionDialog()"
          />
        </article>
      </section>
    </div>

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
/* The overview keeps its stats flush with the app bar on phones, so the head
   (title + actions) is web-only here; the padding keeps both modes aligned. */
.dashboard {
  padding-top: var(--sp-lg);
}

.dashHead__actions {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--sp-xs);
}

.stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--sp-md);
  position: relative;
  z-index: 1;
}

.stat-split {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--sp-md);
  padding-top: var(--sp-sm);
  border-top: 1px solid var(--hairline);
}

.panels {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr);
  gap: var(--sp-md);
  margin-top: var(--sp-md);
  align-items: start;
}

.panels__side {
  display: flex;
  flex-direction: column;
  gap: var(--sp-md);
}

.categories {
  display: flex;
  flex-direction: column;
  gap: var(--sp-sm);
  margin: var(--sp-md) 0 0;
  padding: 0;
  list-style: none;
}

.categories__row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--sp-xs) var(--sp-sm);
  align-items: center;
}

.categories__bar {
  grid-column: 1 / -1;
  height: 4px;
  border-radius: var(--r-full);
  background: var(--canvas-soft-2);
  overflow: hidden;
}

.categories__fill {
  display: block;
  height: 100%;
  border-radius: var(--r-full);
  background: var(--ink);
}

.recent {
  margin-top: var(--sp-4xl);
}

.recent__head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--sp-md);
  margin-bottom: var(--sp-md);
}

@media (max-width: 1000px) {
  .stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .panels {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 640px) {
  .stats {
    grid-template-columns: minmax(0, 1fr);
  }

  .page__head {
    flex-direction: column;
    align-items: flex-start;
  }

  .dashHead__actions {
    width: 100%;
  }

  .recent__head {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
