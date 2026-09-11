<script setup>
import { computed } from 'vue';
import { statusMeta } from '../lib/format.js';

const props = defineProps({
  item: { type: Object, required: true },
});

const meta = computed(() => statusMeta(props.item));
</script>

<template>
  <span class="badge" :class="`badge--${meta.tone}`">
    <span class="badge__dot" />
    {{ meta.label }}
  </span>
</template>
