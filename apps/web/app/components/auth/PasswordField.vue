<template>
  <div :class="$style.component">
    <label :class="$style.label" :for="inputId">
      {{ label }}
    </label>

    <div :class="$style.control">
      <svg
        :class="$style.lockIcon"
        aria-hidden="true"
        fill="none"
        viewBox="0 0 24 24"
      >
        <rect height="12" rx="2" stroke="currentColor" stroke-width="1.75" width="16" x="4" y="9" />
        <path d="M8 9V7a4 4 0 1 1 8 0v2" stroke="currentColor" stroke-linecap="round" stroke-width="1.75" />
      </svg>

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

      <button
        v-if="hasToggle"
        :aria-label="toggleLabel"
        :class="$style.toggle"
        type="button"
        @click="toggleVisibility"
      >
        <svg
          v-if="visible"
          :class="$style.toggleIcon"
          aria-hidden="true"
          fill="none"
          viewBox="0 0 24 24"
        >
          <path d="m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 4.2A10.7 10.7 0 0 1 12 4c5.5 0 9 6 9 6a16.8 16.8 0 0 1-2.1 2.8M6.6 6.6C4.3 8.1 3 10 3 10s3.5 6 9 6c1 0 2-.2 2.9-.5" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" />
        </svg>
        <svg
          v-else
          :class="$style.toggleIcon"
          aria-hidden="true"
          fill="none"
          viewBox="0 0 24 24"
        >
          <path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6Z" stroke="currentColor" stroke-linejoin="round" stroke-width="1.75" />
          <circle cx="12" cy="12" r="2.5" stroke="currentColor" stroke-width="1.75" />
        </svg>
      </button>
    </div>

    <p v-if="hasHint" :id="hintId" :class="$style.hint">
      {{ hint }}
    </p>

    <p v-if="hasError" :id="errorId" :class="$style.error">
      {{ error }}
    </p>
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
  const hasError = computed(() => error !== undefined)
  const hasHint = computed(() => hint !== undefined)
  const hasToggle = computed(() => toggleLabel !== undefined)
  const isInvalid = computed(() => hasError.value)

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

<style module>
  @layer reset, vendor, tokens, base, components, utilities;

  @layer components {
    .component {
      display: grid;
      gap: var(--space-2);
    }

    .label {
      font-weight: 600;
    }

    .control {
      position: relative;
      display: flex;
      align-items: center;
    }

    .lockIcon {
      position: absolute;
      inset-inline-start: var(--space-4);
      block-size: 1.35rem;
      inline-size: 1.35rem;
      color: var(--color-text-secondary);
      pointer-events: none;
    }

    .input {
      min-inline-size: 0;
      inline-size: 100%;
      min-block-size: 3.5rem;
      padding: var(--space-3) 3.75rem var(--space-3) var(--space-12);
      border: 1px solid var(--color-border-strong);
      border-radius: var(--radius-md);
      background: var(--color-surface);
      color: var(--color-text-primary);
      transition:
        border-color var(--duration-fast) var(--ease-standard);
    }

    .input:hover {
      border-color: var(--color-accent);
    }

    .input:focus-visible {
      border-color: var(--color-focus);
    }

    .input[aria-invalid='true'] {
      border-color: var(--color-danger);
    }

    .toggle {
      position: absolute;
      inset-inline-end: var(--space-2);
      display: grid;
      place-items: center;
      block-size: 2.75rem;
      inline-size: 2.75rem;
      padding: 0;
      border: 0;
      border-radius: var(--radius-round);
      background: transparent;
      color: var(--color-text-secondary);
      cursor: pointer;
    }

    .toggle:hover {
      color: var(--color-accent);
    }

    .toggleIcon {
      block-size: 1.5rem;
      inline-size: 1.5rem;
    }

    .hint,
    .error {
      font-size: 0.875rem;
      line-height: 1.43;
    }

    .hint {
      color: var(--color-text-secondary);
    }

    .error {
      color: var(--color-danger);
    }
  }
</style>
