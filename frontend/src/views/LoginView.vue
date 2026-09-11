<script setup>
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import MeshGradient from '../components/MeshGradient.vue';
import { login, state } from '../store.js';
import { ApiError } from '../api.js';

const router = useRouter();
const route = useRoute();

const username = ref('');
const password = ref('');
const error = ref('');
const busy = ref(false);
const usernameInput = ref(null);

async function submit() {
  if (busy.value) return;
  error.value = '';

  if (!username.value.trim() || !password.value) {
    error.value = '请输入用户名和密码';
    return;
  }

  busy.value = true;
  try {
    await login(username.value.trim(), password.value);
    const target = typeof route.query.redirect === 'string' ? route.query.redirect : '/dashboard';
    await router.replace(target);
  } catch (problem) {
    error.value = problem instanceof ApiError ? problem.message : '登录失败，请重试';
    password.value = '';
  } finally {
    busy.value = false;
  }
}

onMounted(() => usernameInput.value?.focus());
</script>

<template>
  <div class="login">
    <MeshGradient />
    <div class="login__panel">
      <div class="login__brand">
        <svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">
          <rect width="32" height="32" rx="7" fill="var(--primary)" />
          <path d="M10 12h12M10 16h8M10 20h12" stroke="var(--on-primary)" stroke-width="2.4" stroke-linecap="round" />
        </svg>
        <div class="stack">
          <span class="login__name">SubTrack</span>
          <span class="mono login__sub">subscriptions</span>
        </div>
      </div>

      <h1 class="display-md login__title">登录以查看订阅。</h1>
      <p class="body-sm login__lead">
        这是单人使用的管理后台，账号由服务端环境变量配置，不提供注册入口。
      </p>

      <form class="login__form" novalidate @submit.prevent="submit">
        <div class="field">
          <label class="label" for="login-user">用户名</label>
          <input
            id="login-user"
            ref="usernameInput"
            v-model="username"
            class="input"
            autocomplete="username"
            placeholder="admin"
            :disabled="busy"
          />
        </div>

        <div class="field">
          <label class="label" for="login-pass">密码</label>
          <input
            id="login-pass"
            v-model="password"
            class="input"
            type="password"
            autocomplete="current-password"
            placeholder="••••••••"
            :disabled="busy"
          />
        </div>

        <p v-if="error" class="field-error login__error" role="alert">{{ error }}</p>

        <button type="submit" class="btn btn--primary btn--lg login__submit" :disabled="busy">
          {{ busy ? '登录中…' : '登录' }}
        </button>
      </form>

      <p v-if="!state.auth.checked" class="caption login__hint">正在检查登录状态…</p>
    </div>
  </div>
</template>

<style scoped>
.login {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: var(--sp-xl) var(--sp-md);
  overflow: hidden;
  background: var(--canvas);
}

.login__panel {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 420px;
  padding: var(--sp-xl);
  border: 1px solid var(--hairline);
  border-radius: var(--r-lg);
  background: color-mix(in srgb, var(--canvas) 92%, transparent);
  backdrop-filter: saturate(180%) blur(12px);
  box-shadow: var(--shadow-lg);
}

.login__brand {
  display: flex;
  align-items: center;
  gap: var(--sp-sm);
  margin-bottom: var(--sp-xl);
}

.login__name {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.4px;
}

.login__sub {
  color: var(--mute);
  font-size: 11px;
}

.login__title {
  margin-bottom: var(--sp-xs);
}

.login__lead {
  margin-bottom: var(--sp-lg);
}

.login__form {
  display: flex;
  flex-direction: column;
  gap: var(--sp-md);
}

.login__error {
  padding: var(--sp-xs) var(--sp-sm);
  border: 1px solid var(--error-soft);
  border-radius: var(--r-sm);
  background: var(--error-soft);
  color: var(--error-deep);
}

.login__submit {
  width: 100%;
  margin-top: var(--sp-xs);
}

.login__hint {
  margin-top: var(--sp-md);
  text-align: center;
}
</style>
