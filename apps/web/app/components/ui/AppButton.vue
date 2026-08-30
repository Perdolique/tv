<template>
  <button
    ref="button"
    :class="$style.component"
    :data-variant="variant"
    :disabled="disabled"
    :type="type"
  >
    <slot />
  </button>
</template>

<script lang="ts" setup>
  import { useTemplateRef } from 'vue'

  interface Props {
    disabled?: boolean;
    type?: 'button' | 'reset' | 'submit';
    variant?: 'primary' | 'secondary';
  }

  const {
    disabled = false,
    type = 'button',
    variant = 'primary'
  } = defineProps<Props>()

  const button = useTemplateRef('button')

  function focus(): void {
    button.value?.focus()
  }

  defineExpose({ focus })
</script>

<style module>
  @layer reset, vendor, tokens, base, components, utilities;

  @layer components {
    .component {
      min-block-size: 3.5rem;
      padding: var(--space-3) var(--space-6);
      border-radius: var(--radius-md);
      font-weight: 700;
      cursor: pointer;
      transition:
        filter var(--duration-fast) var(--ease-standard),
        transform var(--duration-fast) var(--ease-standard);
    }

    .component[data-variant='primary'] {
      border: 0;
      background: var(--color-accent-fill);
      color: var(--color-on-accent);
    }

    .component[data-variant='secondary'] {
      border: 1px solid var(--color-border-strong);
      background: var(--color-surface);
      color: var(--color-text-primary);
    }

    .component:hover:not(:disabled) {
      filter: brightness(0.96);
    }

    .component:active:not(:disabled) {
      transform: translateY(0.0625rem);
    }

    .component:disabled {
      border-color: var(--color-border);
      background: var(--color-surface-muted);
      color: var(--color-text-secondary);
      cursor: not-allowed;
    }

    @media (prefers-reduced-motion: reduce) {
      .component {
        transition: none;
      }
    }
  }
</style>
