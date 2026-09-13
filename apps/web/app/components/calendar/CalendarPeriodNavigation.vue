<template>
  <div :class="$style.component" :data-layout="layout" role="group" :aria-label="navigationLabel">
    <AppButton :aria-label="previousLabel" :disabled="isPreviousDisabled" variant="secondary" @click="emit('previous')">
      <Icon aria-hidden="true" mode="svg" name="hugeicons:arrow-left-01" />
      Previous
    </AppButton>
    <p :class="$style.label">{{ label }}</p>
    <AppButton :aria-label="nextLabel" :disabled="isNextDisabled" variant="secondary" @click="emit('next')">
      Next
      <Icon aria-hidden="true" mode="svg" name="hugeicons:arrow-right-01" />
    </AppButton>
    <AppButton :disabled="isTodayDisabled" variant="secondary" @click="emit('today')">Today</AppButton>
  </div>
</template>

<script lang="ts" setup>
  import { Icon } from '#components'
  import AppButton from '~/components/ui/AppButton.vue'

  interface Props {
    isNextDisabled: boolean;
    isPreviousDisabled: boolean;
    isTodayDisabled: boolean;
    label: string;
    layout: 'compact' | 'wide';
    navigationLabel: string;
    nextLabel: string;
    previousLabel: string;
  }

  interface Emits {
    next: [];
    previous: [];
    today: [];
  }

  const {
    isNextDisabled,
    isPreviousDisabled,
    isTodayDisabled,
    label,
    layout,
    navigationLabel,
    nextLabel,
    previousLabel
  } = defineProps<Props>()

  const emit = defineEmits<Emits>()
</script>

<style module>
  @layer reset, vendor, tokens, base, components, utilities;

  @layer components {
    .component {
      display: grid;
      grid-template-columns: 1fr 1fr;
      align-items: center;
      gap: var(--space-2);
    }
    .label {
      grid-column: 1 / -1;
      grid-row: 1;
      font-size: 1.125rem;
      font-weight: 700;
      text-align: center;
    }
    .component > :last-child { grid-column: 1 / -1; justify-self: center; }
    .component[data-layout='wide'] {
      grid-template-columns: auto minmax(10rem, auto) auto auto;
    }
    .component[data-layout='wide'] .label { grid-column: auto; grid-row: auto; }
    .component[data-layout='wide'] > :last-child { grid-column: auto; justify-self: auto; }
  }
</style>
