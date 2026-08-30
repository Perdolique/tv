<template>
  <div :class="$style.component">
    <div :class="$style.control" :data-has-trailing="hasTrailing || undefined">
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
        :inputmode="inputmode"
        placeholder=" "
        required
        :type="type"
      >

      <slot name="trailing" />
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
  import { computed, useId, useSlots, useTemplateRef } from 'vue'

  interface Props {
    autocomplete: 'current-password' | 'email' | 'new-password';
    error?: string;
    hint?: string;
    inputmode?: 'email';
    label: string;
    type: 'email' | 'password' | 'text';
  }

  const {
    autocomplete,
    error,
    hint,
    inputmode,
    label,
    type
  } = defineProps<Props>()

  const model = defineModel<string>({ required: true })
  const slots = useSlots()
  const input = useTemplateRef('input')
  const inputId = useId()
  const hintId = useId()
  const errorId = useId()
  const hasError = computed(() => error !== undefined)
  const hasHint = computed(() => hint !== undefined)
  const hasTrailing = slots.trailing !== undefined
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
      padding: var(--space-3) var(--space-4);
      border: 1px solid var(--color-border-strong);
      border-radius: var(--radius-md);
      background: var(--color-surface);
      color: var(--color-text-primary);
      transition: border-color var(--duration-fast) var(--ease-standard);
    }

    .control[data-has-trailing] .input {
      padding-inline-end: 3.75rem;
    }

    .input:focus,
    .input:not(:placeholder-shown),
    .input[aria-invalid='true'] {
      padding-block: 1.25rem var(--space-1);
    }

    .input:focus-visible {
      outline: 0.125rem solid var(--color-focus);
      outline-offset: 0.125rem;
    }

    .input[aria-invalid='true'] {
      border-color: var(--color-danger);
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
      .labelText {
        transition: none;
      }
    }
  }
</style>
