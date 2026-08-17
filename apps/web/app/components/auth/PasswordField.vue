<script setup lang="ts">
import { computed, useId, useTemplateRef } from 'vue'

interface Props {
  autocomplete: 'current-password' | 'new-password';
  error?: string;
  hint?: string;
  label: string;
  toggleLabel?: string;
  visible: boolean;
}

interface Emits {
  toggle: [];
}

const {
  autocomplete,
  error,
  hint,
  label,
  toggleLabel,
  visible
} = defineProps<Props>()

const emit = defineEmits<Emits>()
const model = defineModel<string>({ required: true })
const input = useTemplateRef('input')
const inputId = useId()
const hintId = useId()
const errorId = useId()
const inputType = computed(() => visible ? 'text' : 'password')
const isInvalid = computed(() => error !== undefined)
const hasError = computed(() => error !== undefined)
const hasHint = computed(() => hint !== undefined)
const hasToggle = computed(() => toggleLabel !== undefined)

const describedBy = computed(() => {
  const ids: string[] = []

  if (hasHint.value) {
    ids.push(hintId)
  }

  if (hasError.value) {
    ids.push(errorId)
  }

  return ids.length > 0 ? ids.join(' ') : undefined
})

function focus(): void {
  input.value?.focus()
}

function toggleVisibility(): void {
  emit('toggle')
}

defineExpose({ focus })
</script>

<template>
  <div :class="$style.component">
    <label :class="$style.label" :for="inputId">
      {{ label }}
    </label>

    <input
      :id="inputId"
      ref="input"
      v-model="model"
      :aria-describedby="describedBy"
      :aria-invalid="isInvalid"
      :autocomplete="autocomplete"
      :class="$style.input"
      required
      :type="inputType"
    >

    <p v-if="hasHint" :id="hintId" :class="$style.hint">
      {{ hint }}
    </p>

    <p v-if="hasError" :id="errorId" :class="$style.error">
      {{ error }}
    </p>

    <button
      v-if="hasToggle"
      :class="$style.toggle"
      type="button"
      @click="toggleVisibility"
    >
      {{ toggleLabel }}
    </button>
  </div>
</template>

<style module>
.component {
  display: grid;
  gap: 0.5rem;
}

.label {
  color: #e5e7eb;
  font-size: 0.9375rem;
  font-weight: 700;
}

.input {
  inline-size: 100%;
  min-block-size: 2.875rem;
  padding: 0.7rem 0.8rem;
  border: 1px solid #3b485d;
  border-radius: 0.625rem;
  background: #0b1220;
  color: #f8fafc;
  font: inherit;
}

.input[aria-invalid='true'] {
  border-color: #f87171;
}

.input:focus-visible,
.toggle:focus-visible {
  outline: 3px solid #60a5fa;
  outline-offset: 2px;
}

.hint {
  color: #94a3b8;
  font-size: 0.8125rem;
  line-height: 1.4;
}

.error {
  color: #fca5a5;
  font-size: 0.8125rem;
  line-height: 1.4;
}

.toggle {
  justify-self: start;
  padding: 0;
  border: 0;
  background: transparent;
  color: #93c5fd;
  cursor: pointer;
  font: inherit;
  font-size: 0.875rem;
  font-weight: 700;
}
</style>
