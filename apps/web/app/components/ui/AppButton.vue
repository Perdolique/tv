<template>
  <Button.Root v-slot="{ attrs }" :aria-label="ariaLabel" :disabled="disabled" renderless>
    <button
      ref="button"
      v-bind="buttonAttributes(attrs)"
      :class="$style.component"
      :data-icon-only="iconOnly || undefined"
      :data-size="size"
      :data-variant="variant"
      :disabled="disabled"
      :type="type"
    >
      <Icon v-if="icon" aria-hidden="true" mode="svg" :name="icon" />
      <slot />
    </button>
  </Button.Root>
</template>

<script lang="ts" setup>
  import { mergeProps, useAttrs, useTemplateRef } from 'vue'
  import { Button, type ButtonRootSlotProps } from '@vuetify/v0/components'

  interface Props {
    ariaLabel?: string;
    disabled?: boolean;
    icon?: string;
    iconOnly?: boolean;
    size?: 'small' | 'medium' | 'large';
    type?: 'button' | 'reset' | 'submit';
    variant?: 'primary' | 'secondary' | 'text';
  }

  const {
    ariaLabel,
    disabled,
    icon,
    iconOnly,
    size = 'large',
    type = 'button',
    variant = 'primary'
  } = defineProps<Props>()

  defineOptions({ inheritAttrs: false })

  const button = useTemplateRef('button')
  const inheritedAttrs = useAttrs()

  function buttonAttributes(attributes: ButtonRootSlotProps['attrs']) {
    return mergeProps(attributes, inheritedAttrs)
  }

  function focus(): void {
    button.value?.focus()
  }

  defineExpose({ focus })
</script>

<style module>
  @layer reset, vendor, tokens, base, components, utilities;

  @layer components {
    .component {
      --button-size: 3.5rem;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--space-2);
      min-block-size: var(--button-size);
      padding: var(--space-3) var(--space-6);
      border: 1px solid transparent;
      border-radius: var(--radius-md);
      font-weight: 700;
      cursor: pointer;
      transition:
        filter var(--duration-fast) var(--ease-standard),
        transform var(--duration-fast) var(--ease-standard);
    }

    .component[data-size='medium'] {
      --button-size: 3rem;
      padding: var(--space-2) var(--space-3);
      font-size: 1rem;
      font-weight: 600;
    }

    .component[data-size='small'] {
      --button-size: 2.75rem;
      padding: var(--space-2) var(--space-3);
      border-radius: var(--radius-sm);
      font-size: 0.875rem;
      font-weight: 600;
    }

    .component[data-icon-only] {
      inline-size: var(--button-size);
      padding: 0;
    }

    .component :global(svg) {
      flex: 0 0 auto;
      inline-size: 1.25rem;
      block-size: 1.25rem;
    }

    .component[data-variant='primary'] {
      background: var(--color-accent-fill);
      color: var(--color-on-accent);
    }

    .component[data-variant='secondary'] {
      border-color: var(--color-border-strong);
      background: var(--color-surface);
      color: var(--color-text-primary);
    }

    .component[data-variant='text'] {
      padding-inline: 0;
      background: transparent;
      color: var(--color-accent);
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
