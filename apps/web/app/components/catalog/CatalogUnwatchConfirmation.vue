<template>
  <Dialog.Root :model-value="isOpen" @update:model-value="setOpen">
    <Dialog.Content :class="$style.component" :blocking="state.isSaving.value" :close-on-click-outside="false" @cancel="cancel">
      <Dialog.Title :class="$style.heading">Remove watched episode and rating</Dialog.Title>
      <Dialog.Description :class="$style.supporting">Removing this watched mark also removes the episode rating from this viewing and its public vote when this viewing supplied it.</Dialog.Description>
      <AppMessage v-if="error" role="alert" tone="danger">{{ error }}</AppMessage>
      <div :class="$style.actions">
        <AppButton :class="$style.danger" variant="secondary" :disabled="state.isSaving.value" @click="state.confirmUnwatch">Remove mark and rating</AppButton>
        <AppButton autofocus variant="secondary" :disabled="state.isSaving.value" @click="state.cancelUnwatch">Keep watched</AppButton>
      </div>
    </Dialog.Content>
  </Dialog.Root>
</template>

<script setup lang="ts">
  import { nextTick, toRef, watch } from 'vue'
  import { Dialog } from '@vuetify/v0/components'
  import type { CatalogEpisodeWatchesState } from '~/composables/use-catalog-episode-watches.ts'
  import AppButton from '~/components/ui/AppButton.vue'
  import AppMessage from '~/components/ui/AppMessage.vue'

  interface Props {
    state: CatalogEpisodeWatchesState;
  }

  const { state } = defineProps<Props>()
  const isOpen = toRef(() => state.confirmationEpisodeId.value !== null)

  const error = toRef(() => {
    const episodeId = state.confirmationEpisodeId.value

    if (episodeId === null) { return '' }

    return state.saveErrorFor(episodeId)
  })

  let row: HTMLElement | null = null
  let trigger: HTMLElement | null = null

  function setOpen(open: boolean): void { if (!open) { state.cancelUnwatch() } }
  function cancel(event: Event): void { if (state.isSaving.value) { event.preventDefault() } }

  watch(isOpen, async open => {
    if (open) {
      const active = globalThis.document.activeElement

      trigger = active instanceof globalThis.HTMLElement ? active : null
      row = trigger?.closest('li') ?? null

      return
    }

    await nextTick()

    const { activeElement, body } = globalThis.document

    if (activeElement === body && !trigger?.isConnected && row?.isConnected) { row.focus() }
  }, { flush: 'sync' })
</script>

<style module>
  @layer reset, vendor, tokens, base, components, utilities;
  @layer components {
    .component { gap: var(--space-5); inline-size: min(calc(100% - var(--space-8)), 32rem); margin: auto; padding: var(--space-6); border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface); color: var(--color-text-primary); box-shadow: var(--shadow-float); }
    .component[open] { display: grid; }
    .component::backdrop { background: var(--color-backdrop); }
    .heading { font-size: 1.5rem; font-weight: 600; }
    .supporting { color: var(--color-text-secondary); }
    .actions { display: flex; flex-wrap: wrap; gap: var(--space-3); }
    .danger[data-variant]:not(:disabled) { color: var(--color-danger); }
  }
</style>
