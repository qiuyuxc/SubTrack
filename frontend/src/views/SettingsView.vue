<script setup>
import { computed, reactive, ref, watch } from 'vue';
import AppSelect from '../components/AppSelect.vue';
import ToggleSwitch from '../components/ToggleSwitch.vue';
import ChannelDialog from '../components/ChannelDialog.vue';
import { store, saveSettings } from '../store.js';
import { CHANNELS, ICONS, WEBHOOK_PROVIDERS } from '../lib/channels.js';
import { pushSupported } from '../lib/push.js';
import { useAppShell } from '../lib/appShell.js';
import { formatMoney } from '../lib/format.js';

const shell = useAppShell();

const CURRENCIES = [
  { value: 'CNY', label: 'CNY · 人民币' },
  { value: 'USD', label: 'USD · 美元' },
  { value: 'EUR', label: 'EUR · 欧元' },
  { value: 'JPY', label: 'JPY · 日元' },
  { value: 'HKD', label: 'HKD · 港币' },
];

const TIMEZONES = [
  { value: 'Asia/Shanghai', label: 'Asia/Shanghai · 北京时间' },
  { value: 'Asia/Hong_Kong', label: 'Asia/Hong_Kong' },
  { value: 'Asia/Tokyo', label: 'Asia/Tokyo · 东京' },
  { value: 'Asia/Singapore', label: 'Asia/Singapore' },
  { value: 'UTC', label: 'UTC' },
  { value: 'Europe/London', label: 'Europe/London' },
  { value: 'America/Los_Angeles', label: 'America/Los_Angeles' },
];

// Rates are "CNY per one unit", so a $10 subscription counts as ¥67 in the
// totals instead of ¥10. CNY is the base and therefore not editable.
const RATE_CURRENCIES = [
  { code: 'USD', label: '美元 USD' },
  { code: 'EUR', label: '欧元 EUR' },
  { code: 'JPY', label: '日元 JPY' },
  { code: 'HKD', label: '港币 HKD' },
];
const RATE_CODES = RATE_CURRENCIES.map((currency) => currency.code);

const form = reactive({
  monthlyBudget: 0,
  currency: 'CNY',
  reminderDays: 7,
  timezone: 'Asia/Shanghai',
  showHero: false,
  appMode: false,
  rates: {},
});

const saving = ref(false);
const saved = ref(false);
const openChannel = ref(null);

/** The rates are stored as a JSON string in settings; junk degrades to the seeded defaults. */
function readRates(settings) {
  try {
    const parsed = JSON.parse(settings?.exchangeRates ?? '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function hydrate() {
  form.monthlyBudget = store.settings.monthlyBudget ?? 0;
  form.currency = store.settings.currency ?? 'CNY';
  form.reminderDays = store.settings.reminderDays ?? 7;
  form.timezone = store.settings.timezone ?? 'Asia/Shanghai';
  form.showHero = Boolean(store.settings.showHero);
  form.appMode = Boolean(store.settings.appMode);
  form.rates = { ...readRates(store.settings) };
}

watch(() => store.settings, hydrate, { immediate: true, deep: true });

const storedRates = computed(() => readRates(store.settings));

const dirty = computed(() => {
  const s = store.settings;
  return (
    Number(form.monthlyBudget) !== Number(s.monthlyBudget) ||
    form.currency !== s.currency ||
    Number(form.reminderDays) !== Number(s.reminderDays) ||
    form.timezone !== s.timezone ||
    Boolean(form.showHero) !== Boolean(s.showHero) ||
    Boolean(form.appMode) !== Boolean(s.appMode) ||
    RATE_CODES.some((code) => {
      const stored = Number(storedRates.value[code]);
      return Number.isFinite(stored) && stored !== Number(form.rates?.[code]);
    })
  );
});

const budgetPreview = computed(() => {
  const spend = store.stats?.spend.month ?? 0;
  const budget = Number(form.monthlyBudget) || 0;
  return { spend, budget, remaining: budget - spend };
});

/** A channel can be switched on but still missing credentials. */
const channelCards = computed(() =>
  CHANNELS.map((channel) => {
    const settings = store.settings;
    const enabled = Boolean(settings[channel.enabledKey]);
    let configured = true;
    let target = '';
    if (channel.id === 'push') configured = pushSupported();
    else if (channel.id === 'webhook') {
      configured = Boolean(settings.hasSecrets?.webhookUrl);
      target = WEBHOOK_PROVIDERS.find((provider) => provider.value === settings.webhookProvider)?.label ?? '';
    }
    else if (channel.id === 'telegram') configured = Boolean(settings.hasSecrets?.telegramBotToken && settings.telegramChatId);
    else if (channel.id === 'email') {
      const hasSender = Boolean(settings.emailFrom && settings.emailTo);
      // Each transport has its own required credential: SMTP needs a host,
      // the HTTP gateway an endpoint, Resend an API key.
      const transportReady =
        settings.emailProvider === 'smtp'
          ? Boolean(settings.smtpHost)
          : settings.emailProvider === 'http'
            ? Boolean(settings.emailEndpoint)
            : Boolean(settings.hasSecrets?.emailApiKey);
      configured = hasSender && transportReady;
    }

    return {
      ...channel,
      enabled,
      configured,
      state: !enabled ? 'off' : configured ? 'on' : 'incomplete',
      stateLabel: !enabled
        ? '已关闭'
        : configured
          ? target ? `已启用 · ${target}` : '已启用'
          : channel.id === 'push' ? '浏览器不支持' : '配置不完整',
    };
  }),
);

async function submit() {
  saving.value = true;
  saved.value = false;
  const rates = { ...storedRates.value };
  for (const code of RATE_CODES) {
    const value = Number(form.rates?.[code]);
    if (Number.isFinite(value) && value > 0) rates[code] = value;
  }
  try {
    await saveSettings({
      monthly_budget: Number(form.monthlyBudget) || 0,
      currency: form.currency,
      exchangeRates: JSON.stringify(rates),
      reminder_days: Number(form.reminderDays) || 7,
      timezone: form.timezone,
      showHero: Boolean(form.showHero),
      appMode: Boolean(form.appMode),
    });
    saved.value = true;
    setTimeout(() => { saved.value = false; }, 2600);
  } finally {
    saving.value = false;
  }
}

function reset() {
  hydrate();
}
</script>

<template>
  <div class="container page">
    <header v-if="!shell" class="page__head">
      <h1 class="display-lg page__title">系统设置</h1>
    </header>

    <div class="layout">
      <div class="stack gap-lg">
        <form class="stack gap-lg" @submit.prevent="submit">
          <article class="card">
            <div class="stack gap-xxs">
              <h2 class="display-sm">预算与金额</h2>
              <p class="caption">剩余额度 = 月度预算 − 本月订阅支出</p>
            </div>

            <div class="grid grid--2 grid--gap">
              <div class="field">
                <label class="label" for="set-budget">月度预算</label>
                <input
                  id="set-budget"
                  v-model="form.monthlyBudget"
                  class="input"
                  type="number"
                  min="0"
                  step="1"
                  inputmode="decimal"
                />
                <p class="hint">设为 0 表示暂不追踪剩余额度。</p>
              </div>
              <div class="field">
                <label class="label" id="set-currency-label">币种</label>
                <AppSelect
                  id="set-currency"
                  v-model="form.currency"
                  :options="CURRENCIES"
                  aria-label="币种"
                />
              </div>
            </div>

            <div class="stack gap-xxs">
              <p class="label">汇率</p>
              <p class="hint">1 外币 = ? 人民币；账单、预算与首页合计都会按这里换算到展示币种。</p>
            </div>
            <div class="grid grid--2 grid--gap">
              <div v-for="rate in RATE_CURRENCIES" :key="rate.code" class="field">
                <label class="label" :for="`set-rate-${rate.code}`">{{ rate.label }}</label>
                <input
                  :id="`set-rate-${rate.code}`"
                  v-model="form.rates[rate.code]"
                  class="input"
                  type="number"
                  min="0"
                  step="0.0001"
                  inputmode="decimal"
                />
              </div>
            </div>

            <div class="preview">
              <div>
                <p class="caption">本月已用</p>
                <p class="body-sm strong tabular">{{ formatMoney(budgetPreview.spend, form.currency) }}</p>
              </div>
              <div>
                <p class="caption">月度预算</p>
                <p class="body-sm strong tabular">{{ formatMoney(budgetPreview.budget, form.currency) }}</p>
              </div>
              <div>
                <p class="caption">剩余额度</p>
                <p
                  class="body-sm strong tabular"
                  :style="{ color: budgetPreview.remaining < 0 ? 'var(--error)' : 'inherit' }"
                >
                  {{ formatMoney(budgetPreview.remaining, form.currency) }}
                </p>
              </div>
            </div>
          </article>

          <article class="card">
            <div class="stack gap-xxs">
              <h2 class="display-sm">提醒</h2>
              <p class="caption">全局默认窗口；单个订阅可在添加 / 编辑弹窗里单独设置</p>
            </div>

            <div class="grid grid--2 grid--gap">
              <div class="field">
                <label class="label" for="set-reminder">提前提醒天数</label>
                <input
                  id="set-reminder"
                  v-model="form.reminderDays"
                  class="input"
                  type="number"
                  min="1"
                  max="90"
                  step="1"
                />
                <p class="hint">推荐 7 天；取值范围 1 – 90 天。</p>
              </div>
              <div class="field">
                <label class="label" for="set-tz">时区</label>
                <AppSelect id="set-tz" v-model="form.timezone" :options="TIMEZONES" aria-label="时区" />
                <p class="hint">用于判断「今天」以及每日扫描的时间。</p>
              </div>
            </div>
          </article>

          <article class="card">
            <div class="stack gap-xxs">
              <h2 class="display-sm">界面</h2>
              <p class="caption">首页（/）展示什么</p>
            </div>
            <div class="interface">
              <ToggleSwitch
                v-model="form.showHero"
                label="启用落地页"
                hint="开启后网站首页（/）就是品牌落地页；关闭后访问首页会直接进入登录页（已登录则进入概览）。"
              />
              <RouterLink v-if="store.settings.showHero" to="/" class="btn btn--secondary btn--sm btn--pill">
                查看首页
              </RouterLink>
              <div class="interface__row">
                <ToggleSwitch
                  v-model="form.appMode"
                  label="App 模式（移动端专适配）"
                  hint="手机或已安装到桌面时，改用底部标签栏 + 全屏应用栏的 App 式界面；桌面窗口仍保持现在的网页布局。"
                />
                <p class="caption interface__note">
                  在桌面浏览器里把窗口收窄到 720px 以内即可预览。
                </p>
              </div>
            </div>
          </article>

          <div class="actions">
            <button type="button" class="btn btn--ghost" :disabled="!dirty || saving" @click="reset">
              撤销修改
            </button>
            <span class="spacer" />
            <span v-if="saved" class="badge badge--success">已保存</span>
            <button type="submit" class="btn btn--primary" :disabled="saving || !dirty">
              {{ saving ? '保存中…' : '保存设置' }}
            </button>
          </div>
        </form>

        <article class="card">
          <header class="channels__head">
            <div class="stack gap-xxs">
              <h2 class="display-sm">通知渠道</h2>
              <p class="caption">点击卡片配置对应渠道，独立保存、互不影响</p>
            </div>
            <span class="badge">{{ channelCards.filter((c) => c.enabled).length }} / {{ channelCards.length }} 已启用</span>
          </header>

          <ul class="channels">
            <li v-for="channel in channelCards" :key="channel.id">
              <button type="button" class="channel" @click="openChannel = channel">
                <span class="channel__icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                    <path :d="ICONS[channel.id]" />
                  </svg>
                </span>
                <span class="channel__text">
                  <span class="channel__title">
                    <span class="body-sm strong">{{ channel.label }}</span>
                    <span
                      class="badge"
                      :class="channel.state === 'on' ? 'badge--success' : channel.state === 'incomplete' ? 'badge--warning' : ''"
                    >
                      <span class="badge__dot" />{{ channel.stateLabel }}
                    </span>
                  </span>
                  <span class="caption channel__desc">{{ channel.description }}</span>
                </span>
                <svg class="channel__arrow" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="m9 6 6 6-6 6" />
                </svg>
              </button>
            </li>
          </ul>
        </article>
      </div>

      <aside class="stack gap-md">
        <article class="card card--soft">
          <p class="eyebrow">当前状态</p>
          <dl class="facts">
            <div class="facts__row">
              <dt class="caption">订阅总数</dt>
              <dd class="body-sm strong tabular">{{ store.stats?.counts.total ?? 0 }}</dd>
            </div>
            <div class="facts__row">
              <dt class="caption">生效中</dt>
              <dd class="body-sm strong tabular">{{ store.stats?.counts.active ?? 0 }}</dd>
            </div>
            <div class="facts__row">
              <dt class="caption">即将到期</dt>
              <dd class="body-sm strong tabular">{{ store.stats?.counts.expiringSoon ?? 0 }}</dd>
            </div>
            <div class="facts__row">
              <dt class="caption">已过期</dt>
              <dd class="body-sm strong tabular">{{ store.stats?.counts.expired ?? 0 }}</dd>
            </div>
            <div class="facts__row">
              <dt class="caption">累计消费</dt>
              <dd class="body-sm strong tabular">
                {{ formatMoney(store.stats?.spend.total ?? 0, store.settings.currency) }}
              </dd>
            </div>
          </dl>
        </article>

        <article class="card">
          <p class="eyebrow">每日自动扫描</p>
          <p class="body-sm">
            Cron Trigger 每天 01:00 UTC（{{ form.timezone === 'Asia/Shanghai' ? '北京时间 09:00' : form.timezone }}）执行一次，
            为进入提醒窗口的订阅生成提醒；同一订阅同一到期日只会提醒一次。
          </p>
          <p class="caption mono code-block">crons = ["0 1 * * *"]</p>
          <p class="caption">
            本地调试：<code class="mono">curl "http://localhost:8787/__scheduled?cron=0+1+*+*+*"</code>
          </p>
        </article>

        <article class="card card--soft">
          <p class="eyebrow">账号</p>
          <p class="body-sm">
            当前登录：<strong class="strong">{{ store.auth.username }}</strong>
          </p>
          <p class="caption">
            管理员账号由 Worker 的 <code class="mono">ADMIN_USERNAME</code> /
            <code class="mono">ADMIN_PASSWORD</code> 环境变量决定，不提供注册入口。
            修改后需要用新密码重新登录。
          </p>
        </article>
      </aside>
    </div>

    <ChannelDialog :open="Boolean(openChannel)" :channel="openChannel" @close="openChannel = null" />
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

.layout {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
  gap: var(--sp-md);
  align-items: start;
}

.grid--2 {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.grid--gap {
  margin-top: var(--sp-md);
}

.card {
  display: flex;
  flex-direction: column;
}

.interface {
  margin-top: var(--sp-md);
  padding-top: var(--sp-md);
  border-top: 1px solid var(--hairline);
}

.interface .btn {
  margin-top: var(--sp-sm);
}

.interface__row {
  margin-top: var(--sp-md);
  padding-top: var(--sp-md);
  border-top: 1px solid var(--hairline);
}

.interface__note {
  margin-top: var(--sp-xs);
}

.preview {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--sp-md);
  margin-top: var(--sp-md);
  padding-top: var(--sp-md);
  border-top: 1px solid var(--hairline);
}

.actions {
  display: flex;
  align-items: center;
  gap: var(--sp-xs);
  padding-top: var(--sp-xs);
}

/* ------------------------------------------------------------- channels */

.channels__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--sp-md);
}

.channels {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--sp-xs);
  margin: var(--sp-md) 0 0;
  padding: 0;
  list-style: none;
}

.channel {
  display: flex;
  align-items: center;
  gap: var(--sp-sm);
  width: 100%;
  padding: var(--sp-sm);
  border: 1px solid var(--hairline);
  border-radius: var(--r-md);
  background: var(--canvas);
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s var(--ease), background 0.15s var(--ease);
}

.channel:hover {
  border-color: var(--hairline-strong);
  background: var(--canvas-soft);
}

.channel__icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 32px;
  height: 32px;
  border: 1px solid var(--hairline);
  border-radius: var(--r-sm);
  background: var(--canvas-soft);
  color: var(--ink);
}

.channel__text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.channel__title {
  display: flex;
  align-items: center;
  gap: var(--sp-xs);
  flex-wrap: wrap;
}

.channel__desc {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.channel__arrow {
  flex: none;
  color: var(--mute);
}

/* --------------------------------------------------------------- facts */

.facts {
  display: flex;
  flex-direction: column;
  margin: var(--sp-md) 0 0;
}

.facts__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-sm);
  padding: var(--sp-xs) 0;
  border-bottom: 1px solid var(--hairline);
}

.facts__row:last-child {
  border-bottom: none;
}

.facts dd {
  margin: 0;
}

.code-block {
  margin-top: var(--sp-xs);
  padding: var(--sp-xs) var(--sp-sm);
  border-radius: var(--r-sm);
  background: var(--canvas-soft-2);
  color: var(--body);
  overflow-x: auto;
}

@media (max-width: 1000px) {
  .layout {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 640px) {
  .grid--2,
  .preview,
  .channels {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
