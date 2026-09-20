<template>
  <section ref="component" :class="$style.component" :aria-labelledby="upcomingHeadingId">
    <div :class="$style.header">
      <h2 :id="upcomingHeadingId" :class="$style.heading">Upcoming releases</h2>
      <p :class="$style.supportingText">Every known release from titles you follow.</p>
    </div>

    <div v-if="isInitialLoading" ref="initialLoadingStatus" :class="$style.loadingList" role="status" aria-label="Loading upcoming releases" aria-busy="true" tabindex="-1">
      <div v-for="row in 5" :key="row" :class="$style.skeletonRow" aria-hidden="true">
        <div :class="$style.skeletonPoster" />
        <div :class="$style.skeletonCopy"><span /><span /></div>
      </div>
    </div>

    <div v-else-if="hasInitialError" :class="$style.message">
      <AppMessage role="alert" tone="danger">We couldn’t load your upcoming releases. Try again.</AppMessage>
      <AppButton ref="initialRetryButton" variant="secondary" @click="emit('retry-initial')">Try again</AppButton>
    </div>

    <div v-else-if="items.length === 0" :class="$style.message">
      <h2 :class="$style.emptyHeading">No upcoming releases</h2>
      <p :class="$style.supportingText">Follow more movies and series to see their next releases here.</p>
      <NuxtLink :class="$style.watchlistLink" to="/watchlist">Open watchlist</NuxtLink>
    </div>

    <template v-else>
      <section v-for="group in groups" :key="group.date" :class="$style.dateGroup" :aria-labelledby="group.headingId">
        <h2 :id="group.headingId" :class="$style.dateHeading">{{ group.heading }}</h2>
        <ul :class="$style.list" :aria-label="group.listLabel">
          <CalendarReleaseCard v-for="item in group.items" :key="item.releaseId" :item />
        </ul>
      </section>

      <div :class="$style.pagination">
        <p v-if="isLoadingMore" ref="loadMoreLoadingStatus" :class="$style.paginationMessage" role="status" tabindex="-1">Loading more releases…</p>

        <div v-else-if="hasLoadMoreError" :class="$style.loadMoreError">
          <p>We couldn’t load more releases. Try again.</p>
          <AppButton ref="loadMoreRetryButton" variant="secondary" @click="emit('load-more', 'manual')">Try again</AppButton>
        </div>

        <AppButton v-else-if="hasMore" variant="secondary" @click="emit('load-more', 'manual')">
          Load more releases
        </AppButton>

        <p v-else :class="$style.paginationMessage">That’s all your upcoming releases.</p>
      </div>
    </template>

    <div ref="sentinel" :class="$style.sentinel" aria-hidden="true" />
    <p :class="$style.visuallyHidden" aria-live="polite" aria-atomic="true">{{ announcement }}</p>
  </section>
</template>

<script lang="ts" setup>
  import { useIntersectionObserver } from '@vueuse/core'
  import type { CatalogReleaseItem } from '@tv/shared/catalog'
  import { computed, useId, useTemplateRef } from 'vue'
  import CalendarReleaseCard from '~/components/calendar/CalendarReleaseCard.vue'
  import AppButton from '~/components/ui/AppButton.vue'
  import AppMessage from '~/components/ui/AppMessage.vue'
  import { formatCalendarDateForDisplay, groupReleasesByDate } from '~/utils/calendar-date.ts'

  interface Props {
    announcement: string;
    hasInitialError: boolean;
    hasLoadMoreError: boolean;
    hasMore: boolean;
    isInitialLoading: boolean;
    isLoadingMore: boolean;
    items: CatalogReleaseItem[];
    today: string;
  }

  interface Emits {
    'load-more': [source: 'auto' | 'manual'];
    'retry-initial': [];
  }

  const {
    announcement,
    hasInitialError,
    hasLoadMoreError,
    hasMore,
    isInitialLoading,
    isLoadingMore,
    items,
    today
  } = defineProps<Props>()

  const emit = defineEmits<Emits>()
  const component = useTemplateRef('component')
  const sentinel = useTemplateRef('sentinel')
  const initialLoadingStatus = useTemplateRef('initialLoadingStatus')
  const initialRetryButton = useTemplateRef('initialRetryButton')
  const loadMoreLoadingStatus = useTemplateRef('loadMoreLoadingStatus')
  const loadMoreRetryButton = useTemplateRef('loadMoreRetryButton')
  const upcomingHeadingId = useId()
  let autoLoadArmed = true

  const canAutoLoad = computed(() => (
    hasMore
    && !hasInitialError
    && !hasLoadMoreError
    && !isInitialLoading
    && !isLoadingMore
  ))

  const groups = computed(() => {
    const groupedItems = groupReleasesByDate(items)

    return Array.from(groupedItems, ([date, dateItems]) => {
      const formattedDate = formatCalendarDateForDisplay(date, { dateStyle: 'full' })
      const heading = date === today ? `Today · ${formattedDate}` : formattedDate
      const headingId = `${upcomingHeadingId}-${date}`

      return {
        date,
        heading,
        headingId,
        items: dateItems,
        listLabel: `Releases for ${heading}`
      }
    })
  })

  useIntersectionObserver(sentinel, ([entry]) => {
    if (entry === undefined) {
      return
    }

    if (!entry.isIntersecting) {
      autoLoadArmed = true

      return
    }

    if (autoLoadArmed && canAutoLoad.value) {
      autoLoadArmed = false

      emit('load-more', 'auto')
    }
  }, {
    rootMargin: '0px 0px 320px 0px',
    threshold: 0
  })

  function focusInitialRetry(): void {
    initialRetryButton.value?.focus()
  }

  function focusInitialLoading(): void {
    initialLoadingStatus.value?.focus()
  }

  function focusLoadMoreLoading(): void {
    loadMoreLoadingStatus.value?.focus()
  }

  function focusLoadMoreRetry(): void {
    loadMoreRetryButton.value?.focus()
  }

  function focusRelease(releaseId: string): void {
    const release = component.value?.querySelector<HTMLElement>(`[data-release-id="${releaseId}"] a`)

    release?.focus()
  }

  defineExpose({
    focusInitialLoading,
    focusInitialRetry,
    focusLoadMoreLoading,
    focusLoadMoreRetry,
    focusRelease
  })
</script>

<style module>
  @layer reset, vendor, tokens, base, components, utilities;

  @layer components {
    .component {
      display: grid;
      align-content: start;
      gap: var(--space-6);
      inline-size: min(100%, 46rem);
      min-inline-size: 0;
    }
    .header { display: grid; gap: var(--space-2); }
    .heading { font-size: 1.5rem; line-height: 1.25; }
    .supportingText, .paginationMessage { color: var(--color-text-secondary); }
    .loadingList, .list { display: grid; gap: var(--space-3); }
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
    .message, .loadMoreError {
      display: grid;
      justify-items: start;
      gap: var(--space-3);
      padding: var(--space-5);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      background: var(--color-surface);
    }
    .emptyHeading { font-size: 1.25rem; }
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
    .dateGroup { display: grid; gap: var(--space-3); }
    .dateHeading { font-size: 1.125rem; line-height: 1.3; }
    .pagination { display: grid; justify-items: start; gap: var(--space-3); }
    .sentinel { block-size: 1px; }
    .visuallyHidden {
      position: absolute;
      inline-size: 1px;
      block-size: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }

    @media (forced-colors: active) {
      .watchlistLink { border: 1px solid ButtonText; }
    }
  }
</style>
