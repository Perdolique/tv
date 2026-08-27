<template>
  <div :class="$style.component">
    <label :class="$style.label" :for="inputId">
      Email
    </label>

    <div :class="$style.control">
      <svg
        :class="$style.icon"
        aria-hidden="true"
        fill="none"
        viewBox="0 0 24 24"
      >
        <rect height="16" rx="2" stroke="currentColor" stroke-width="1.75" width="20" x="2" y="4" />
        <path d="m4 7 8 6 8-6" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" />
      </svg>

      <input
        :id="inputId"
        ref="input"
        v-model="model"
        :aria-describedby="describedBy"
        :aria-invalid="isInvalid"
        autocomplete="email"
        :class="$style.input"
        inputmode="email"
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

    .label {
      font-weight: 600;
    }

    .control {
      position: relative;
      display: flex;
      align-items: center;
    }

    .icon {
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
      padding: var(--space-3) var(--space-4) var(--space-3) var(--space-12);
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

    .error {
      color: var(--color-danger);
      font-size: 0.875rem;
      line-height: 1.43;
    }
  }
</style>
