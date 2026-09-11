<script setup>
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import HeroBand from '../components/HeroBand.vue';
import MeshGradient from '../components/MeshGradient.vue';
import { state, store } from '../store.js';
import { openSubscriptionDialog } from '../lib/dialog.js';
import { formatMoney } from '../lib/format.js';

const authed = computed(() => state.auth.authenticated);
const reminderDays = computed(() =>
  authed.value ? store.settings.reminderDays : store.publicSettings?.reminderDays ?? 7,
);
const currency = computed(
  () => (authed.value ? store.settings.currency : store.publicSettings?.currency) ?? 'CNY',
);
const counts = computed(() => store.stats?.counts ?? {});
const upcoming = computed(() => store.stats?.upcoming ?? []);

const features = computed(() => [
  {
    title: '到期前自动提醒',
    body: `默认提前 ${reminderDays.value} 天提醒，每条订阅还能单独覆盖成 1–90 天里的任意一天。`,
    tag: 'reminder',
  },
  {
    title: '账单按月自动汇总',
    body: '按自然月把每一笔扣费归类成账单，点开任意月份就能看到当天的扣费明细。',
    tag: 'bills',
  },
  {
    title: '多渠道通知',
    body: '站内提醒、Webhook、Telegram 与邮件都可以单独开关，按需组合。',
    tag: 'notify',
  },
]);

const steps = [
  { index: '01', title: '录入订阅', body: '填写金额、开始时间与到期时间，可标记自动续费。' },
  { index: '02', title: '设定提醒', body: '跟随全局窗口，或为这条订阅单独指定提前天数。' },
  { index: '03', title: '查看账单', body: '月度汇总 + 明细流水，随时掌握花在哪儿。' },
];
</script>

<template>
  <div class="landing">
    <HeroBand :guest="!authed" />

    <section class="container band" aria-label="核心能力">
      <header class="band__head">
        <p class="eyebrow">what it does</p>
        <h2 class="display-lg">一个页面管住所有订阅。</h2>
        <p class="body-md band__lead">
          把散落在邮箱和账单里的订阅集中记下来，剩下的到期判断、金额统计与提醒都交给系统。
        </p>
      </header>

      <ul class="features">
        <li v-for="feature in features" :key="feature.tag" class="card feature">
          <p class="eyebrow feature__tag">{{ feature.tag }}</p>
          <h3 class="display-sm">{{ feature.title }}</h3>
          <p class="body-sm">{{ feature.body }}</p>
        </li>
      </ul>
    </section>

    <section class="band band--soft" aria-label="使用方式">
      <div class="container">
        <header class="band__head">
          <p class="eyebrow">how it works</p>
          <h2 class="display-lg">三步开始。</h2>
        </header>
        <ol class="steps">
          <li v-for="step in steps" :key="step.index" class="step">
            <span class="step__index mono">{{ step.index }}</span>
            <div class="stack gap-xxs">
              <h3 class="body-md strong">{{ step.title }}</h3>
              <p class="body-sm">{{ step.body }}</p>
            </div>
          </li>
        </ol>
      </div>
    </section>

    <section class="band" aria-label="进入概览">
      <div class="container">
        <div class="cta">
          <MeshGradient />
          <div class="cta__inner">
            <p class="eyebrow">overview</p>
            <template v-if="authed">
              <h2 class="display-lg">概览已经准备好了。</h2>
              <p class="body-md">
                当前共 {{ counts.total ?? 0 }} 条订阅，累计消费
                {{ formatMoney(store.stats?.spend.total ?? 0, currency) }}，
                {{ upcoming.length }} 条进入提醒窗口。
              </p>
              <div class="cta__actions">
                <RouterLink to="/dashboard" class="btn btn--primary btn--lg">进入概览</RouterLink>
                <button type="button" class="btn btn--secondary btn--lg" @click="openSubscriptionDialog()">
                  添加订阅
                </button>
              </div>
            </template>
            <template v-else>
              <h2 class="display-lg">登录后就是你的订阅看板。</h2>
              <p class="body-md">
                总消费金额、剩余额度、即将到期的订阅，以及按自然月汇总的账单，都在这一个页面里。
              </p>
              <div class="cta__actions">
                <RouterLink to="/login" class="btn btn--primary btn--lg">登录查看</RouterLink>
              </div>
            </template>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.band {
  padding-block: var(--sp-5xl);
}

.band--soft {
  border-block: 1px solid var(--hairline);
  background: var(--canvas-soft);
}

.band__head {
  display: flex;
  flex-direction: column;
  gap: var(--sp-xs);
  max-width: 62ch;
  margin-bottom: var(--sp-2xl);
}

.band__lead {
  max-width: 56ch;
}

.features {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--sp-md);
  margin: 0;
  padding: 0;
  list-style: none;
}

.feature {
  display: flex;
  flex-direction: column;
  gap: var(--sp-xs);
}

.feature__tag {
  color: var(--mute);
}

.steps {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--sp-lg);
  margin: 0;
  padding: 0;
  list-style: none;
}

.step {
  display: flex;
  gap: var(--sp-sm);
  padding-top: var(--sp-sm);
  border-top: 1px solid var(--hairline-strong);
}

.step__index {
  flex: none;
  color: var(--mute);
}

.cta {
  position: relative;
  overflow: hidden;
  border: 1px solid var(--hairline);
  border-radius: var(--r-xl);
  background: var(--canvas);
  text-align: center;
}

.cta__inner {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-sm);
  padding: var(--sp-5xl) var(--sp-lg);
}

.cta__inner .body-md {
  max-width: 52ch;
}

.cta__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--sp-sm);
  margin-top: var(--sp-xs);
}

@media (max-width: 860px) {
  .features,
  .steps {
    grid-template-columns: minmax(0, 1fr);
  }

  .band {
    padding-block: var(--sp-3xl);
  }

  .cta__inner {
    padding: var(--sp-3xl) var(--sp-md);
  }
}
</style>
