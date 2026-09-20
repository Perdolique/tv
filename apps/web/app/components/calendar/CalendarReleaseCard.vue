<template>
  <li :class="$style.component" :data-release-id="item.releaseId">
    <NuxtLink :class="$style.link" :to="location">
      <CatalogPoster compact loading="lazy" :poster-url="item.posterUrl" :title="item.title" />
      <div :class="$style.copy">
        <time v-if="showDate" :class="$style.date" :datetime="item.releaseDate">{{ formattedDate }}</time>
        <h3 :class="$style.title" :lang="item.titleLocale">{{ item.title }}</h3>
        <p :class="$style.metadata"><span :class="$style.typeCue" :data-type="releaseType" aria-hidden="true" />{{ metadata }}</p>
      </div>
    </NuxtLink>
  </li>
</template>

<script lang="ts" setup>
  import type { CatalogReleaseItem } from '@tv/shared/catalog'
  import { computed } from 'vue'
  import CatalogPoster from '~/components/catalog/CatalogPoster.vue'
  import { formatCalendarDateForDisplay } from '~/utils/calendar-date.ts'

  interface Props {
    item: CatalogReleaseItem;
    showDate?: boolean;
  }

  const { item, showDate = false } = defineProps<Props>()

  const location = computed(() => {
    return { path: `/titles/${item.id}` }
  })

  const formattedDate = computed(() => formatCalendarDateForDisplay(item.releaseDate, {
    dateStyle: 'medium'
  }))

  const releaseType = computed(() => {
    if (item.type === 'movie') {
      return 'movie'
    }

    return item.episodeNumber === null ? 'series' : 'episode'
  })

  const metadata = computed(() => [
    item.type === 'movie' ? 'Movie' : 'Series',
    item.seasonNumber === null ? null : `S${item.seasonNumber}`,
    item.episodeNumber === null ? null : `E${item.episodeNumber}`
  ].filter(value => value !== null).join(' · '))
</script>

<style module>
  @layer reset, vendor, tokens, base, components, utilities;

  @layer components {
    .component {
      min-inline-size: 0;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      background: var(--color-surface);
    }
    .link {
      display: grid;
      grid-template-columns: 6rem minmax(0, 1fr);
      align-items: center;
      gap: var(--space-3);
      min-block-size: 6.5rem;
      padding: var(--space-3);
      color: var(--color-text-primary);
      text-decoration: none;
    }
    .copy {
      min-inline-size: 0;
      display: grid;
      gap: var(--space-1);
    }
    .date, .metadata { color: var(--color-text-secondary); font-size: 0.75rem; }
    .metadata { display: flex; align-items: center; gap: var(--space-2); }
    .typeCue {
      flex: 0 0 auto;
      inline-size: 0.875rem;
      block-size: 0.875rem;
      border: 1px solid currentcolor;
      border-radius: 50%;
    }
    .typeCue[data-type='episode'] { border-radius: 0.2rem; }
    .typeCue[data-type='series'] {
      inline-size: 1.25rem;
      block-size: 0.625rem;
      border-radius: var(--radius-round);
    }
    .title {
      display: -webkit-box;
      overflow: hidden;
      font-size: 1rem;
      line-height: 1.3;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
    }
    .link:hover .title { text-decoration: underline; text-underline-offset: 0.2em; }
  }
</style>
