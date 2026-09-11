<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

/**
 * Custom listbox — replaces the native <select> so the control follows the
 * design system (radius, hairline, focus ring, dark mode) instead of the OS
 * chrome. Keyboard support mirrors a native select.
 */
const props = defineProps({
  modelValue: { type: [String, Number, Boolean], default: '' },
  options: { type: Array, required: true },
  placeholder: { type: String, default: '请选择' },
  id: { type: String, default: undefined },
  ariaLabel: { type: String, default: '' },
  size: { type: String, default: 'md' },
  block: { type: Boolean, default: true },
  disabled: { type: Boolean, default: false },
});

const emit = defineEmits(['update:modelValue', 'change']);

const root = ref(null);
const list = ref(null);
const open = ref(false);
const activeIndex = ref(-1);

const selectedIndex = computed(() => props.options.findIndex((option) => option.value === props.modelValue));
const selected = computed(() => props.options[selectedIndex.value] ?? null);
const label = computed(() => selected.value?.label ?? props.placeholder);

function scrollActiveIntoView() {
  nextTick(() => {
    list.value?.querySelector('[data-active="true"]')?.scrollIntoView?.({ block: 'nearest' });
  });
}

function openList() {
  if (props.disabled || open.value) return;
  open.value = true;
  activeIndex.value = selectedIndex.value >= 0 ? selectedIndex.value : 0;
  scrollActiveIntoView();
}

function closeList({ focus = false } = {}) {
  if (!open.value) return;
  open.value = false;
  if (focus) root.value?.querySelector('.listbox__button')?.focus();
}

function choose(index) {
  const option = props.options[index];
  if (!option) return;
  if (option.value !== props.modelValue) {
    emit('update:modelValue', option.value);
    emit('change', option.value);
  }
  closeList({ focus: true });
}

function move(delta) {
  if (!open.value) return openList();
  const count = props.options.length;
  activeIndex.value = ((activeIndex.value + delta) % count + count) % count;
  scrollActiveIntoView();
}

function onKeydown(event) {
  switch (event.key) {
    case 'ArrowDown': event.preventDefault(); move(1); break;
    case 'ArrowUp': event.preventDefault(); move(-1); break;
    case 'Home': event.preventDefault(); activeIndex.value = 0; scrollActiveIntoView(); break;
    case 'End': event.preventDefault(); activeIndex.value = props.options.length - 1; scrollActiveIntoView(); break;
    case 'Enter':
    case ' ':
      event.preventDefault();
      open.value ? choose(activeIndex.value) : openList();
      break;
    case 'Escape': if (open.value) { event.preventDefault(); closeList({ focus: true }); } break;
    case 'Tab': closeList(); break;
    default: break;
  }
}

function onDocumentPointerDown(event) {
  if (!root.value?.contains(event.target)) closeList();
}

watch(() => props.disabled, (disabled) => { if (disabled) closeList(); });
watch(() => props.options, () => { if (open.value) closeList(); });

onMounted(() => document.addEventListener('pointerdown', onDocumentPointerDown));
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocumentPointerDown));
</script>

<template>
  <div ref="root" class="listbox" :class="[`listbox--${size}`, { 'listbox--block': block, 'listbox--open': open, 'listbox--disabled': disabled }]">
    <button
      :id="id"
      type="button"
      class="listbox__button"
      role="combobox"
      :aria-expanded="open"
      :aria-label="ariaLabel || undefined"
      aria-haspopup="listbox"
      :disabled="disabled"
      @click="open ? closeList() : openList()"
      @keydown="onKeydown"
    >
      <span class="listbox__label" :class="{ 'listbox__label--placeholder': !selected }">{{ label }}</span>
      <svg class="listbox__chevron" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="m6 9 6 6 6-6" />
      </svg>
    </button>

    <Transition name="pop">
      <ul v-if="open" ref="list" class="listbox__list" role="listbox" :aria-activedescendant="`${id}-${activeIndex}`">
        <li
          v-for="(option, index) in options"
          :key="String(option.value)"
          :id="`${id}-${index}`"
          class="listbox__option"
          role="option"
          :aria-selected="option.value === modelValue"
          :data-active="index === activeIndex"
          @mouseenter="activeIndex = index"
          @click="choose(index)"
        >
          <span class="listbox__option-text">
            <span class="listbox__option-label">{{ option.label }}</span>
            <span v-if="option.hint" class="listbox__option-hint">{{ option.hint }}</span>
          </span>
          <svg v-if="option.value === modelValue" class="listbox__check" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="m5 12.5 4.5 4.5L19 7" />
          </svg>
        </li>
      </ul>
    </Transition>
  </div>
</template>

<style scoped>
.listbox {
  position: relative;
}

.listbox--block {
  width: 100%;
}

.listbox__button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-xs);
  width: 100%;
  height: 40px;
  padding: 0 var(--sp-xs) 0 var(--sp-sm);
  border: 1px solid var(--hairline);
  border-radius: var(--r-sm);
  background: var(--canvas);
  color: var(--ink);
  font-size: 14px;
  line-height: 20px;
  letter-spacing: -0.28px;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s var(--ease), box-shadow 0.15s var(--ease);
}

.listbox--sm .listbox__button {
  height: 36px;
  font-size: 13px;
}

.listbox__button:hover:not(:disabled) {
  border-color: var(--hairline-strong);
}

.listbox__button:focus-visible {
  outline: none;
  border-color: var(--ink);
  box-shadow: 0 0 0 3px rgba(0, 0, 0, 0.06);
}

[data-theme='dark'] .listbox__button:focus-visible {
  box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.12);
}

.listbox--open .listbox__button {
  border-color: var(--ink);
}

.listbox--disabled .listbox__button {
  opacity: 0.5;
  cursor: not-allowed;
}

.listbox__label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.listbox__label--placeholder {
  color: var(--mute);
}

.listbox__chevron {
  flex: none;
  color: var(--mute);
  transition: transform 0.18s var(--ease);
}

.listbox--open .listbox__chevron {
  transform: rotate(180deg);
}

.listbox__list {
  position: absolute;
  z-index: 40;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  max-height: 280px;
  margin: 0;
  padding: var(--sp-xxs);
  overflow-y: auto;
  list-style: none;
  border: 1px solid var(--hairline);
  border-radius: var(--r-md);
  background: var(--canvas);
  box-shadow: var(--shadow-lg);
}

.listbox__option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-xs);
  padding: var(--sp-xs) var(--sp-sm);
  border-radius: var(--r-sm);
  font-size: 14px;
  line-height: 20px;
  letter-spacing: -0.28px;
  color: var(--body);
  cursor: pointer;
}

.listbox__option[data-active='true'] {
  background: var(--canvas-soft-2);
  color: var(--ink);
}

.listbox__option[aria-selected='true'] {
  color: var(--ink);
  font-weight: 500;
}

.listbox__option-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.listbox__option-hint {
  font-size: 12px;
  line-height: 16px;
  color: var(--mute);
}

.listbox__check {
  flex: none;
  color: var(--link);
}

.pop-enter-active,
.pop-leave-active {
  transition: opacity 0.14s var(--ease), transform 0.14s var(--ease);
}

.pop-enter-from,
.pop-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
