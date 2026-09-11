<script setup>
import BaseModal from './BaseModal.vue';

defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '确认操作' },
  description: { type: String, default: '' },
  confirmLabel: { type: String, default: '确认' },
  busy: { type: Boolean, default: false },
});

defineEmits(['confirm', 'close']);
</script>

<template>
  <BaseModal :open="open" :title="title" :description="description" width="440px" @close="$emit('close')">
    <slot />
    <template #footer>
      <button type="button" class="btn btn--ghost btn--sm" @click="$emit('close')">取消</button>
      <button type="button" class="btn btn--primary btn--sm btn--pill" :disabled="busy" @click="$emit('confirm')">
        {{ busy ? '处理中…' : confirmLabel }}
      </button>
    </template>
  </BaseModal>
</template>
