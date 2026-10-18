<template>
  <section :class="$style.component" aria-label="Current series viewing">
    <AppButton v-if="canCancelRewatch" ref="trigger" :class="$style.trigger" icon="hugeicons:arrow-turn-backward" size="medium" variant="secondary" :disabled="isUndoDisabled" @click="undo">Cancel rewatch</AppButton>
    <Dialog.Root :key="dialogKey" :model-value="isDialogOpen" @update:model-value="setDialogOpen">
      <Dialog.Activator v-if="showStartRewatch" v-slot="{ attrs }" renderless>
        <AppButton ref="trigger" v-bind="attrs" :class="$style.trigger" icon="hugeicons:reload" size="medium" variant="secondary" :disabled="isStartDisabled" @click="prepareRewatch">Start rewatch</AppButton>
      </Dialog.Activator>
      <Dialog.Content :class="$style.dialog" :blocking="isSaving" :close-on-click-outside="false" @cancel="cancel">
        <form ref="content" :class="$style.content" @submit.prevent="save">
          <Dialog.Title :class="$style.heading">Start a rewatch</Dialog.Title>
          <Dialog.Description :class="$style.supporting">{{ description }}</Dialog.Description>
          <div v-if="mustComplete" :class="$style.field">
            <label :for="completedId">Complete current viewing on</label>
            <input :id="completedId" v-model="completedOn" type="date" required :min="minimumCompletion" :class="$style.input" :disabled="areFieldsDisabled">
          </div>
          <div :class="$style.field">
            <label :for="startedId">Start rewatch on</label>
            <input :id="startedId" v-model="startedOn" type="date" required :class="$style.input" :disabled="areFieldsDisabled">
          </div>
          <AppMessage v-if="saveError" role="alert" tone="danger">{{ saveError }}</AppMessage>
          <AppButton v-if="hasUnconfirmed" ref="dialogRetry" size="small" variant="secondary" :disabled="isSaving" @click="retry">Retry rewatch</AppButton>
          <div :class="$style.actions">
            <AppButton ref="confirmationButton" type="submit" :disabled="areFieldsDisabled" :aria-busy="isSaving || undefined">{{ confirmationLabel }}</AppButton>
            <AppButton autofocus variant="secondary" :disabled="isSaving" @click="setDialogOpen(false)">Cancel</AppButton>
          </div>
          <p v-if="isSaving" :class="$style.supporting" role="status">Saving your new viewing…</p>
        </form>
      </Dialog.Content>
    </Dialog.Root>
    <AppMessage v-if="showUndoError" role="alert" tone="danger">{{ saveError }}</AppMessage>
    <AppButton v-if="showUndoRetry" ref="undoRetry" size="small" variant="secondary" :disabled="isSaving" @click="retry">Retry canceling rewatch</AppButton>
  </section>
</template>

<script setup lang="ts">
  import { computed, nextTick, shallowRef, toRef, useId, useTemplateRef, watch } from 'vue'
  import { Dialog } from '@vuetify/v0/components'
  import type { CatalogViewingsState } from '~/composables/use-catalog-viewings.ts'
  import AppButton from '~/components/ui/AppButton.vue'
  import AppMessage from '~/components/ui/AppMessage.vue'
  import { getLocalCalendarDate } from '~/utils/calendar-date.ts'

  interface Props {
    state: CatalogViewingsState;
  }

  const { state } = defineProps<Props>()
  const { currentViewing, isSaving, saveError } = state
  const content = useTemplateRef('content')
  const trigger = useTemplateRef('trigger')
  const dialogRetry = useTemplateRef('dialogRetry')
  const undoRetry = useTemplateRef('undoRetry')
  const confirmationButton = useTemplateRef('confirmationButton')
  const completedId = useId()
  const startedId = useId()
  const completedOn = shallowRef('')
  const startedOn = shallowRef('')
  const isUndoAction = shallowRef(false)
  const isDialogOpen = shallowRef(false)
  const dialogKey = computed(() => isDialogOpen.value ? 'open' : 'closed')
  const canCancelRewatch = toRef(() => currentViewing.value?.canCancelRewatch === true)
  const showStartRewatch = computed(() => !canCancelRewatch.value && currentViewing.value !== null)
  const mustComplete = toRef(() => currentViewing.value?.status === 'watching')
  const minimumCompletion = toRef(() => currentViewing.value?.startedOn ?? undefined)
  const confirmationLabel = toRef(() => mustComplete.value ? 'Complete current viewing and start rewatch' : 'Start rewatch')
  const description = toRef(() => mustComplete.value ? 'Complete this viewing and start again with no scores or watched episodes. Your earlier viewing stays in history.' : 'Start again with no scores or watched episodes. Your earlier viewing stays in history.')
  const showUndoError = toRef(() => isUndoAction.value && saveError.value !== '')
  const hasUnconfirmed = toRef(() => state.unconfirmedMutation.value?.key === 'create:current')
  const showUndoRetry = toRef(() => state.unconfirmedMutation.value?.key === 'rewatch:cancel')
  const areFieldsDisabled = toRef(() => isSaving.value || hasUnconfirmed.value)

  const isUndoDisabled = toRef(() => {
    if (isSaving.value) { return true }

    return state.isMutationBlocked('rewatch:cancel')
  })

  const isStartDisabled = toRef(() => {
    if (isSaving.value) { return true }

    return state.isMutationBlocked('create:current')
  })

  function prepareRewatch(): void {
    isUndoAction.value = false
    saveError.value = ''
    completedOn.value = getLocalCalendarDate()
    startedOn.value = getLocalCalendarDate()
  }
  function setDialogOpen(value: boolean): void { if (!isSaving.value) { isDialogOpen.value = value } }
  function cancel(event: Event): void { if (isSaving.value) { event.preventDefault() } }
  function restoreFocus(): void {
    const { activeElement, body } = globalThis.document
    const ownsFocus = activeElement === body || content.value?.contains(activeElement) === true

    if (ownsFocus) { trigger.value?.focus() }
  }
  async function save(): Promise<void> {
    const completion = mustComplete.value ? completedOn.value : undefined

    const saved = await state.create('current', {
      status: 'watching',
      startedOn: startedOn.value,
      completedOn: null
    }, completion)

    if (saved) { isDialogOpen.value = false }
  }
  async function retry(): Promise<void> {
    const focusOwner = globalThis.document.activeElement
    const savedViewingId = currentViewing.value?.id
    const wasDialogOpen = isDialogOpen.value
    const saved = await state.retryMutation()

    if (saved) {
      isDialogOpen.value = false

      return
    }

    await nextTick()

    const sameViewing = currentViewing.value?.id === savedViewingId
    const sameDialog = isDialogOpen.value === wasDialogOpen
    const { activeElement, body } = globalThis.document
    const ownsFocus = activeElement === focusOwner || activeElement === body

    if (!sameViewing || !sameDialog || !ownsFocus) { return }

    if (wasDialogOpen) {
      if (hasUnconfirmed.value) { dialogRetry.value?.focus() }
      else { confirmationButton.value?.focus() }
    } else if (showUndoRetry.value) { undoRetry.value?.focus() }
    else { trigger.value?.focus() }
  }
  async function undo(): Promise<void> {
    const viewing = currentViewing.value

    if (viewing === null) { return }

    const focusOwner = globalThis.document.activeElement

    isUndoAction.value = true

    const id = encodeURIComponent(viewing.catalogItemId)
    const requestId = globalThis.crypto.randomUUID()

    const body = {
      requestId,
      currentViewingId: viewing.id,
      contextVersion: state.summary.value.contextVersion
    }

    const url = `/api/catalog/items/${id}/rewatch`

    await state.mutate({
      key: 'rewatch:cancel',
      url,
      method: 'DELETE',
      body,
      operation: 'viewing'
    })

    await nextTick()

    const { activeElement, body: documentBody } = globalThis.document

    if (activeElement === focusOwner || activeElement === documentBody) { trigger.value?.focus() }
  }

  watch([currentViewing, isSaving], ([viewing, saving]) => { if (viewing === null && !saving) { isDialogOpen.value = false } }, { flush: 'sync' })

  watch(isDialogOpen, async open => {
    if (!open) {
      await nextTick()

      if (!isDialogOpen.value) { restoreFocus() }
    }
  })
</script>

<style module>
  @layer reset, vendor, tokens, base, components, utilities;
  @layer components {
    .component { display: grid; justify-items: start; gap: var(--space-2); }
    .trigger { white-space: nowrap; }
    .supporting { color: var(--color-text-secondary); font-size: 0.875rem; }
    .dialog { inline-size: min(calc(100% - var(--space-8)), 34rem); margin: auto; padding: var(--space-6); border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface); color: var(--color-text-primary); box-shadow: var(--shadow-float); }
    .dialog::backdrop { background: var(--color-backdrop); }
    .content { display: grid; gap: var(--space-5); }
    .field { display: grid; gap: var(--space-2); }
    .input { inline-size: 100%; min-block-size: 2.75rem; padding: var(--space-2); border: 1px solid var(--color-border-strong); border-radius: var(--radius-md); background: var(--color-surface); }
    .heading { font-size: 1.5rem; font-weight: 600; }
    .actions { display: grid; gap: var(--space-3); }
  }
</style>
