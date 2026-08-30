<template>
  <AuthTextField
    ref="field"
    v-model="model"
    :autocomplete="autocomplete"
    :error="error"
    :hint="hint"
    :label="label"
    :type="inputType"
  >
    <template v-if="hasToggle" #trailing>
      <button
        :aria-label="toggleLabel"
        :class="$style.toggle"
        type="button"
        @click="toggleVisibility"
      >
        <Icon
          v-if="visible"
          :class="$style.toggleIcon"
          aria-hidden="true"
          mode="svg"
          name="hugeicons:view-off-slash"
        />
        <Icon
          v-else
          :class="$style.toggleIcon"
          aria-hidden="true"
          mode="svg"
          name="hugeicons:view"
        />
      </button>
    </template>
  </AuthTextField>
</template>

<script lang="ts" setup>
  import { Icon } from '#components'
  import { computed, useTemplateRef } from 'vue'
  import AuthTextField from '~/components/auth/AuthTextField.vue'

  interface Props {
    autocomplete: 'current-password' | 'new-password';
    error?: string;
    hint?: string;
    label: string;
    toggleLabel?: string;
    visible: boolean;
  }

  interface Emits {
    toggle: [];
  }

  const {
    autocomplete,
    error,
    hint,
    label,
    toggleLabel,
    visible
  } = defineProps<Props>()

  const emit = defineEmits<Emits>()
  const model = defineModel<string>({ required: true })
  const field = useTemplateRef('field')
  const inputType = computed(() => visible ? 'text' : 'password')
  const hasToggle = computed(() => toggleLabel !== undefined)

  function focus(): void {
    field.value?.focus()
  }

  function toggleVisibility(): void {
    emit('toggle')
  }

  defineExpose({ focus })
</script>

<style module>
  @layer reset, vendor, tokens, base, components, utilities;

  @layer components {
    .toggle {
      position: absolute;
      inset-block-start: var(--space-1);
      inset-inline-end: var(--space-2);
      display: grid;
      place-items: center;
      block-size: 2.75rem;
      inline-size: 2.75rem;
      padding: 0;
      border: 0;
      border-radius: var(--radius-round);
      background: transparent;
      color: var(--color-text-secondary);
      cursor: pointer;
      transition:
        background-color var(--duration-fast) var(--ease-standard),
        color var(--duration-fast) var(--ease-standard);
    }

    .toggle:hover {
      background: var(--color-surface-muted);
      color: var(--color-text-primary);
    }

    .toggleIcon {
      display: block;
      block-size: 1.5rem;
      inline-size: 1.5rem;
    }

    @media (prefers-reduced-motion: reduce) {
      .toggle {
        transition: none;
      }
    }
  }
</style>
