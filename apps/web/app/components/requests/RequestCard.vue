<template>
  <article :class="$style.component">
    <CatalogPoster :key="card.tmdbId" :class="$style.poster" :poster-url="card.posterUrl" :title="card.title" compact loading="lazy" />
    <div :class="$style.content">
      <h2 :class="$style.title">{{ card.title }}</h2>
      <p>{{ metadata }}</p>
      <p v-if="hasOriginal">{{ card.originalTitle }}</p>
      <p v-if="card.description" :class="$style.description">{{ card.description }}</p>
      <slot />
    </div>
  </article>
</template>
<script setup lang="ts">
  import { toRef } from 'vue'
  import type { RequestCard } from '@tv/shared/catalog-requests'
  import CatalogPoster from '~/components/catalog/CatalogPoster.vue'

  interface Props {
    card: RequestCard;
  }

  const { card } = defineProps<Props>()
  const hasOriginal = toRef(() => card.originalTitle !== card.title)

  const metadata = toRef(() => {
    const typeLabel = card.type === 'movie' ? 'Movie' : 'Series'
    const label = card.year === null ? typeLabel : `${typeLabel} · ${card.year}`

    return label
  })
</script>
<style module>
  @layer reset, vendor, tokens, base, components, utilities;

  @layer components {
    .component { display: grid; grid-template-columns: 5rem minmax(0, 1fr); gap: var(--space-4); padding: var(--space-4); border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface); }
    .poster { align-self: start; }
    .content { display: grid; align-content: start; justify-items: start; gap: var(--space-3); min-inline-size: 0; }
    .title { font-size: 1.25rem; }
    .description { color: var(--color-text-secondary); white-space: pre-line; }
    @media (width >= 40rem) { .component { grid-template-columns: 8rem minmax(0, 1fr); padding: var(--space-6); } }
  }
</style>
