<template>
  <p
    ref="message"
    :class="$style.component"
    :data-tone="tone"
  >
    <slot />
  </p>
</template>

<script lang="ts" setup>
  import { useTemplateRef } from 'vue'

  interface Props {
    tone?: 'danger' | 'neutral';
  }

  const { tone = 'neutral' } = defineProps<Props>()
  const message = useTemplateRef('message')

  function focus(): void {
    message.value?.focus()
  }

  defineExpose({ focus })
</script>

<style module>
  @layer reset, vendor, tokens, base, components, utilities;

  @layer components {
    .component {
      padding: var(--space-3) var(--space-4);
      border-radius: var(--radius-sm);
      background: var(--color-surface-muted);
    }

    .component[data-tone='danger'] {
      color: var(--color-danger);
    }
  }
</style>
