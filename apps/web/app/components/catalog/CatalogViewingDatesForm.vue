<template>
  <form ref="form" :class="$style.component" novalidate :aria-busy="isSaving" @submit.prevent="submit" @keydown.esc.prevent="cancel">
    <div v-if="showStatus" :class="$style.field">
      <label :for="statusId">Viewing status</label>
      <select :id="statusId" v-model="selectedStatus" :class="$style.input" :disabled="isSaving">
        <option value="watching">Watching</option>
        <option value="completed">Completed</option>
      </select>
    </div>
    <div v-if="isSeries" :class="$style.field">
      <label :for="startedId">Started on</label>
      <input :id="startedId" ref="startedField" v-model="startedOn" type="date" required :class="$style.input" :disabled="isSaving" :aria-invalid="hasStartError" :aria-describedby="startDescription">
      <p v-if="startError" :id="startErrorId" :class="$style.error">{{ startError }}</p>
    </div>
    <div v-if="showCompletion" :class="$style.field">
      <label :for="completedId">{{ completionLabel }}</label>
      <input :id="completedId" ref="completedField" v-model="completedOn" type="date" required :min="minimumCompletion" :class="$style.input" :disabled="isSaving" :aria-invalid="hasCompletionError" :aria-describedby="completionDescription">
      <p v-if="completionError" :id="completionErrorId" :class="$style.error">{{ completionError }}</p>
    </div>
    <div :class="$style.actions">
      <AppButton size="small" type="submit" :disabled="isSaving">{{ saveLabel }}</AppButton>
      <AppButton size="small" :disabled="isSaving" variant="secondary" @click="cancel">Cancel</AppButton>
    </div>
  </form>
</template>

<script lang="ts" setup>
  import { nextTick, onMounted, ref, shallowRef, toRef, useId, useTemplateRef, watch } from 'vue'
  import * as v from 'valibot'
  import { catalogViewingUpdateSchema, type CatalogViewingDraft } from '@tv/shared/catalog-viewings'
  import AppButton from '~/components/ui/AppButton.vue'
  import { getLocalCalendarDate } from '~/utils/calendar-date.ts'

  interface Props {
    initial: CatalogViewingDraft;
    type: 'movie' | 'series';
    completedOnly?: boolean;
    isSaving: boolean;
    fields: Record<string, string>;
  }
  interface Emits {
    save: [dates: CatalogViewingDraft];
    cancel: [];
  }

  const { initial, type, completedOnly, fields, isSaving } = defineProps<Props>()
  const emit = defineEmits<Emits>()
  const today = getLocalCalendarDate()
  const selectedStatus = shallowRef(initial.status)
  const startedOn = shallowRef(initial.startedOn ?? today)
  const completedOn = shallowRef(initial.completedOn ?? today)
  const validation = ref<Record<string, string>>({})
  const statusId = useId()
  const startedId = useId()
  const completedId = useId()
  const startErrorId = useId()
  const completionErrorId = useId()
  const form = useTemplateRef('form')
  const startedField = useTemplateRef('startedField')
  const completedField = useTemplateRef('completedField')
  const isSeries = toRef(() => type === 'series')
  const showStatus = toRef(() => isSeries.value && !completedOnly)
  const showCompletion = toRef(() => !isSeries.value || selectedStatus.value === 'completed')
  const completionLabel = toRef(() => isSeries.value ? 'Completed on' : 'Watched on')
  const minimumCompletion = toRef(() => isSeries.value ? startedOn.value : undefined)
  const startError = toRef(() => validation.value.startedOn ?? fields.startedOn)
  const completionError = toRef(() => validation.value.completedOn ?? fields.completedOn)
  const hasStartError = toRef(() => Boolean(startError.value))
  const hasCompletionError = toRef(() => Boolean(completionError.value))
  const startDescription = toRef(() => startError.value ? startErrorId : undefined)
  const completionDescription = toRef(() => completionError.value ? completionErrorId : undefined)
  const saveLabel = toRef(() => isSaving ? 'Saving…' : 'Save viewing')

  function focusError(): void {
    if (startError.value) { startedField.value?.focus() }
    else if (completionError.value) { completedField.value?.focus() }
  }

  watch(() => fields, async () => {
    const owner = globalThis.document.activeElement
    const formHadFocus = form.value?.contains(owner) === true
    const ownedFocus = owner === globalThis.document.body || formHadFocus

    await nextTick()

    const { activeElement, body } = globalThis.document
    const ownsFocus = activeElement === owner || activeElement === body

    if (ownedFocus && ownsFocus) { focusError() }
  })

  onMounted(() => { if (isSeries.value) { startedField.value?.focus() } else { completedField.value?.focus() } })

  function cancel(): void { if (!isSaving) { emit('cancel') } }
  async function submit(): Promise<void> {
    const status = showStatus.value ? selectedStatus.value : 'completed'
    const requestId = globalThis.crypto.randomUUID()
    const nextStartedOn = isSeries.value ? startedOn.value : null
    const nextCompletedOn = status === 'completed' ? completedOn.value : null

    const result = v.safeParse(catalogViewingUpdateSchema, {
      requestId,
      revision: 1,
      status,
      startedOn: nextStartedOn,
      completedOn: nextCompletedOn
    })

    validation.value = {}

    if (isSeries.value && startedOn.value === '') { validation.value.startedOn = 'Choose a start date.' }

    if (!result.success) {
      const flattened = v.flatten(result.issues)
      const errors = Object.entries(flattened.nested ?? {})

      for (const [name, messages] of errors) {
        const [message] = messages ?? []

        if (message !== undefined) { validation.value[name] = message }
      }
    }

    if (!result.success || validation.value.startedOn) {
      await nextTick()
      focusError()

      return
    }

    emit('save', {
      status: result.output.status,
      startedOn: result.output.startedOn,
      completedOn: result.output.completedOn
    })
  }
</script>

<style module>
  @layer reset, vendor, tokens, base, components, utilities;
  @layer components {
    .component { display: grid; gap: var(--space-4); }
    .field { display: grid; align-content: start; gap: var(--space-2); min-inline-size: 0; }
    .input { inline-size: 100%; min-block-size: 2.75rem; padding: var(--space-3); border: 1px solid var(--color-border-strong); border-radius: var(--radius-md); background: var(--color-surface); color: var(--color-text-primary); font: inherit; }
    .error { color: var(--color-danger); font-size: 0.875rem; }
    .actions { display: flex; flex-wrap: wrap; gap: var(--space-3); }
  }
</style>
