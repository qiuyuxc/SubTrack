<script setup>
defineProps({
  eyebrow: { type: String, required: true },
  value: { type: String, required: true },
  caption: { type: String, default: '' },
  tone: { type: String, default: 'default' },
  hint: { type: String, default: '' },
});
</script>

<template>
  <article class="stat" :class="`stat--${tone}`">
    <header class="stat__head">
      <p class="eyebrow">{{ eyebrow }}</p>
      <span v-if="hint" class="badge" :class="tone === 'error' ? 'badge--error' : tone === 'warning' ? 'badge--warning' : ''">
        {{ hint }}
      </span>
    </header>
    <p class="stat__value display-lg tabular">{{ value }}</p>
    <p v-if="caption" class="body-sm stat__caption">{{ caption }}</p>
    <div class="stat__slot">
      <slot />
    </div>
  </article>
</template>

<style scoped>
.stat {
  display: flex;
  flex-direction: column;
  gap: var(--sp-xs);
  padding: var(--sp-lg);
  border: 1px solid var(--hairline);
  border-radius: var(--r-lg);
  background: var(--canvas);
  box-shadow: var(--shadow-xs);
  transition: border-color 0.15s var(--ease);
}

.stat:hover {
  border-color: var(--hairline-strong);
}

.stat__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-xs);
  min-height: 24px;
}

.stat__value {
  margin-top: var(--sp-xxs);
}

.stat__caption {
  min-height: 20px;
}

.stat__slot:empty {
  display: none;
}

.stat--error .stat__value {
  color: var(--error);
}

.stat--dark {
  background: var(--primary);
  border-color: var(--primary);
  color: var(--on-primary);
}

.stat--dark .eyebrow,
.stat--dark .stat__caption {
  color: color-mix(in srgb, var(--on-primary) 62%, transparent);
}

.stat--dark .stat__value {
  color: var(--on-primary);
}
</style>
