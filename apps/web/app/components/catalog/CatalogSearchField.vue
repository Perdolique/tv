<template>
  <form :class="$style.component" role="search" @submit.prevent="emit('submit')">
    <label :for="inputId" :class="$style.label">Search movies and series</label>
    <div :class="$style.control">
      <Icon :class="$style.icon" aria-hidden="true" mode="svg" name="hugeicons:search-01" />
      <input
        :id="inputId"
        ref="input"
        :value="modelValue"
        :class="$style.input"
        type="text"
        inputmode="search"
        enterkeyhint="search"
        autocomplete="off"
        placeholder="Enter a title…"
        @input="onInput"
      >
      <button v-if="hasValue" :class="$style.clear" type="button" aria-label="Clear search" @click="clear">
        <Icon aria-hidden="true" mode="svg" name="hugeicons:cancel-01" />
      </button>
    </div>
  </form>
</template>

<script lang="ts" setup>
  import { Icon } from '#components'
  import { computed, useId, useTemplateRef } from 'vue'

  const { modelValue } = defineProps<{ modelValue: string }>()

  const emit = defineEmits<{
    'update:modelValue': [value: string];
    clear: [];
    submit: [];
  }>()

  const inputId = useId()
  const input = useTemplateRef('input')
  const hasValue = computed(() => modelValue !== '')

  function onInput(event: Event): void {
    if (event.target instanceof globalThis.HTMLInputElement) {
      emit('update:modelValue', event.target.value)
    }
  }

  function clear(): void {
    emit('clear')
    input.value?.focus()
  }
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
    }
    .input {
      /* Native input width must shrink inside the catalog column. */
      min-inline-size: 0;
      inline-size: 100%;
      block-size: 3.25rem;
      padding: var(--space-3) var(--space-12);
      border: 1px solid var(--color-border-strong);
      border-radius: var(--radius-md);
      background: var(--color-surface);
    }
    .icon {
      position: absolute;
      inset-inline-start: var(--space-4);
      inset-block-start: 1rem;
      font-size: 1.25rem;
      color: var(--color-text-secondary);
      pointer-events: none;
    }
    .clear {
      position: absolute;
      inset-inline-end: var(--space-1);
      inset-block-start: var(--space-1);
      display: grid;
      place-items: center;
      inline-size: 2.75rem;
      block-size: 2.75rem;
      border: 0;
      border-radius: var(--radius-sm);
      background: transparent;
      cursor: pointer;
    }
  }
</style>
