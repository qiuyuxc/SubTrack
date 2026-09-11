<script setup>
defineProps({
  title: { type: String, required: true },
  description: { type: String, default: '' },
  actionLabel: { type: String, default: '' },
});

defineEmits(['action']);
</script>

<template>
  <div class="empty">
    <div class="empty__frame">
      <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="5" width="18" height="16" rx="3" />
        <path d="M3 10h18M8 3v4M16 3v4M8 15h4" />
      </svg>
    </div>
    <h3 class="display-sm">{{ title }}</h3>
    <p v-if="description" class="body-sm empty__desc">{{ description }}</p>
    <button v-if="actionLabel" type="button" class="btn btn--primary btn--sm btn--pill" @click="$emit('action')">
      {{ actionLabel }}
    </button>
  </div>
</template>

<style scoped>
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: var(--sp-sm);
  padding: var(--sp-4xl) var(--sp-lg);
}

.empty__frame {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  margin-bottom: var(--sp-xs);
  border: 1px solid var(--hairline);
  border-radius: var(--r-lg);
  background: var(--canvas-soft);
  color: var(--mute);
}

.empty__desc {
  max-width: 42ch;
}

.empty .btn {
  margin-top: var(--sp-xs);
}
</style>
