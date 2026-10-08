<template>
  <section :class="$style.component" aria-label="Current series viewing">
    <AppButton v-if="canCancelRewatch" ref="trigger" :class="$style.trigger" icon="hugeicons:arrow-turn-backward" size="medium" variant="secondary" :disabled="isSaving" :aria-busy="isSaving || undefined" @click="undo">Cancel rewatch</AppButton>
    <!-- Isolate queued native close events from a later opening's dialog context. -->
    <Dialog.Root :key="dialogKey" :model-value="isDialogOpen" @update:model-value="setDialogOpen">
      <Dialog.Activator v-if="showStartRewatch" v-slot="{ attrs }" renderless>
        <AppButton ref="trigger" v-bind="attrs" :class="$style.trigger" icon="hugeicons:reload" size="medium" variant="secondary" :disabled="isRewatchDisabled" @click="prepareRewatch">Start rewatch</AppButton>
      </Dialog.Activator>
      <Dialog.Content :class="$style.dialog" :blocking="isSaving" :close-on-click-outside="false" @cancel="cancel" @keydown.esc="preventSavingDismissal">
        <div ref="content" :class="$style.content">
          <Dialog.Title :class="$style.heading">Start a rewatch</Dialog.Title>
          <Dialog.Description :class="$style.supporting">Start again with no watched episodes? Your earlier marks stay in history.</Dialog.Description>
          <AppMessage v-if="rewatchError" role="alert" tone="danger">{{ rewatchError }}</AppMessage>
          <div :class="$style.actions">
            <AppButton :disabled="isSaving" :aria-busy="isSaving || undefined" @click="save">Start rewatch</AppButton>
            <AppButton autofocus variant="secondary" :disabled="isSaving" @click="setDialogOpen(false)">Cancel</AppButton>
          </div>
          <p v-if="isSaving" :class="$style.supporting" role="status">Saving your new viewing…</p>
        </div>
      </Dialog.Content>
    </Dialog.Root>
    <AppMessage v-if="showUndoError" role="alert" tone="danger">{{ rewatchError }}</AppMessage>
  </section>
</template>

<script setup lang="ts">
  import { computed, nextTick, shallowRef, useTemplateRef, watch } from 'vue'
  import { Dialog } from '@vuetify/v0/components'
  import type { CatalogEpisodeWatchesState } from '~/composables/use-catalog-episode-watches.ts'
  import AppButton from '~/components/ui/AppButton.vue'
  import AppMessage from '~/components/ui/AppMessage.vue'

  interface Props {
    state: CatalogEpisodeWatchesState;
  }

  const { state } = defineProps<Props>()
  const { canCancelRewatch, rewatchError, currentViewing, isSaving, status, watchedCount } = state
  const content = useTemplateRef('content')
  const trigger = useTemplateRef('trigger')
  const isUndoAction = shallowRef(false)
  const isDialogOpen = shallowRef(false)
  const dialogKey = computed(() => isDialogOpen.value ? 'open' : 'closed')
  const isRewatchDisabled = computed(() => isSaving.value || status.value !== 'loaded' || watchedCount.value === 0)
  const showStartRewatch = computed(() => !canCancelRewatch.value && currentViewing.value !== null)
  const showUndoError = computed(() => isUndoAction.value && rewatchError.value !== '')

  function prepareRewatch(): void {
    isUndoAction.value = false
    rewatchError.value = ''
  }
  function setDialogOpen(value: boolean): void {
    if (!isSaving.value) { isDialogOpen.value = value }
  }
  function cancel(event: Event): void {
    if (isSaving.value) { event.preventDefault() }
  }
  function preventSavingDismissal(event: KeyboardEvent): void {
    if (isSaving.value) {
      event.preventDefault()
      event.stopPropagation()
    }
  }
  function restoreFocus(): void {
    const { activeElement, body } = globalThis.document
    const ownsFocus = activeElement === body || content.value?.contains(activeElement) === true

    if (ownsFocus) { trigger.value?.focus() }
  }
  async function save(): Promise<void> {
    const saved = await state.startRewatch()

    if (saved) { isDialogOpen.value = false }
  }
  async function undo(): Promise<void> {
    const owner = globalThis.document.activeElement

    isUndoAction.value = true

    await state.cancelRewatch()
    await nextTick()

    const { activeElement, body } = globalThis.document
    const ownsFocus = activeElement === owner || activeElement === body

    if (ownsFocus && status.value === 'loaded') { trigger.value?.focus() }
  }

  watch(currentViewing, (viewing) => {
    if (viewing === null) { isDialogOpen.value = false }
  }, { flush: 'sync' })

  watch(isDialogOpen, async (isOpen) => {
    if (isOpen) { return }

    await nextTick()

    if (!isDialogOpen.value) { restoreFocus() }
  })
</script>

<style module>
  @layer reset, vendor, tokens, base, components, utilities;
  @layer components {
    .component { display: grid; gap: var(--space-2); }
    .trigger { white-space: nowrap; }
    .supporting { color: var(--color-text-secondary); font-size: 0.875rem; }
    .dialog { inline-size: min(calc(100% - var(--space-8)), 30rem); margin: auto; padding: var(--space-6); border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface); color: var(--color-text-primary); box-shadow: var(--shadow-float); }
    .dialog::backdrop { background: var(--color-backdrop); }
    .content { display: grid; gap: var(--space-5); }
    .heading { font-size: 1.5rem; font-weight: 600; }
    .actions { display: grid; gap: var(--space-3); }
  }
</style>
