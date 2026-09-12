<template>
  <section :class="$style.component" :aria-labelledby="headingId">
    <header :class="$style.header">
      <p :class="$style.eyebrow">Agenda</p>
      <h2 :id="headingId" ref="headingElement" :class="$style.heading" tabindex="-1">{{ heading }}</h2>
    </header>

    <div v-if="isLoading" :class="$style.loadingList" role="status" aria-label="Loading agenda" aria-busy="true">
      <div v-for="row in 3" :key="row" :class="$style.skeletonRow" aria-hidden="true">
        <div :class="$style.skeletonPoster" />
        <div :class="$style.skeletonCopy"><span /><span /></div>
      </div>
    </div>

    <div v-else-if="hasError" :class="$style.message">
      <AppMessage role="alert" tone="danger">We couldn’t load your release calendar. Try again.</AppMessage>
      <AppButton ref="retryButton" variant="secondary" @click="emit('retry')">Try again</AppButton>
    </div>

    <div v-else-if="!monthHasItems" :class="$style.message">
      <h3 :class="$style.subheading">No upcoming releases this month</h3>
      <p :class="$style.supportingText">Follow more movies and series to fill your calendar.</p>
      <NuxtLink :class="$style.watchlistLink" to="/watchlist">Open watchlist</NuxtLink>
    </div>

    <div v-else-if="items.length === 0" :class="$style.message">
      <h3 :class="$style.subheading">Nothing releases on this day</h3>
      <p :class="$style.supportingText">Choose another available date in this month.</p>
    </div>

    <ul v-else :class="$style.list" aria-label="Releases for selected day">
      <li v-for="row in rows" :key="row.releaseId" :class="$style.item">
        <NuxtLink :class="$style.itemLink" :to="row.location">
          <CatalogPoster compact :poster-url="row.posterUrl" :title="row.title" />
          <div :class="$style.copy">
            <time :class="$style.date" :datetime="row.releaseDate">{{ row.formattedDate }}</time>
            <h3 :class="$style.title" :lang="row.titleLocale">{{ row.title }}</h3>
            <p :class="$style.metadata">{{ row.metadata }}</p>
          </div>
        </NuxtLink>
      </li>
    </ul>
  </section>
</template>

<script lang="ts" setup>
  import type { CatalogReleaseItem } from '@tv/shared/catalog'
  import { computed, useId, useTemplateRef } from 'vue'
  import CatalogPoster from '~/components/catalog/CatalogPoster.vue'
  import AppButton from '~/components/ui/AppButton.vue'
  import AppMessage from '~/components/ui/AppMessage.vue'
  import { formatCalendarDateForDisplay } from '~/utils/calendar-date.ts'

  interface Props {
    hasError: boolean;
    isLoading: boolean;
    items: CatalogReleaseItem[];
    monthHasItems: boolean;
    selectedDate: string | null;
  }

  interface Emits {
    retry: [];
  }

  const { hasError, isLoading, items, monthHasItems, selectedDate } = defineProps<Props>()
  const emit = defineEmits<Emits>()
  const headingId = useId()
  const headingElement = useTemplateRef('headingElement')
  const retryButton = useTemplateRef('retryButton')

  const heading = computed(() => selectedDate === null
    ? 'Loading selected day…'
    : formatCalendarDateForDisplay(selectedDate, { dateStyle: 'full' }))

  const rows = computed(() => items.map((item) => {
    const metadata = [
      item.type === 'movie' ? 'Movie' : 'Series',
      item.seasonNumber === null ? null : `S${item.seasonNumber}`,
      item.episodeNumber === null ? null : `E${item.episodeNumber}`
    ].filter(value => value !== null).join(' · ')

    return {
      formattedDate: formatCalendarDateForDisplay(item.releaseDate, { dateStyle: 'medium' }),
      location: { path: `/titles/${item.id}` },
      metadata,
      posterUrl: item.posterUrl,
      releaseDate: item.releaseDate,
      releaseId: item.releaseId,
      title: item.title,
      titleLocale: item.titleLocale
    }
  }))

  function focusRetry(): void {
    retryButton.value?.focus()
  }

  function focusHeading(): void {
    headingElement.value?.focus()
  }

  defineExpose({
    focusHeading,
    focusRetry
  })
</script>

<style module>
  @layer reset, vendor, tokens, base, components, utilities;

  @layer components {
    .component {
      display: grid;
      align-content: start;
      gap: var(--space-4);
      min-inline-size: 0;
    }
    .header { display: grid; gap: var(--space-1); }
    .eyebrow {
      color: var(--color-text-secondary);
      font-size: 0.75rem;
      font-weight: 700;
      text-transform: uppercase;
    }
    .heading { font-size: 1.25rem; line-height: 1.3; }
    .list, .loadingList { display: grid; gap: var(--space-3); }
    .list { padding: 0; list-style: none; }
    .item, .skeletonRow {
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      background: var(--color-surface);
    }
    .itemLink, .skeletonRow {
      display: grid;
      grid-template-columns: 6rem minmax(0, 1fr);
      align-items: center;
      gap: var(--space-3);
      min-block-size: 6.5rem;
      padding: var(--space-3);
    }
    .itemLink { color: var(--color-text-primary); text-decoration: none; }
    .copy {
      /* Let long localized titles shrink instead of widening the agenda rail. */
      min-inline-size: 0;
      display: grid;
      gap: var(--space-1);
    }
    .date, .metadata { color: var(--color-text-secondary); font-size: 0.75rem; }
    .title {
      display: -webkit-box;
      overflow: hidden;
      font-size: 1rem;
      line-height: 1.3;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
    }
    .itemLink:hover .title { text-decoration: underline; text-underline-offset: 0.2em; }
    .skeletonPoster {
      aspect-ratio: 2 / 3;
      border-radius: var(--radius-sm);
      background: var(--color-surface-muted);
    }
    .skeletonCopy { display: grid; gap: var(--space-3); }
    .skeletonCopy span {
      block-size: 0.875rem;
      border-radius: var(--radius-round);
      background: var(--color-surface-muted);
    }
    .skeletonCopy span:last-child { inline-size: 60%; }
    .message {
      display: grid;
      justify-items: start;
      gap: var(--space-3);
      padding: var(--space-5);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      background: var(--color-surface);
    }
    .subheading { font-size: 1.125rem; }
    .supportingText { color: var(--color-text-secondary); }
    .watchlistLink {
      display: inline-flex;
      align-items: center;
      min-block-size: 2.75rem;
      padding: var(--space-2) var(--space-4);
      border-radius: var(--radius-sm);
      background: var(--color-accent-fill);
      color: var(--color-on-accent);
      font-weight: 700;
      text-decoration: none;
    }
  }
</style>
