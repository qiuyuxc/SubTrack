<script setup>
import { useId } from 'vue';

defineProps({
  modelValue: { type: Boolean, default: false },
  label: { type: String, default: '' },
  hint: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
});

defineEmits(['update:modelValue']);

const id = useId();
</script>

<template>
  <label class="switch" :class="{ 'switch--disabled': disabled }" :for="id">
    <input
      :id="id"
      class="switch__input"
      type="checkbox"
      :checked="modelValue"
      :disabled="disabled"
      @change="$emit('update:modelValue', $event.target.checked)"
    />
    <span class="switch__track" aria-hidden="true"><span class="switch__thumb" /></span>
    <span v-if="label || hint" class="stack gap-xxs">
      <span v-if="label" class="body-sm strong">{{ label }}</span>
      <span v-if="hint" class="caption">{{ hint }}</span>
    </span>
  </label>
</template>
