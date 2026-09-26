<template>
  <span :class="$style.component" :data-tone="tone"><slot /></span>
</template>

<script lang="ts">
  export type StatusChipTone = 'neutral' | 'success' | 'info' | 'warning' | 'danger'
</script>

<script lang="ts" setup>
  interface Props {
    tone?: StatusChipTone;
  }

  const { tone = 'neutral' } = defineProps<Props>()
</script>

<style module>
  @layer reset, vendor, tokens, base, components, utilities;

  @layer components {
    .component {
      --chip-color: var(--color-text-secondary);
      --chip-background: var(--color-status-neutral-background);
      --chip-border: var(--color-status-neutral-border);

      display: inline-flex;
      align-items: center;
      justify-self: start;
      padding: var(--space-1) var(--space-3);
      border: 1px solid var(--chip-border);
      border-radius: var(--radius-round);
      background: var(--chip-background);
      color: var(--chip-color);
      font-size: .75rem;
      font-weight: 600;
    }

    .component[data-tone='success'] {
      --chip-color: var(--color-success);
      --chip-background: var(--color-status-success-background);
      --chip-border: var(--color-status-success-border);
    }
    .component[data-tone='info'] {
      --chip-color: var(--color-info);
      --chip-background: var(--color-status-info-background);
      --chip-border: var(--color-status-info-border);
    }
    .component[data-tone='warning'] {
      --chip-color: var(--color-warning);
      --chip-background: var(--color-status-warning-background);
      --chip-border: var(--color-status-warning-border);
    }
    .component[data-tone='danger'] {
      --chip-color: var(--color-danger);
      --chip-background: var(--color-status-danger-background);
      --chip-border: var(--color-status-danger-border);
    }
  }
</style>
