<template>
  <form :class="$style.component" role="search" @submit.prevent="emit('submit')">
    <label :for="inputId" :class="$style.label">{{ label }}</label>
    <input :id="inputId" ref="input" v-model.trim="query" :class="$style.input" type="search" autocomplete="off" maxlength="100" minlength="2" required :placeholder="placeholder">
    <AppButton :class="$style.submit" :disabled="disabled" :aria-label="buttonLabel" :title="buttonLabel" type="submit" variant="secondary"><Icon aria-hidden="true" mode="svg" name="hugeicons:search-01" /></AppButton>
  </form>
</template>

<script lang="ts" setup>
  import { Icon } from '#components'
  import { useId, useTemplateRef } from 'vue'
  import AppButton from '~/components/ui/AppButton.vue'

  interface Props {
    label: string;
    buttonLabel: string;
    placeholder?: string;
    disabled?: boolean;
  }

  const { placeholder = 'Search title on TMDB' } = defineProps<Props>()

  interface Emits {
    submit: [];
  }

  const query = defineModel<string>({ required: true })
  const emit = defineEmits<Emits>()
  const inputId = useId()
  const input = useTemplateRef('input')

  function focus(): void {
    input.value?.focus()
  }

  defineExpose({ focus })
</script>

<style module>
  @layer reset, vendor, tokens, base, components, utilities;
  @layer components {
    .component { position: relative; }
    .label { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    .input { inline-size: 100%; block-size: 3.25rem; padding: var(--space-3) 3.75rem var(--space-3) var(--space-4); border: 1px solid var(--color-border-strong); border-radius: var(--radius-md); background: var(--color-surface); }
    .input::-webkit-search-cancel-button { display: none; }
    .submit[data-variant='secondary'] { position: absolute; inset-inline-end: var(--space-1); inset-block-start: var(--space-1); inline-size: 2.75rem; min-block-size: 2.75rem; padding: var(--space-2); border: 0; background: transparent; color: var(--color-text-primary); }
    .submit :global(svg) { inline-size: 1.5rem; block-size: 1.5rem; }
  }
</style>
