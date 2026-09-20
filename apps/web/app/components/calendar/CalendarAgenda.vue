<template>
  <section :class="$style.component" :aria-labelledby="headingId">
    <header :class="$style.header" aria-live="polite">
      <p :class="$style.eyebrow">Agenda</p>
      <h2 :id="headingId" :class="$style.heading">{{ heading }}</h2>
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
      <p :class="$style.supportingText">Choose another date with a release.</p>
    </div>

    <ul v-else :class="$style.list" :aria-label="listLabel">
      <CalendarReleaseCard v-for="item in items" :key="item.releaseId" :item show-date />
    </ul>
  </section>
</template>

<script lang="ts" setup>
  import type { CatalogReleaseItem } from '@tv/shared/catalog'
  import { computed, useId, useTemplateRef } from 'vue'
  import CalendarReleaseCard from '~/components/calendar/CalendarReleaseCard.vue'
  import AppButton from '~/components/ui/AppButton.vue'
  import AppMessage from '~/components/ui/AppMessage.vue'
  import { formatCalendarDateForDisplay } from '~/utils/calendar-date.ts'

  interface Props {
    hasError: boolean;
    isLoading: boolean;
    items: CatalogReleaseItem[];
    monthHasItems: boolean;
    periodLabel: string;
    selectedDate: string | null;
  }

  interface Emits {
    retry: [];
  }

  const { hasError, isLoading, items, monthHasItems, periodLabel, selectedDate } = defineProps<Props>()
  const emit = defineEmits<Emits>()
  const headingId = useId()
  const retryButton = useTemplateRef('retryButton')

  const heading = computed(() => selectedDate === null
    ? periodLabel
    : formatCalendarDateForDisplay(selectedDate, { dateStyle: 'full' }))

  const listLabel = computed(() => selectedDate === null
    ? `Releases in ${periodLabel}`
    : 'Releases for selected day')

  function focusRetry(): void {
    retryButton.value?.focus()
  }

  defineExpose({
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
    .skeletonRow {
      display: grid;
      grid-template-columns: 6rem minmax(0, 1fr);
      align-items: center;
      gap: var(--space-3);
      min-block-size: 6.5rem;
      padding: var(--space-3);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      background: var(--color-surface);
    }
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
