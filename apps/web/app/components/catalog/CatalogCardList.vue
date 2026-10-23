<template>
  <ol ref="list" :class="$style.component" :data-presentation="presentation" :aria-label="label">
    <li v-for="item in rows" :key="item.id" :class="$style.item">
      <NuxtLink :class="$style.link" :to="item.location" :data-catalog-id="item.id" :aria-current="item.current">
        <CatalogPoster :class="$style.poster" :poster-url="item.posterUrl" :title="item.title" :loading="item.loading" compact />
        <div :class="$style.copy">
          <h3 :class="$style.title" :lang="item.titleLocale">{{ item.title }}</h3>
          <p :class="$style.metadata">{{ item.metadata }}</p>
          <p :class="$style.rating">{{ item.rating }}</p>
          <span v-if="item.current" :class="$style.current">Current title</span>
        </div>
      </NuxtLink>
    </li>
  </ol>
</template>

<script setup lang="ts">
  import type { CatalogDiscoveryItem } from '@tv/shared/catalog-discovery'
  import { computed, useTemplateRef } from 'vue'
  import CatalogPoster from '~/components/catalog/CatalogPoster.vue'

  interface Props {
    items: CatalogDiscoveryItem[];
    label: string;
    currentTitleId?: string;
    presentation?: 'rail' | 'ranked' | 'grid';
  }

  const { items, currentTitleId, presentation = 'rail' } = defineProps<Props>()
  const list = useTemplateRef('list')

  const rows = computed(() => items.map((item, index) => {
    const type = item.type === 'movie' ? 'Movie' : 'Series'
    const metadata = item.releaseYear === null ? type : `${type} · ${item.releaseYear}`
    const votes = item.ratingCount === 1 ? 'vote' : 'votes'
    const averageScore = item.averageScore?.toFixed(1)
    const rating = averageScore === undefined ? 'Not rated' : `${averageScore} / 10 · ${item.ratingCount} ${votes}`
    const location = `/titles/${item.id}`
    const current = item.id === currentTitleId ? 'page' as const : undefined
    const loading = index === 0 ? 'eager' as const : 'lazy' as const

    return {
      id: item.id,
      title: item.title,
      titleLocale: item.titleLocale,
      posterUrl: item.posterUrl,
      location,
      metadata,
      rating,
      current,
      loading
    }
  }))

  function focusItem(id: string): void {
    const selector = `a[data-catalog-id="${id}"]`
    const link = list.value?.querySelector<HTMLAnchorElement>(selector)

    link?.focus()
  }

  defineExpose({ focusItem })

</script>

<style module>
  @layer reset, vendor, tokens, base, components, utilities;

  @layer components {
    .component { display: grid; grid-auto-flow: column; grid-auto-columns: clamp(8.5rem, 16vw, 11rem); gap: var(--space-4); padding: var(--space-1) var(--space-1) var(--space-3); overflow-x: auto; list-style: none; }
    .item { min-inline-size: 0; }
    .link { display: grid; gap: var(--space-3); color: var(--color-text-primary); text-decoration: none; }
    .link:hover .title { text-decoration: underline; text-underline-offset: 0.2em; }
    .link[aria-current='page'] .poster { outline: 2px solid var(--color-accent); outline-offset: -2px; }
    .copy { display: grid; align-content: start; gap: var(--space-1); }
    .title { font-size: 1rem; line-height: 1.4; font-weight: 600; }
    .metadata, .rating { color: var(--color-text-secondary); font-size: 0.875rem; }
    .current { color: var(--color-accent); font-size: 0.875rem; font-weight: 600; }
    .component[data-presentation='grid'] { grid-auto-flow: row; grid-template-columns: repeat(auto-fill, minmax(min(100%, 9rem), 1fr)); overflow: visible; }
    .component[data-presentation='ranked'] { grid-auto-flow: row; grid-auto-columns: auto; overflow: visible; }
    .component[data-presentation='ranked'] .link { grid-template-columns: 4rem minmax(0, 1fr); align-items: start; }
    .component[data-presentation='ranked'] .poster { border-radius: var(--radius-sm); }
  }
</style>
