<template>
  <section :class="$style.component" aria-label="Current series viewing">
    <AppButton v-if="currentViewing" ref="trigger" variant="secondary" :disabled="isRewatchDisabled" aria-haspopup="dialog" @click="open">Start rewatch</AppButton>
    <p v-if="currentViewing" :class="$style.supporting">{{ viewingLabel }}</p>
    <dialog ref="dialog" :class="$style.dialog" :aria-labelledby="headingId" :aria-describedby="descriptionId" @cancel="cancel" @close="restoreFocus">
      <div :class="$style.content">
        <h2 :id="headingId" :class="$style.heading">Start a rewatch</h2>
        <p :id="descriptionId" :class="$style.supporting">{{ description }}</p>
        <AppMessage v-if="rewatchError" role="alert" tone="danger">{{ rewatchError }}</AppMessage>
        <div :class="$style.actions">
          <template v-if="isWatching">
            <AppButton autofocus :disabled="isSaving" :aria-busy="isSaving || undefined" @click="save('paused')">Pause current viewing</AppButton>
            <AppButton variant="secondary" :disabled="isSaving" @click="save('completed')">Complete current viewing</AppButton>
          </template>
          <AppButton v-else autofocus :disabled="isSaving" :aria-busy="isSaving || undefined" @click="save()">Start rewatch</AppButton>
          <AppButton variant="secondary" :disabled="isSaving" @click="close">Cancel</AppButton>
        </div>
        <p v-if="isSaving" :class="$style.supporting" role="status">Saving your new viewing…</p>
      </div>
    </dialog>
  </section>
</template>

<script setup lang="ts">
  import { computed, nextTick, useId, useTemplateRef, watch } from 'vue'
  import type { CatalogEpisodeWatchesState } from '~/composables/use-catalog-episode-watches.ts'
  import AppButton from '~/components/ui/AppButton.vue'
  import AppMessage from '~/components/ui/AppMessage.vue'

  interface Props {
    state: CatalogEpisodeWatchesState;
  }

  const { state } = defineProps<Props>()
  const { rewatchError, currentViewing, isSaving, status } = state
  const dialog = useTemplateRef('dialog')
  const trigger = useTemplateRef('trigger')
  const headingId = useId()
  const descriptionId = useId()
  const isWatching = computed(() => currentViewing.value?.status === 'watching')
  const isRewatchDisabled = computed(() => isSaving.value || status.value !== 'loaded')

  const viewingLabel = computed(() => {
    if (currentViewing.value?.status === 'paused') { return 'Current viewing paused' }

    if (currentViewing.value?.status === 'completed') { return 'Current viewing completed' }

    return 'Current viewing in progress'
  })

  const description = computed(() => isWatching.value ? 'Choose how to close your current viewing. Your previous episodes stay in your timeline. The new viewing starts empty.' : 'Your previous episodes stay in your timeline. The new viewing starts empty.')

  async function open(): Promise<void> {
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
  async function save(closeStatus?: 'paused' | 'completed'): Promise<void> {
    if (await state.startRewatch(closeStatus)) { dialog.value?.close() }
  }

  watch(currentViewing, (viewing) => {
    if (viewing === null) { dialog.value?.close() }
  })
</script>

<style module>
  @layer reset, vendor, tokens, base, components, utilities;
  @layer components {
    .component { display: grid; gap: var(--space-2); }
    .supporting { color: var(--color-text-secondary); font-size: 0.875rem; }
    .dialog { inline-size: min(calc(100% - var(--space-8)), 30rem); margin: auto; padding: var(--space-6); border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface); color: var(--color-text-primary); box-shadow: var(--shadow-float); }
    .dialog::backdrop { background: var(--color-backdrop); }
    .content { display: grid; gap: var(--space-5); }
    .heading { font-size: 1.5rem; font-weight: 600; }
    .actions { display: grid; gap: var(--space-3); }
  }
</style>
