<template>
  <div v-if="hasContent" :class="$style.component">
    <div v-if="hasError" :class="$style.message">
      <AppMessage role="alert" tone="danger">Related collections are temporarily unavailable.</AppMessage>
      <AppButton size="small" variant="secondary" :disabled="isLoading" @click="retry">Retry related collections</AppButton>
    </div>
    <p v-if="initialLoading" role="status">Loading related collections…</p>
    <section v-for="entry in collections" :key="entry.id" :class="$style.collection" :aria-label="entry.title">
      <header :class="$style.header"><h2 ref="collectionHeadings" tabindex="-1">{{ entry.title }}</h2><NuxtLink :to="entry.location">View collection</NuxtLink></header>
      <p v-if="entry.description" :class="$style.description">{{ entry.description }}</p>
      <CatalogCardList :items="entry.items" :label="entry.title" :current-title-id="catalogItemId" />
    </section>
  </div>
</template>

<script setup lang="ts">
  import { computed, useTemplateRef } from 'vue'
  import { collectionPreviewsSchema } from '@tv/shared/catalog-discovery'
  import { useCatalogRead } from '~/composables/use-catalog-read.ts'
  import { useRecoveryFocus } from '~/composables/use-recovery-focus.ts'
  import CatalogCardList from '~/components/catalog/CatalogCardList.vue'
  import AppButton from '~/components/ui/AppButton.vue'
  import AppMessage from '~/components/ui/AppMessage.vue'

  interface Props {
    catalogItemId: string;
    recoveryHeading?: HTMLElement | null;
  }

  const { catalogItemId, recoveryHeading } = defineProps<Props>()
  const endpoint = `/api/catalog/items/${catalogItemId}/collections`
  const key = `related-collections:${catalogItemId}`
  const { data, ready, hasError, isLoading } = useCatalogRead(key, endpoint, { schema: collectionPreviewsSchema })
  const { capture } = useRecoveryFocus()
  const collectionHeadings = useTemplateRef('collectionHeadings')
  const initialLoading = computed(() => isLoading.value && data.value === undefined)

  const collections = computed(() => data.value?.collections.map(entry => {
    const location = `/collections/${entry.collection.id}`

    return {
      id: entry.collection.id,
      title: entry.collection.title,
      description: entry.collection.description,
      items: entry.items,
      location
    }
  }) ?? [])

  const hasContent = computed(() => hasError.value || initialLoading.value || collections.value.length > 0)

  async function retry(event: MouseEvent): Promise<void> {
    if (isLoading.value) { return }

    const restoreFocus = capture(event)

    await ready.execute()

    if (!hasError.value) { await restoreFocus(() => collectionHeadings.value?.[0] ?? recoveryHeading) }
  }

  // This supplementary section must not hold up the title or its personal controls.
</script>

<style module>
  @layer reset, vendor, tokens, base, components, utilities;

  @layer components {
    .component { display: grid; margin-block-start: var(--space-6); gap: var(--space-6); min-inline-size: 0; }
    .collection { display: grid; gap: var(--space-4); min-inline-size: 0; }
    .header { display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-3); }
    .header h2 { font-size: 1.375rem; font-weight: 600; }
    .header a { font-size: 0.875rem; flex-shrink: 0; }
    .description { color: var(--color-text-secondary); }
    .message { display: grid; justify-items: start; gap: var(--space-3); }
  }
</style>
