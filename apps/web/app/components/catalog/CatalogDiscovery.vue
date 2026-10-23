<template>
  <section :class="$style.component" aria-label="Discover titles" :aria-busy="isLoading">
    <div v-if="hasError" :class="$style.message">
      <AppMessage role="alert" tone="danger">We couldn’t load the collections. You can still search the catalog.</AppMessage>
      <AppButton size="small" variant="secondary" :disabled="isLoading" @click="retry">Retry collections</AppButton>
    </div>
    <p v-if="showInitialLoading" :class="$style.message" role="status">Loading collections…</p>
    <template v-if="data">
      <section :class="$style.recent" :aria-labelledby="recentHeadingId">
        <header :class="$style.sectionHeader"><h2 :id="recentHeadingId" ref="recentHeading" tabindex="-1">Recently added</h2><NuxtLink to="/discover/recent">View all</NuxtLink></header>
        <p :class="$style.description">New to the TV catalog, most recent first.</p>
        <CatalogCardList v-if="hasRecent" :items="data.recent" label="Recently added titles" />
        <p v-else :class="$style.description">No titles have been added yet.</p>
      </section>
      <section :class="$style.ranking" :aria-labelledby="rankingHeadingId">
        <header :class="$style.sectionHeader"><h2 :id="rankingHeadingId">Top rated on TV</h2><NuxtLink to="/discover/top-rated">View all</NuxtLink></header>
        <p :class="$style.description">Highest average scores from at least one viewer vote.</p>
        <CatalogCardList v-if="hasRatings" :items="data.topRated" label="Top-rated titles" presentation="ranked" />
        <p v-else :class="$style.description">No viewer ratings yet.</p>
      </section>
      <div :class="$style.collections">
        <section v-for="entry in collections" :key="entry.id" :class="$style.collection" :aria-label="entry.title">
          <header :class="$style.sectionHeader"><h2>{{ entry.title }}</h2><NuxtLink :to="entry.location">View collection</NuxtLink></header>
          <p v-if="entry.description" :class="$style.description">{{ entry.description }}</p>
          <CatalogCardList :items="entry.items" :label="entry.title" />
          <p v-if="entry.isEmpty" :class="$style.description">No titles in this collection yet.</p>
        </section>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
  import { computed, useId, useTemplateRef } from 'vue'
  import type { InferOutput } from 'valibot'
  import type { discoveryResponseSchema } from '@tv/shared/catalog-discovery'
  import type { useCatalogRead } from '~/composables/use-catalog-read.ts'
  import { useRecoveryFocus } from '~/composables/use-recovery-focus.ts'
  import CatalogCardList from '~/components/catalog/CatalogCardList.vue'
  import AppButton from '~/components/ui/AppButton.vue'
  import AppMessage from '~/components/ui/AppMessage.vue'

  type DiscoveryRead = ReturnType<typeof useCatalogRead<typeof discoveryResponseSchema>>

  interface Props {
    data?: InferOutput<typeof discoveryResponseSchema>;
    hasError: boolean;
    isLoading: boolean;
    reload: DiscoveryRead['ready']['execute'];
  }

  const { data, hasError, isLoading, reload } = defineProps<Props>()
  const { capture } = useRecoveryFocus()
  const recentHeading = useTemplateRef('recentHeading')
  const recentHeadingId = useId()
  const rankingHeadingId = useId()
  const showInitialLoading = computed(() => isLoading && data === undefined)

  const hasRecent = computed(() => {
    const count = data?.recent.length ?? 0

    return count > 0
  })

  const hasRatings = computed(() => {
    const count = data?.topRated.length ?? 0

    return count > 0
  })

  const collections = computed(() => data?.collections.map(entry => {
    const location = `/collections/${entry.collection.id}`

    return {
      id: entry.collection.id,
      title: entry.collection.title,
      description: entry.collection.description,
      items: entry.items,
      location,
      isEmpty: entry.items.length === 0
    }
  }) ?? [])

  async function retry(event: MouseEvent): Promise<void> {
    if (isLoading) { return }

    const restoreFocus = capture(event)

    await reload()

    await restoreFocus(() => {
      if (hasError) { return }

      return recentHeading.value
    })
  }
</script>

<style module>
  @layer reset, vendor, tokens, base, components, utilities;

  @layer components {
    .component { display: grid; gap: var(--space-8); min-inline-size: 0; }
    .recent, .ranking, .collection { display: grid; gap: var(--space-4); min-inline-size: 0; align-content: start; }
    .collections { display: grid; gap: var(--space-8); min-inline-size: 0; }
    .sectionHeader { display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-4); }
    .sectionHeader h2 { font-size: 1.375rem; font-weight: 600; }
    .sectionHeader a { flex-shrink: 0; font-size: 0.875rem; }
    .description { color: var(--color-text-secondary); }
    .message { display: grid; justify-items: start; gap: var(--space-3); grid-column: 1 / -1; }
    @media (width >= 64rem) {
      .component { grid-template-columns: minmax(0, 1fr) 20rem; }
      .ranking { grid-column: 2; grid-row: 1 / span 2; }
      .recent, .collections { grid-column: 1; }
    }
  }
</style>
