<script setup>
import { computed, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import EmptyState from '../components/EmptyState.vue';
import { store, markAllRead, refreshNotifications, runReminders } from '../store.js';
import { openSubscriptionDialog } from '../lib/dialog.js';
import { CHANNELS, channelLabel } from '../lib/channels.js';
import { formatMoney } from '../lib/format.js';
import { countdownLabel, formatDateLong } from '../lib/date.js';
import { useAppShell } from '../lib/appShell.js';

const shell = useAppShell();
const scanning = ref(false);
const marking = ref(false);

const notifications = computed(() => store.notifications);
const upcoming = computed(() => store.stats?.upcoming ?? []);
const activeChannels = computed(() =>
  CHANNELS.filter((channel) => store.settings[channel.enabledKey]).map((channel) => channel.label),
);

function toneOf(item) {
  if (item.kind === 'expired') return 'expired';
  if (item.daysLeft <= 3) return 'critical';
  return 'warning';
}

async function checkNow() {
  scanning.value = true;
  try {
    await runReminders();
  } finally {
    scanning.value = false;
  }
}

async function markRead() {
  marking.value = true;
  try {
    await markAllRead();
  } finally {
    marking.value = false;
  }
}

onMounted(refreshNotifications);
</script>

<template>
  <div class="container page">
    <header class="page__head">
      <div class="page__heading">
        <h1 v-if="!shell" class="display-lg page__title">到期提醒</h1>
        <p class="caption">
          默认提前 <strong class="strong">{{ store.settings.reminderDays }} 天</strong> 提醒，可在每个订阅里单独设置窗口。
        </p>
      </div>
      <div class="page__actions">
        <button type="button" class="btn btn--secondary" :disabled="marking || !store.unread" @click="markRead">
          {{ marking ? '处理中…' : '全部标为已读' }}
        </button>
        <button type="button" class="btn btn--primary" :disabled="scanning" @click="checkNow">
          {{ scanning ? '扫描中…' : '立即检查提醒' }}
        </button>
      </div>
    </header>

    <section class="summary">
      <article class="card card--soft">
        <p class="eyebrow">提醒窗口</p>
        <p class="display-md">{{ store.settings.reminderDays }} 天</p>
        <p class="caption">全局默认窗口，可在设置中调整；单个订阅可在编辑弹窗里单独设置。</p>
      </article>
      <article class="card card--soft">
        <p class="eyebrow">待处理</p>
        <p class="display-md">{{ upcoming.length }} 个</p>
        <p class="caption">当前处于提醒窗口内的生效订阅。</p>
      </article>
      <article class="card card--soft">
        <p class="eyebrow">未读提醒</p>
        <p class="display-md">{{ store.unread }} 条</p>
        <p class="caption">已生成但尚未查看的提醒记录。</p>
      </article>
    </section>

    <section class="panels">
      <article class="card card--flush">
        <header class="card__header">
          <div class="stack gap-xxs">
            <h2 class="display-sm">提醒记录</h2>
            <p class="caption">最近生成的提醒，按时间倒序</p>
          </div>
          <span v-if="store.unread" class="badge badge--warning">{{ store.unread }} 条未读</span>
        </header>

        <ul v-if="notifications.length" class="notices">
          <li
            v-for="notice in notifications"
            :key="notice.id"
            class="notice"
            :class="[`notice--${toneOf(notice)}`, { 'notice--read': notice.readAt }]"
          >
            <span class="notice__rail" aria-hidden="true" />
            <div class="notice__main">
              <div class="row gap-xs">
                <p class="body-sm strong">{{ notice.title }}</p>
                <span v-if="!notice.readAt" class="badge badge--error">未读</span>
                <span v-else class="badge">已读</span>
              </div>
              <p class="body-sm notice__body">{{ notice.body }}</p>
              <div v-if="notice.deliveries.length" class="deliveries">
                <span
                  v-for="delivery in notice.deliveries"
                  :key="delivery.channel"
                  class="delivery"
                  :class="`delivery--${delivery.status}`"
                  :title="delivery.error || delivery.detail || ''"
                >
                  <span class="badge__dot" />
                  {{ channelLabel(delivery.channel) }}
                  <template v-if="delivery.status !== 'sent'"> · {{ delivery.error }}</template>
                </span>
              </div>
              <p class="caption mono">
                {{ formatDateLong(notice.dueDate) }} ·
                生成于 {{ notice.createdAt.slice(0, 16).replace('T', ' ') }}
              </p>
            </div>
            <div class="notice__meta">
              <span class="body-sm strong tabular">{{ formatMoney(notice.amount, notice.currency) }}</span>
              <span class="caption">{{ countdownLabel(notice.daysLeft) }}</span>
            </div>
          </li>
        </ul>

        <EmptyState
          v-else
          title="还没有提醒记录"
          description="当有订阅进入提醒窗口时，这里会出现对应的提醒。"
        />
      </article>

      <aside class="card">
        <div class="stack gap-xxs">
          <h2 class="display-sm">当前待处理</h2>
          <p class="caption">提醒窗口内的生效订阅</p>
        </div>
        <ul v-if="upcoming.length" class="pending">
          <li v-for="item in upcoming" :key="item.id" class="pending__row">
            <button type="button" class="pending__btn" @click="openSubscriptionDialog(item)">
              <span class="stack gap-xxs pending__text">
                <span class="body-sm strong truncate">{{ item.name }}</span>
                <span class="caption">{{ countdownLabel(item.daysLeft) }} · {{ formatDateLong(item.endDate) }}</span>
              </span>
              <span class="body-sm strong tabular">{{ formatMoney(item.amount, item.currency) }}</span>
            </button>
          </li>
        </ul>
        <p v-else class="body-sm muted pending__empty">
          没有需要处理的订阅，保持这个状态就好。
        </p>

        <div class="howto">
          <p class="eyebrow">自动化</p>
          <p class="body-sm">
            Worker 的 Cron Trigger 每天 09:00（{{ store.settings.timezone }}）自动执行一次扫描。
          </p>
          <p class="caption mono">crons = ["0 1 * * *"]</p>
          <p class="body-sm">
            已启用 {{ activeChannels.length }} 个渠道：{{ activeChannels.join('、') || '无' }}
          </p>
          <RouterLink to="/settings" class="btn btn--secondary btn--sm btn--pill">配置通知渠道</RouterLink>
        </div>
      </aside>
    </section>
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

.page__actions {
  display: flex;
  gap: var(--sp-xs);
  flex: none;
}

.summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--sp-md);
  margin-bottom: var(--sp-md);
}

.summary .card {
  display: flex;
  flex-direction: column;
  gap: var(--sp-xxs);
}

.panels {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr);
  gap: var(--sp-md);
  align-items: start;
}

.notices {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}

.notice {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: var(--sp-md);
  padding: var(--sp-md) var(--sp-lg) var(--sp-md) calc(var(--sp-lg) + 6px);
  border-bottom: 1px solid var(--hairline);
}

.notice:last-child {
  border-bottom: none;
}

.notice--read {
  opacity: 0.62;
}

.notice__rail {
  position: absolute;
  left: var(--sp-md);
  top: var(--sp-lg);
  width: 3px;
  height: 28px;
  border-radius: var(--r-full);
  background: var(--warning);
}

.notice--critical .notice__rail,
.notice--expired .notice__rail {
  background: var(--error);
}

.notice__main {
  display: flex;
  flex-direction: column;
  gap: var(--sp-xxs);
  flex: 1;
  min-width: 0;
}

.notice__body {
  max-width: 62ch;
  color: var(--body);
}

.notice__meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 1px;
  flex: none;
}

.pending {
  display: flex;
  flex-direction: column;
  margin: var(--sp-md) 0 0;
  padding: 0;
  list-style: none;
}

.pending__row + .pending__row {
  border-top: 1px solid var(--hairline);
}

.pending__btn {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-sm);
  width: 100%;
  padding: var(--sp-sm) 0;
  border: 0;
  background: none;
  text-align: left;
  cursor: pointer;
}

.pending__text {
  min-width: 0;
}

.pending__btn:hover .body-sm {
  color: var(--link);
}

.pending__empty {
  margin-top: var(--sp-md);
}

.howto {
  display: flex;
  flex-direction: column;
  gap: var(--sp-xs);
  margin-top: var(--sp-lg);
  padding-top: var(--sp-md);
  border-top: 1px solid var(--hairline);
}

.howto .mono {
  padding: var(--sp-xs) var(--sp-sm);
  border-radius: var(--r-sm);
  background: var(--canvas-soft);
  color: var(--body);
  overflow-x: auto;
}

@media (max-width: 1000px) {
  .panels {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 700px) {
  .page__head {
    flex-direction: column;
    align-items: flex-start;
  }

  .summary {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
