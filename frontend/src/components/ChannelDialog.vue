<script setup>
import { computed, reactive, ref, watch } from 'vue';
import BaseModal from './BaseModal.vue';
import ToggleSwitch from './ToggleSwitch.vue';
import AppSelect from './AppSelect.vue';
import { ICONS, visibleFields } from '../lib/channels.js';
import { describePushError, notificationPermission, pushSupported } from '../lib/push.js';
import { state, disableBrowserPush, enableBrowserPush, refreshPushStatus, saveChannelSettings, testChannel } from '../store.js';

const props = defineProps({
  open: { type: Boolean, default: false },
  channel: { type: Object, default: null },
});

const emit = defineEmits(['close']);

const form = reactive({});
const enabled = ref(false);
const errors = ref([]);
const busy = ref(false);
const testing = ref(false);
const testResult = ref(null);

const fields = computed(() => (props.channel ? visibleFields(props.channel, form) : []));

/**
 * Secrets are never sent to the browser, so the field starts blank, `''` keeps
 * whatever is stored, and `null` clears it. `secret: true` marks a field that
 * behaves that way but is still readable while typing (a hook URL).
 */
const isSecret = (field) => field.type === 'secret' || field.secret === true;
const isPush = computed(() => props.channel?.component === 'push');
const pushStatus = computed(() => state.push);
const pushPermission = computed(() => (pushStatus.value.ready ? notificationPermission() : 'default'));
const pushBlocked = computed(() => !pushStatus.value.supported || pushPermission.value === 'denied');

const PERMISSION_LABELS = {
  granted: '已授权',
  default: '未授权',
  denied: '已被浏览器拒绝',
  unsupported: '浏览器不支持',
};

watch(
  () => [props.open, props.channel?.id],
  ([open]) => {
    if (!open || !props.channel) return;
    for (const key of Object.keys(form)) delete form[key];
    for (const field of props.channel.fields) {
      form[field.key] = isSecret(field) ? '' : (state.settings[field.key] ?? '');
    }
    enabled.value = Boolean(state.settings[props.channel.enabledKey]);
    errors.value = [];
    testResult.value = null;
    if (props.channel.component === 'push') refreshPushStatus();
  },
  { immediate: true },
);

async function toggleDevice() {
  busy.value = true;
  testResult.value = null;
  try {
    if (state.push.subscribed) await disableBrowserPush();
    else await enableBrowserPush();
  } catch (problem) {
    testResult.value = { ok: false, message: describePushError(problem) };
  } finally {
    busy.value = false;
  }
}

function validate() {
  const problems = [];
  for (const field of fields.value) {
    const value = form[field.key];
    if (isSecret(field)) {
      const stored = Boolean(state.settings.hasSecrets?.[field.key]);
      if (field.required && !stored && !value) problems.push(`${field.label} 不能为空`);
      continue;
    }
    if (field.required && !String(value ?? '').trim()) problems.push(`${field.label} 不能为空`);
  }
  return problems;
}

function buildPatch() {
  const patch = { [props.channel.enabledKey]: enabled.value };
  for (const field of props.channel.fields) {
    const value = form[field.key];
    if (isSecret(field)) {
      // '' means "leave the stored value alone"; null means "clear it".
      if (value === null) patch[field.key] = null;
      else if (value !== '') patch[field.key] = value;
      continue;
    }
    patch[field.key] = value;
  }
  return patch;
}

async function save() {
  errors.value = validate();
  if (errors.value.length) return false;
  await saveChannelSettings(buildPatch());
  return true;
}

async function submit() {
  busy.value = true;
  testResult.value = null;
  try {
    errors.value = validate();
    if (errors.value.length) return;

    // The switch enables the channel; the device itself still has to agree.
    // Do the browser half first: a rejected permission or a browser without a
    // push service must not leave the channel switched on with no devices.
    if (isPush.value) {
      if (enabled.value && state.push.supported && !state.push.subscribed) await enableBrowserPush();
      else if (!enabled.value && state.push.subscribed) await disableBrowserPush();
    }

    await saveChannelSettings(buildPatch());
    emit('close');
  } catch (problem) {
    testResult.value = { ok: false, message: describePushError(problem) };
  } finally {
    busy.value = false;
  }
}

async function runTest() {
  testing.value = true;
  testResult.value = null;
  errors.value = [];
  try {
    // Persist first so the test exercises exactly what is on screen.
    if (!(await save())) return;
    const result = await testChannel(props.channel.id);
    if (result.status !== 'sent') throw new Error(result.error || '发送失败');
    testResult.value = { ok: true, message: result.detail || '发送成功' };
  } catch (problem) {
    testResult.value = { ok: false, message: problem?.message ?? '发送失败' };
  } finally {
    testing.value = false;
  }
}

function clearSecret(field) {
  form[field.key] = null;
}
</script>

<template>
  <BaseModal
    :open="open"
    :title="channel ? `${channel.label}设置` : ''"
    :description="channel?.description"
    width="520px"
    @close="emit('close')"
  >
    <div v-if="channel" class="channel-form">
      <div class="channel-form__head">
        <span class="channel-form__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <path :d="ICONS[channel.id]" />
          </svg>
        </span>
        <ToggleSwitch
          v-model="enabled"
          :label="enabled ? '已启用' : '已关闭'"
          :hint="enabled ? '到期扫描时会通过该渠道推送' : '开启后才会推送'"
        />
      </div>

      <div v-if="isPush" class="push">
        <dl class="push__facts">
          <div class="push__fact">
            <dt class="caption">本设备</dt>
            <dd class="body-sm strong">{{ pushStatus.subscribed ? '已订阅推送' : '未订阅' }}</dd>
          </div>
          <div class="push__fact">
            <dt class="caption">通知权限</dt>
            <dd class="body-sm strong">{{ PERMISSION_LABELS[pushPermission] }}</dd>
          </div>
          <div class="push__fact">
            <dt class="caption">已订阅设备</dt>
            <dd class="body-sm strong mono">{{ pushStatus.devices }}</dd>
          </div>
        </dl>

        <p v-if="pushBlocked" class="hint">
          当前浏览器无法接收推送：请使用 HTTPS 打开，或先在浏览器设置里允许本站通知。
        </p>

        <button
          type="button"
          class="btn btn--secondary btn--sm"
          :disabled="busy || testing || (!pushStatus.subscribed && pushBlocked)"
          @click="toggleDevice"
        >
          {{ pushStatus.subscribed ? '关闭此设备的推送' : '在此设备开启推送' }}
        </button>
        <p v-if="busy" class="hint">正在与浏览器推送服务通信…（最长 15 秒）</p>
        <p v-else class="hint">开启后，到期扫描的结果会直接出现在系统通知中心；点击通知会打开提醒页面。</p>
      </div>

      <div v-for="field in fields" :key="field.key" class="field">
        <label class="label" :for="`ch-${field.key}`">
          {{ field.label }}
          <span v-if="!field.required" class="label__optional">选填</span>
        </label>

        <AppSelect
          v-if="field.type === 'select'"
          :id="`ch-${field.key}`"
          v-model="form[field.key]"
          :options="field.options"
        />

        <div v-else-if="isSecret(field)" class="secret">
          <input
            :id="`ch-${field.key}`"
            v-model="form[field.key]"
            class="input"
            :type="field.type === 'secret' ? 'password' : 'text'"
            autocomplete="new-password"
            :placeholder="state.settings.hasSecrets?.[field.key] ? '已配置，留空则不修改' : field.placeholder"
          />
          <button
            v-if="state.settings.hasSecrets?.[field.key] && form[field.key] !== null"
            type="button"
            class="btn btn--ghost btn--sm"
            @click="clearSecret(field)"
          >
            清除
          </button>
        </div>

        <input
          v-else
          :id="`ch-${field.key}`"
          v-model="form[field.key]"
          class="input"
          :type="field.type === 'url' ? 'url' : 'text'"
          :placeholder="field.placeholder"
        />

        <p v-if="form[field.key] === null" class="hint">保存后将清除已存储的凭据。</p>
        <p v-else-if="field.hint" class="hint">{{ field.hint }}</p>
      </div>

      <ul v-if="errors.length" class="errors">
        <li v-for="error in errors" :key="error" class="field-error">{{ error }}</li>
      </ul>

      <p v-if="testResult" class="test-result" :class="testResult.ok ? 'test-result--ok' : 'test-result--fail'">
        {{ testResult.ok ? '✓ 测试消息已发送' : `✕ ${testResult.message}` }}
      </p>
    </div>

    <template #footer>
      <button
        v-if="channel && channel.id !== 'inapp'"
        type="button"
        class="btn btn--secondary btn--sm"
        :disabled="testing || busy || (isPush && !pushStatus.subscribed)"
        @click="runTest"
      >
        {{ testing ? '发送中…' : '发送测试消息' }}
      </button>
      <span class="spacer" />
      <button type="button" class="btn btn--ghost btn--sm" @click="emit('close')">取消</button>
      <button type="button" class="btn btn--primary btn--sm btn--pill" :disabled="busy || testing" @click="submit">
        {{ busy ? '保存中…' : '保存' }}
      </button>
    </template>
  </BaseModal>
</template>

<style scoped>
.channel-form {
  display: flex;
  flex-direction: column;
  gap: var(--sp-md);
}

.channel-form__head {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-md);
  padding: var(--sp-sm) var(--sp-md);
  border: 1px solid var(--hairline);
  border-radius: var(--r-md);
  background: var(--canvas-soft);
}

.channel-form__icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 34px;
  height: 34px;
  border: 1px solid var(--hairline);
  border-radius: var(--r-md);
  background: var(--canvas);
  color: var(--ink);
}

.push {
  display: flex;
  flex-direction: column;
  gap: var(--sp-sm);
  padding: var(--sp-md);
  border: 1px solid var(--hairline);
  border-radius: var(--r-md);
}

.push__facts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--sp-sm);
  margin: 0;
}

.push__fact dt,
.push__fact dd {
  margin: 0;
}

.push__fact dd {
  margin-top: 2px;
}

.secret {
  display: flex;
  gap: var(--sp-xs);
  align-items: center;
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

.test-result {
  padding: var(--sp-xs) var(--sp-sm);
  border-radius: var(--r-sm);
  font-size: 13px;
  line-height: 20px;
}

.test-result--ok {
  background: var(--link-bg-soft);
  color: var(--link-deep);
}

.test-result--fail {
  background: var(--error-soft);
  color: var(--error-deep);
}

/* Thumb-sized target for the primary action inside the sheet. */
@media (max-width: 720px) {
  .push .btn {
    min-height: 44px;
  }
}
</style>
