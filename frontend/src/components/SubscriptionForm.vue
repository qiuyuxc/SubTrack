<script setup>
import { computed, reactive, ref, watch } from 'vue';
import BaseModal from './BaseModal.vue';
import ToggleSwitch from './ToggleSwitch.vue';
import AppSelect from './AppSelect.vue';
import { dialogState, closeSubscriptionDialog } from '../lib/dialog.js';
import { createSubscription, deleteSubscription, state, updateSubscription } from '../store.js';
import { CYCLES, currencySymbol, formatMoney } from '../lib/format.js';
import { addDays, formatDateLong, isValidISODate, todayISO } from '../lib/date.js';

const CATEGORIES = ['影音娱乐', '效率工具', '设计工具', '云服务', '云存储', '开发工具', '学习教育', '生活服务', '其他'];
const CURRENCIES = ['CNY', 'USD', 'EUR', 'JPY', 'HKD'].map((code) => ({ value: code, label: code }));
const STATUS_OPTIONS = [
  { value: 'active', label: '生效中' },
  { value: 'paused', label: '已暂停' },
  { value: 'cancelled', label: '已取消' },
];

const saving = ref(false);
const serverErrors = ref([]);
const touched = ref(false);

const form = reactive(blankForm());
const confirmingDelete = ref(false);

function blankForm() {
  const today = todayISO();
  return {
    name: '',
    vendor: '',
    category: '其他',
    amount: '',
    currency: 'CNY',
    cycle: 'monthly',
    startDate: today,
    endDate: addDays(today, 30),
    autoRenew: true,
    reminderDays: '',
    status: 'active',
    notes: '',
  };
}

function hydrate(subscription) {
  if (!subscription) return blankForm();
  return {
    name: subscription.name ?? '',
    vendor: subscription.vendor ?? '',
    category: subscription.category ?? '其他',
    amount: String(subscription.amount ?? ''),
    currency: subscription.currency ?? 'CNY',
    cycle: subscription.cycle ?? 'monthly',
    startDate: subscription.startDate ?? todayISO(),
    endDate: subscription.endDate ?? todayISO(),
    autoRenew: Boolean(subscription.autoRenew),
    reminderDays: subscription.reminderDays == null ? '' : String(subscription.reminderDays),
    status: subscription.status ?? 'active',
    notes: subscription.notes ?? '',
  };
}

// Re-seed the form every time the dialog transitions to open.
watch(
  () => [dialogState.open, dialogState.editing?.id],
  ([open]) => {
    if (!open) return;
    Object.assign(form, hydrate(dialogState.editing));
    serverErrors.value = [];
    touched.value = false;
    confirmingDelete.value = false;
  },
  { immediate: true },
);

const editing = computed(() => dialogState.editing);
const isEdit = computed(() => Boolean(editing.value));

const errors = computed(() => {
  const list = [...serverErrors.value];
  if (!touched.value && !serverErrors.value.length) return [];
  if (!form.name.trim()) list.push('请填写订阅名称');
  if (form.amount === '' || Number.isNaN(Number(form.amount)) || Number(form.amount) < 0) {
    list.push('金额必须是大于等于 0 的数字');
  }
  if (!isValidISODate(form.startDate)) list.push('请选择有效的开始时间');
  if (!isValidISODate(form.endDate)) list.push('请选择有效的到期时间');
  if (isValidISODate(form.startDate) && isValidISODate(form.endDate) && form.endDate < form.startDate) {
    list.push('到期时间不能早于开始时间');
  }
  if (form.reminderDays !== '' && (!Number.isFinite(Number(form.reminderDays)) || Number(form.reminderDays) < 1 || Number(form.reminderDays) > 90)) {
    list.push('提前提醒天数需在 1–90 之间，留空则跟随全局设置');
  }
  return [...new Set(list)];
});

const reminderDate = computed(() => {
  if (!isValidISODate(form.endDate)) return null;
  const parsed = form.reminderDays === '' ? NaN : Number(form.reminderDays);
  const custom = Number.isFinite(parsed) && parsed >= 1 && parsed <= 90;
  const days = custom ? Math.trunc(parsed) : (state.settings.reminderDays ?? 7);
  return { date: addDays(form.endDate, -days), days, custom };
});

const periodDays = computed(() => {
  if (!isValidISODate(form.startDate) || !isValidISODate(form.endDate)) return 0;
  const start = new Date(form.startDate);
  const end = new Date(form.endDate);
  return Math.max(0, Math.round((end - start) / 86400000));
});

const monthlyEquivalent = computed(() => {
  const amount = Number(form.amount);
  if (!Number.isFinite(amount) || amount <= 0 || periodDays.value <= 0) return null;
  return amount / (periodDays.value / 30.44);
});

const dynamicFields = computed(() => {
  switch (form.cycle) {
    case 'weekly': return { days: 7, label: '1 周' };
    case 'monthly': return { months: 1, label: '1 个月' };
    case 'quarterly': return { months: 3, label: '3 个月' };
    case 'yearly': return { months: 12, label: '1 年' };
    default: return null;
  }
});

function applyCycleToEndDate() {
  const rule = dynamicFields.value;
  if (!rule || !isValidISODate(form.startDate)) return;
  if (rule.days) {
    form.endDate = addDays(form.startDate, rule.days);
    return;
  }
  const date = new Date(form.startDate);
  date.setMonth(date.getMonth() + rule.months);
  form.endDate = date.toISOString().slice(0, 10);
}

function presetCycle(value) {
  form.cycle = value;
  applyCycleToEndDate();
}

function quickEndDate(days) {
  form.endDate = addDays(form.startDate || todayISO(), days);
}

async function submit() {
  touched.value = true;
  serverErrors.value = [];
  if (errors.value.length) return;

  saving.value = true;
  const payload = {
    name: form.name.trim(),
    vendor: form.vendor.trim(),
    category: form.category.trim() || '其他',
    amount: Number(form.amount),
    currency: form.currency,
    cycle: form.cycle,
    startDate: form.startDate,
    endDate: form.endDate,
    autoRenew: form.autoRenew,
    reminderDays: form.reminderDays === '' ? null : Number(form.reminderDays),
    status: form.status,
    notes: form.notes.trim(),
  };

  try {
    if (isEdit.value) {
      await updateSubscription(editing.value.id, payload);
    } else {
      await createSubscription(payload);
    }
    closeSubscriptionDialog();
  } catch (error) {
    serverErrors.value = Array.isArray(error?.details) ? error.details : [];
  } finally {
    saving.value = false;
  }
}

function close() {
  serverErrors.value = [];
  touched.value = false;
  closeSubscriptionDialog();
}

async function removeConfirmed() {
  if (!editing.value) return;
  await deleteSubscription(editing.value.id, editing.value.name);
  confirmingDelete.value = false;
  close();
}
</script>

<template>
  <BaseModal
    :open="dialogState.open"
    :title="isEdit ? '编辑订阅' : '添加订阅'"
    :description="isEdit ? '修改金额或周期后，提醒时间会自动重新计算。' : '记录金额、开始时间与到期时间，系统会在到期前自动提醒。'"
    width="620px"
    @close="close"
  >
    <form class="form" novalidate @submit.prevent="submit">
      <div class="grid grid--2">
        <div class="field">
          <label class="label" for="sub-name">订阅名称</label>
          <input
            id="sub-name"
            v-model="form.name"
            class="input"
            placeholder="例如 Netflix 高级版"
            maxlength="120"
            :aria-invalid="touched && !form.name.trim()"
          />
        </div>
        <div class="field">
          <label class="label" for="sub-vendor">服务商 <span class="label__optional">选填</span></label>
          <input id="sub-vendor" v-model="form.vendor" class="input" placeholder="例如 Netflix" maxlength="120" />
        </div>
      </div>

      <div class="grid grid--amount">
        <div class="field">
          <label class="label" for="sub-amount">金额</label>
          <div class="amount">
            <span class="amount__symbol mono">{{ currencySymbol(form.currency) }}</span>
            <input
              id="sub-amount"
              v-model="form.amount"
              class="input amount__input"
              type="number"
              min="0"
              step="0.01"
              inputmode="decimal"
              placeholder="0.00"
              :aria-invalid="touched && (form.amount === '' || Number(form.amount) < 0)"
            />
          </div>
        </div>
        <div class="field">
          <label class="label" for="sub-currency">币种</label>
          <AppSelect id="sub-currency" v-model="form.currency" :options="CURRENCIES" aria-label="币种" />
        </div>
        <div class="field">
          <label class="label" for="sub-cycle">计费周期</label>
          <AppSelect
            id="sub-cycle"
            v-model="form.cycle"
            :options="CYCLES"
            aria-label="计费周期"
            @change="applyCycleToEndDate"
          />
        </div>
      </div>

      <div class="pills">
        <button type="button" class="pill" @click="quickEndDate(30)">30 天</button>
        <button type="button" class="pill" @click="quickEndDate(90)">90 天</button>
        <button type="button" class="pill" @click="quickEndDate(365)">1 年</button>
        <button type="button" class="pill pill--ghost" :disabled="!dynamicFields" @click="applyCycleToEndDate">
          按 {{ dynamicFields?.label ?? '—' }} 周期计算
        </button>
      </div>

      <div class="grid grid--2">
        <div class="field">
          <label class="label" for="sub-start">开始时间</label>
          <input
            id="sub-start"
            v-model="form.startDate"
            class="input"
            type="date"
            :aria-invalid="touched && !isValidISODate(form.startDate)"
          />
        </div>
        <div class="field">
          <label class="label" for="sub-end">到期时间</label>
          <input
            id="sub-end"
            v-model="form.endDate"
            class="input"
            type="date"
            :aria-invalid="touched && !isValidISODate(form.endDate)"
          />
        </div>
      </div>

      <div class="grid grid--2">
        <div class="field">
          <label class="label" for="sub-reminder">提前提醒天数</label>
          <input
            id="sub-reminder"
            v-model="form.reminderDays"
            class="input"
            type="number"
            min="1"
            max="90"
            step="1"
            inputmode="numeric"
            :placeholder="`跟随全局（${state.settings.reminderDays ?? 7} 天）`"
          />
          <p class="hint">留空跟随全局；周期很短的订阅（例如 7 天）可以单独填 3 天。</p>
        </div>
        <div class="field">
          <span class="label">自动续费</span>
          <ToggleSwitch
            v-model="form.autoRenew"
            label="到期后继续扣费"
            hint="到期当天自动按周期顺延，开始时间保留为首次订阅日"
          />
        </div>
      </div>

      <div class="summary">
        <div class="summary__row">
          <span class="caption">订阅时长</span>
          <span class="body-sm strong tabular">{{ periodDays }} 天</span>
        </div>
        <div class="summary__row">
          <span class="caption">折算每月</span>
          <span class="body-sm strong tabular">
            {{ monthlyEquivalent ? formatMoney(monthlyEquivalent, form.currency) : '—' }}
          </span>
        </div>
        <div class="summary__row">
          <span class="caption">提醒时间</span>
          <span class="body-sm strong">
            <template v-if="reminderDate">
              {{ formatDateLong(reminderDate.date) }}
              <span class="muted">（到期前 {{ reminderDate.days }} 天 · {{ reminderDate.custom ? '单独设置' : '跟随全局' }}）</span>
            </template>
            <template v-else>—</template>
          </span>
        </div>
      </div>

      <div class="grid grid--2">
        <div class="field">
          <label class="label" for="sub-category">分类</label>
          <input id="sub-category" v-model="form.category" class="input" list="category-options" maxlength="60" />
          <datalist id="category-options">
            <option v-for="category in CATEGORIES" :key="category" :value="category" />
          </datalist>
        </div>
        <div class="field">
          <label class="label" for="sub-status">状态</label>
          <AppSelect id="sub-status" v-model="form.status" :options="STATUS_OPTIONS" aria-label="状态" />
        </div>
      </div>

      <div class="field">
        <label class="label" for="sub-notes">备注 <span class="label__optional">选填</span></label>
        <textarea id="sub-notes" v-model="form.notes" class="textarea" maxlength="1000" placeholder="账号、共享人数、付款方式等" />
      </div>

      <ul v-if="errors.length" class="errors">
        <li v-for="error in errors" :key="error" class="field-error">{{ error }}</li>
      </ul>
    </form>

    <template #footer>
      <button
        v-if="isEdit"
        type="button"
        class="btn btn--danger btn--sm"
        @click="confirmingDelete = true"
      >
        删除
      </button>
      <span class="spacer" />
      <button type="button" class="btn btn--ghost btn--sm" @click="close">取消</button>
      <button type="button" class="btn btn--primary btn--sm btn--pill" :disabled="saving" @click="submit">
        {{ saving ? '保存中…' : isEdit ? '保存修改' : '添加订阅' }}
      </button>
    </template>
  </BaseModal>

  <BaseModal
    :open="confirmingDelete"
    title="删除这条订阅？"
    :description="`将永久删除「${editing?.name ?? ''}」及其提醒记录，此操作不可撤销。`"
    width="440px"
    @close="confirmingDelete = false"
  >
    <template #footer>
      <button type="button" class="btn btn--ghost btn--sm" @click="confirmingDelete = false">取消</button>
      <button type="button" class="btn btn--primary btn--sm btn--pill" @click="removeConfirmed">
        确认删除
      </button>
    </template>
  </BaseModal>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: var(--sp-md);
}

.amount {
  position: relative;
}

.amount__symbol {
  position: absolute;
  top: 50%;
  left: var(--sp-sm);
  transform: translateY(-50%);
  color: var(--mute);
}

.amount__input {
  padding-left: var(--sp-xl);
  font-variant-numeric: tabular-nums;
}

.pills {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-xs);
}

.pill {
  height: 26px;
  padding: 0 var(--sp-sm);
  border: 1px solid var(--hairline);
  border-radius: var(--r-full);
  background: var(--canvas);
  color: var(--body);
  font-size: 12px;
  cursor: pointer;
  transition: border-color 0.15s var(--ease), color 0.15s var(--ease);
}

.pill:hover:not(:disabled) {
  border-color: var(--hairline-strong);
  color: var(--ink);
}

.pill:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.pill--ghost {
  background: var(--canvas-soft);
}

.summary {
  display: flex;
  flex-direction: column;
  gap: var(--sp-xs);
  padding: var(--sp-sm) var(--sp-md);
  border: 1px solid var(--hairline);
  border-radius: var(--r-md);
  background: var(--canvas-soft);
}

.summary__row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--sp-md);
}

.errors {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: var(--sp-sm) var(--sp-md) var(--sp-sm) var(--sp-xl);
  border: 1px solid var(--error-soft);
  border-radius: var(--r-md);
  background: var(--error-soft);
  list-style: disc;
}

.errors .field-error {
  color: var(--error-deep);
}

@media (max-width: 640px) {
  .grid--2,
  .grid--amount {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
