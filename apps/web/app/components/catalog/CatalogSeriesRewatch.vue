<template>
  <section :class="$style.component" aria-label="Current series viewing">
    <AppButton v-if="canCancelRewatch" ref="trigger" :class="$style.trigger" icon="hugeicons:arrow-turn-backward" size="medium" variant="secondary" :disabled="isSaving" :aria-busy="isSaving || undefined" @click="undo">Cancel rewatch</AppButton>
    <AppButton v-else-if="currentViewing" ref="trigger" :class="$style.trigger" icon="hugeicons:reload" size="medium" variant="secondary" :disabled="isRewatchDisabled" aria-haspopup="dialog" @click="open">Start rewatch</AppButton>
    <dialog ref="dialog" :class="$style.dialog" :aria-labelledby="headingId" :aria-describedby="descriptionId" @cancel="cancel" @close="restoreFocus">
      <div :class="$style.content">
        <h2 :id="headingId" :class="$style.heading">Start a rewatch</h2>
        <p :id="descriptionId" :class="$style.supporting">Start again with no watched episodes? Your earlier marks stay in history.</p>
        <AppMessage v-if="rewatchError" role="alert" tone="danger">{{ rewatchError }}</AppMessage>
        <div :class="$style.actions">
          <AppButton :disabled="isSaving" :aria-busy="isSaving || undefined" @click="save">Start rewatch</AppButton>
          <AppButton autofocus variant="secondary" :disabled="isSaving" @click="close">Cancel</AppButton>
        </div>
        <p v-if="isSaving" :class="$style.supporting" role="status">Saving your new viewing…</p>
      </div>
    </dialog>
    <AppMessage v-if="isUndoAction && rewatchError" role="alert" tone="danger">{{ rewatchError }}</AppMessage>
  </section>
</template>

<script setup lang="ts">
  import { computed, nextTick, ref, useId, useTemplateRef, watch } from 'vue'
  import type { CatalogEpisodeWatchesState } from '~/composables/use-catalog-episode-watches.ts'
  import AppButton from '~/components/ui/AppButton.vue'
  import AppMessage from '~/components/ui/AppMessage.vue'

  interface Props {
    state: CatalogEpisodeWatchesState;
  }

  const { state } = defineProps<Props>()
  const { canCancelRewatch, rewatchError, currentViewing, isSaving, status, watchedCount } = state
  const dialog = useTemplateRef('dialog')
  const trigger = useTemplateRef('trigger')
  const headingId = useId()
  const descriptionId = useId()
  const isUndoAction = ref(false)
  const isRewatchDisabled = computed(() => isSaving.value || status.value !== 'loaded' || watchedCount.value === 0)

  async function open(): Promise<void> {
    isUndoAction.value = false
    rewatchError.value = ''

    await nextTick()
    dialog.value?.showModal()
  }
  function close(): void {
    if (!isSaving.value) { dialog.value?.close() }
  }
  function cancel(event: Event): void {
    if (isSaving.value) { event.preventDefault() }
  }
  function restoreFocus(): void { trigger.value?.focus() }
  async function save(): Promise<void> {
    if (await state.startRewatch()) { dialog.value?.close() }
  }
  async function undo(): Promise<void> {
    isUndoAction.value = true

    await state.cancelRewatch()
    await nextTick()
    trigger.value?.focus()
  }

  watch(currentViewing, (viewing) => {
    if (viewing === null) { dialog.value?.close() }
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
