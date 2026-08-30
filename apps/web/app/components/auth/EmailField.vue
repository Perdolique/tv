<template>
  <div :class="$style.component">
    <div :class="$style.control">
      <label :class="$style.label" :for="inputId">
        <span :class="$style.labelText">Email</span>
      </label>

      <input
        :id="inputId"
        ref="input"
        v-model="model"
        :aria-describedby="describedBy"
        :aria-invalid="isInvalid"
        autocomplete="email"
        :class="$style.input"
        inputmode="email"
        placeholder=" "
        required
        type="email"
      >
    </div>

    <p v-if="hasError" :id="errorId" :class="$style.error">
      {{ error }}
    </p>
  </div>
</template>

<script lang="ts" setup>
  import { computed, useId, useTemplateRef } from 'vue'

  interface Props {
    error?: string;
  }

  const { error } = defineProps<Props>()
  const model = defineModel<string>({ required: true })
  const input = useTemplateRef('input')
  const inputId = useId()
  const errorId = useId()
  const hasError = computed(() => error !== undefined)
  const isInvalid = computed(() => hasError.value)
  const describedBy = computed(() => hasError.value ? errorId : undefined)

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

    .error {
      color: var(--color-danger);
      font-size: 0.875rem;
      line-height: 1.43;
    }

    @media (prefers-reduced-motion: reduce) {
      .label,
      .labelText {
        transition: none;
      }
    }
  }
</style>
