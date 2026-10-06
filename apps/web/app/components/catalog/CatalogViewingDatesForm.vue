<template>
  <form :class="$style.component" novalidate :aria-busy="isSaving" @submit.prevent="submit" @keydown.esc.prevent="cancel">
    <p>Dates are optional. Leave them empty when unknown.</p>
    <div :class="$style.fields">
      <div :class="$style.field">
        <label :for="startedId">Started on</label>
        <input :id="startedId" ref="startedField" v-model="startedOn" type="date" :class="$style.input" :disabled="isSaving" :aria-invalid="!!startedError" :aria-describedby="startedDescription">
        <p v-if="startedError" :id="startedErrorId" :class="$style.error">{{ startedError }}</p>
      </div>
      <div :class="$style.field">
        <label :for="completedId">Completed on</label>
        <input :id="completedId" ref="completedField" v-model="completedOn" type="date" :class="$style.input" :disabled="isSaving" :aria-invalid="!!completedError" :aria-describedby="completedDescription">
        <p v-if="completedError" :id="completedErrorId" :class="$style.error">{{ completedError }}</p>
      </div>
    </div>
    <div :class="$style.actions">
      <AppButton type="submit" :disabled="isSaving">{{ saveLabel }}</AppButton>
      <AppButton :disabled="isSaving" variant="secondary" @click="cancel">Cancel</AppButton>
    </div>
  </form>
</template>

<script lang="ts" setup>
  import { computed, nextTick, onMounted, ref, useId, useTemplateRef, watch } from 'vue'
  import * as v from 'valibot'
  import { catalogViewingUpdateSchema, type CatalogViewingDates } from '@tv/shared/catalog-viewings'
  import AppButton from '~/components/ui/AppButton.vue'

  interface Props {
    initial: CatalogViewingDates;
    isSaving: boolean;
    fields: Record<string, string>;
  }

  interface Emits {
    save: [dates: CatalogViewingDates];
    cancel: [];
  }

  const { initial, fields, isSaving } = defineProps<Props>()
  const emit = defineEmits<Emits>()
  const startedOn = ref(initial.startedOn ?? '')
  const completedOn = ref(initial.completedOn ?? '')
  const validation = ref<Record<string, string>>({})
  const startedId = useId()
  const completedId = useId()
  const startedErrorId = useId()
  const completedErrorId = useId()
  const startedField = useTemplateRef('startedField')
  const completedField = useTemplateRef('completedField')
  const startedError = computed(() => validation.value.startedOn ?? fields.startedOn)
  const completedError = computed(() => validation.value.completedOn ?? fields.completedOn)
  const startedDescription = computed(() => startedError.value ? startedErrorId : undefined)
  const completedDescription = computed(() => completedError.value ? completedErrorId : undefined)
  const saveLabel = computed(() => isSaving ? 'Saving…' : 'Save viewing')

  function focusError(): void {
    if (startedError.value) { startedField.value?.focus() }
    else if (completedError.value) { completedField.value?.focus() }
  }

  watch(() => fields, async () => {
    await nextTick()
    focusError()
  })

  onMounted(() => { startedField.value?.focus() })

  function cancel(): void {
    if (!isSaving) { emit('cancel') }
  }

  async function submit(): Promise<void> {
    const result = v.safeParse(catalogViewingUpdateSchema, {
      startedOn: startedOn.value || null,
      completedOn: completedOn.value || null,
      revision: 1
    })

    validation.value = {}

    if (!result.success) {
      const flattened = v.flatten(result.issues)
      const errors = Object.entries(flattened.nested ?? {})

      for (const [name, messages] of errors) {
        const [message] = messages ?? []

        if (message !== undefined) {
          validation.value[name] = message
        }
      }

      await nextTick()
      focusError()

      return
    }

    emit('save', {
      startedOn: result.output.startedOn,
      completedOn: result.output.completedOn
    })
  }
</script>

<style module>
  @layer reset, vendor, tokens, base, components, utilities;
  @layer components {
    .component { display: grid; gap: var(--space-4); }
    .fields { display: flex; flex-wrap: wrap; gap: var(--space-4); }
    .field { display: grid; align-content: start; gap: var(--space-2); flex: 1 1 12rem; min-inline-size: 0; }
    .input { inline-size: 100%; min-block-size: 3.5rem; padding: var(--space-3); border: 1px solid var(--color-border-strong); border-radius: var(--radius-md); background: var(--color-surface); color: var(--color-text-primary); }
    .error { color: var(--color-danger); font-size: 0.875rem; }
    .actions { display: flex; flex-wrap: wrap; gap: var(--space-3); }
  }
</style>
