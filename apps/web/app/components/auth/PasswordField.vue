<template>
  <div :class="$style.component">
    <div :class="$style.control">
      <label :class="$style.label" :for="inputId">
        <span :class="$style.labelText">{{ label }}</span>
      </label>

      <input
        :id="inputId"
        ref="input"
        v-model="model"
        :aria-describedby="describedBy"
        :aria-invalid="isInvalid"
        :autocomplete="autocomplete"
        :class="$style.input"
        placeholder=" "
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
        <Icon
          v-if="visible"
          :class="$style.toggleIcon"
          aria-hidden="true"
          mode="svg"
          name="hugeicons:view-off-slash"
        />
        <Icon
          v-else
          :class="$style.toggleIcon"
          aria-hidden="true"
          mode="svg"
          name="hugeicons:view"
        />
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
  import { Icon } from '#components'
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

    .control {
      position: relative;
    }

    .label {
      position: absolute;
      inset-inline-start: var(--space-4);
      inset-block-start: 0;
      z-index: 1;
      display: flex;
      align-items: center;
      block-size: 3.25rem;
      color: var(--color-text-secondary);
      line-height: 1.5;
      pointer-events: none;
      transition: color var(--duration-fast) var(--ease-standard);
    }

    .labelText {
      display: block;
      transform-origin: left center;
      transition: transform var(--duration-fast) var(--ease-standard);
    }

    .control:has(.input:focus, .input:not(:placeholder-shown), .input[aria-invalid='true']) .label {
      color: var(--color-text-primary);
    }

    .control:has(.input:focus, .input:not(:placeholder-shown), .input[aria-invalid='true']) .labelText {
      transform: translateY(-0.875rem) scale(0.75);
    }

    .control:has(.input[aria-invalid='true']) .label {
      color: var(--color-danger);
    }

    .input {
      min-inline-size: 0;
      inline-size: 100%;
      block-size: 3.25rem;
      padding: var(--space-3) 3.75rem var(--space-3) var(--space-4);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      background: var(--color-surface);
      color: var(--color-text-primary);
      transition:
        border-color var(--duration-fast) var(--ease-standard);
    }

    .input:focus,
    .input:not(:placeholder-shown),
    .input[aria-invalid='true'] {
      padding-block: 1.25rem var(--space-1);
      padding-inline-end: 3.75rem;
    }

    .input:hover {
      border-color: var(--color-border-strong);
    }

    .input:focus-visible {
      border-color: var(--color-border-strong);
      outline: 0.125rem solid var(--color-focus);
      outline-offset: 0.125rem;
    }

    .input[aria-invalid='true'] {
      border-color: var(--color-danger);
    }

    .toggle {
      position: absolute;
      inset-block-start: var(--space-1);
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
      transition:
        background-color var(--duration-fast) var(--ease-standard),
        color var(--duration-fast) var(--ease-standard);
    }

    .toggle:hover {
      background: var(--color-surface-muted);
      color: var(--color-text-primary);
    }

    .toggleIcon {
      display: block;
      flex: none;
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

    @media (prefers-reduced-motion: reduce) {
      .label,
      .labelText,
      .toggle {
        transition: none;
      }
    }
  }
</style>
