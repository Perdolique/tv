<template>
  <form :class="$style.component" novalidate @submit.prevent="submit">
    <slot />

    <AppButton :disabled="disabled" type="submit">
      {{ submitLabel }}
    </AppButton>
  </form>
</template>

<script lang="ts" setup>
  import AppButton from '~/components/ui/AppButton.vue'

  interface Props {
    disabled: boolean;
    submitLabel: string;
  }

  interface Emits {
    submit: [];
  }

  defineProps<Props>()

  const emit = defineEmits<Emits>()

  function submit(): void {
    emit('submit')
  }
</script>

<style module>
  @layer reset, vendor, tokens, base, components, utilities;

  @layer components {
    .component {
      display: grid;
      gap: var(--space-5);
    }
  }
</style>
