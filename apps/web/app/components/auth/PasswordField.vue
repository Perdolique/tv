<template>
  <div>
    <label :for="inputId">
      {{ label }}
    </label>

    <input
      :id="inputId"
      ref="input"
      v-model="model"
      :aria-describedby="describedBy"
      :aria-invalid="isInvalid"
      :autocomplete="autocomplete"
      required
      :type="inputType"
    >

    <p v-if="hasHint" :id="hintId">
      {{ hint }}
    </p>

    <p v-if="hasError" :id="errorId">
      {{ error }}
    </p>

    <button
      v-if="hasToggle"
      type="button"
      @click="toggleVisibility"
    >
      {{ toggleLabel }}
    </button>
  </div>
</template>

<script lang="ts" setup>
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
