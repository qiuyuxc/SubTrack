<script setup>
import StatusBadge from './StatusBadge.vue';
import { useMediaQuery } from '../lib/useMediaQuery.js';
import { cycleLabel, formatMoney } from '../lib/format.js';
import { countdownLabel, formatDate, periodProgress } from '../lib/date.js';

defineProps({
  items: { type: Array, required: true },
  loading: { type: Boolean, default: false },
});

const emit = defineEmits(['edit', 'delete']);

// Below this width the 8-column table stops being readable, so the same rows
// render as tappable cards instead (tapping opens the edit dialog).
const narrow = useMediaQuery('(max-width: 720px)');

const isUrgent = (item) => item.daysLeft >= 0 && item.daysLeft <= 7;
</script>

<template>
  <div v-if="!narrow" class="table-wrap">
    <table class="table">
      <thead>
        <tr>
          <th scope="col">订阅</th>
          <th scope="col">分类</th>
          <th scope="col">周期</th>
          <th scope="col" class="num">金额</th>
          <th scope="col">开始</th>
          <th scope="col">到期</th>
          <th scope="col">状态</th>
          <th scope="col"><span class="sr-only">操作</span></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in items" :key="item.id">
          <td>
            <div class="cell-main">
              <span class="strong truncate">{{ item.name }}</span>
              <span class="caption truncate">{{ item.vendor || '—' }}</span>
            </div>
          </td>
          <td>
            <span class="badge">{{ item.category }}</span>
          </td>
          <td class="muted">{{ cycleLabel(item.cycle) }}</td>
          <td class="num strong">
            {{ formatMoney(item.amount, item.currency) }}
            <span v-if="item.monthlyEquivalent && item.cycle !== 'monthly'" class="caption cell-eq">
              约 {{ formatMoney(item.monthlyEquivalent, item.currency) }}/月
            </span>
          </td>
          <td class="muted mono">{{ formatDate(item.startDate) }}</td>
          <td>
            <div class="cell-main">
              <span class="mono">{{ formatDate(item.endDate, { withYear: true }) }}</span>
              <span class="caption" :class="{ 'is-urgent': isUrgent(item) }">
                {{ countdownLabel(item.daysLeft) }}
              </span>
              <span v-if="item.reminderDays" class="caption">单独提前 {{ item.reminderDays }} 天提醒</span>
            </div>
            <div class="cell-meter meter" :title="`周期已过 ${periodProgress(item.startDate, item.endDate)}%`">
              <span
                class="meter__fill"
                :class="{ 'meter__fill--over': item.daysLeft < 0 }"
                :style="{ width: `${periodProgress(item.startDate, item.endDate)}%` }"
              />
            </div>
          </td>
          <td>
            <div class="cell-status">
              <StatusBadge :item="item" />
              <span v-if="item.autoRenew" class="caption">自动续费</span>
            </div>
          </td>
          <td>
            <div class="cell-actions">
              <button type="button" class="icon-btn icon-btn--sm" aria-label="编辑" @click="emit('edit', item)">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M4 20h4l10-10a2.8 2.8 0 0 0-4-4L4 16z" /><path d="m13.5 6.5 4 4" />
                </svg>
              </button>
              <button type="button" class="icon-btn icon-btn--sm" aria-label="删除" @click="emit('delete', item)">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
                </svg>
              </button>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </div>

  <ul v-else class="cards">
    <li v-for="item in items" :key="item.id" class="sub-card">
      <button type="button" class="sub-card__body" @click="emit('edit', item)">
        <span class="sub-card__row">
          <span class="strong truncate">{{ item.name }}</span>
          <StatusBadge :item="item" />
        </span>
        <span class="caption truncate">
          {{ item.vendor || '—' }} · {{ item.category }} · {{ cycleLabel(item.cycle) }}
        </span>
        <span class="sub-card__row sub-card__row--split">
          <span class="body-md strong tabular">{{ formatMoney(item.amount, item.currency) }}</span>
          <span class="caption" :class="{ 'is-urgent': isUrgent(item) }">
            {{ countdownLabel(item.daysLeft) }}
          </span>
        </span>
        <span class="meter sub-card__meter">
          <span
            class="meter__fill"
            :class="{ 'meter__fill--over': item.daysLeft < 0 }"
            :style="{ width: `${periodProgress(item.startDate, item.endDate)}%` }"
          />
        </span>
        <span class="caption mono">
          {{ formatDate(item.startDate) }} → {{ formatDate(item.endDate, { withYear: true }) }}
        </span>
        <span v-if="item.autoRenew || item.reminderDays" class="sub-card__flags">
          <span v-if="item.autoRenew" class="badge">自动续费</span>
          <span v-if="item.reminderDays" class="badge">提前 {{ item.reminderDays }} 天提醒</span>
        </span>
      </button>

      <div class="sub-card__actions">
        <button type="button" class="icon-btn icon-btn--sm" aria-label="编辑" @click="emit('edit', item)">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 20h4l10-10a2.8 2.8 0 0 0-4-4L4 16z" /><path d="m13.5 6.5 4 4" />
          </svg>
        </button>
        <button type="button" class="icon-btn icon-btn--sm" aria-label="删除" @click="emit('delete', item)">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
          </svg>
        </button>
      </div>
    </li>
  </ul>
</template>

<style scoped>
.cell-main {
  display: flex;
  flex-direction: column;
  gap: 1px;
  max-width: 240px;
}

.cell-eq {
  display: block;
  font-weight: 400;
}

.cell-meter {
  width: 84px;
  margin-top: 6px;
}

.cell-status {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
}

.cell-actions {
  display: flex;
  gap: var(--sp-xxs);
  justify-content: flex-end;
  opacity: 0;
  transition: opacity 0.15s var(--ease);
}

tr:hover .cell-actions,
tr:focus-within .cell-actions {
  opacity: 1;
}

.icon-btn--sm {
  width: 28px;
  height: 28px;
}

.is-urgent {
  color: var(--warning-deep);
  font-weight: 500;
}

/* ------------------------------------------------------- mobile card list */

.cards {
  display: flex;
  flex-direction: column;
  gap: var(--sp-xs);
  margin: 0;
  padding: var(--sp-xs);
  list-style: none;
}

.sub-card {
  display: flex;
  align-items: stretch;
  gap: var(--sp-xxs);
  border: 1px solid var(--hairline);
  border-radius: var(--r-md);
  background: var(--canvas);
  transition: border-color 0.15s var(--ease);
}

.sub-card:focus-within {
  border-color: var(--hairline-strong);
}

.sub-card__body {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
  padding: var(--sp-sm);
  border: 0;
  background: none;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.sub-card__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-xs);
  min-width: 0;
}

.sub-card__row--split {
  margin-top: 2px;
}

.sub-card__meter {
  width: 100%;
  margin-top: 2px;
}

.sub-card__flags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-xxs);
  margin-top: 2px;
}

.sub-card__actions {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: var(--sp-xxs);
  padding: var(--sp-xs) var(--sp-xs) var(--sp-xs) 0;
}
</style>
