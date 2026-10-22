<template>
  <div :class="$style.component">
    <main v-if="hasSessionError" :class="$style.sessionPanel">
      <p :class="$style.wordmark">TV</p>
      <h1 :class="$style.heading">We couldn’t verify your session.</h1>
      <p>Try again to open your dashboard.</p>
      <AppButton ref="sessionRetryButton" :disabled="isRetryingSession" @click="retrySession">Try again</AppButton>
    </main>

    <AppShell v-else-if="isAuthenticated" active-destination="dashboard">
      <main :class="$style.content">
        <header :class="$style.pageHeader">
          <h1 ref="heading" :class="$style.heading" tabindex="-1">Dashboard</h1>
          <p :class="$style.supportingText">Your movie and series viewings, with all-time totals.</p>
        </header>

        <section v-if="isSummaryLoading" :class="$style.metrics" aria-label="Loading viewing summary" aria-busy="true">
          <div v-for="metric in 4" :key="metric" :class="$style.metric" aria-hidden="true">
            <span :class="$style.skeletonText" />
            <span :class="$style.skeletonValue" />
          </div>
        </section>
        <dl v-else-if="summary" :class="$style.metrics" aria-label="Viewing summary">
          <div :class="$style.metric">
            <dt :class="$style.metricLabel">Movie viewings</dt>
            <dd :class="$style.metricValue">{{ summary.watchedMovieCount }}</dd>
          </div>
          <div :class="$style.metric">
            <dt :class="$style.metricLabel">Series completed</dt>
            <dd :class="$style.metricValue">{{ summary.completedSeriesCount }}</dd>
          </div>
          <div :class="$style.metric">
            <dt :class="$style.metricLabel">Watching series</dt>
            <dd :class="$style.metricValue">{{ summary.watchingSeriesCount }}</dd>
          </div>
          <div :class="$style.metric">
            <dt :class="$style.metricLabel">Episodes watched</dt>
            <dd :class="$style.metricValue">{{ summary.watchedEpisodeCount }}</dd>
          </div>
        </dl>
        <section v-if="hasSummaryError" :class="$style.message" aria-label="Viewing summary error">
          <AppButton ref="summaryRetryButton" :class="$style.action" size="small" variant="secondary" :aria-disabled="isSummaryRefreshing" :aria-busy="isSummaryRefreshing" @click="retrySummary">Retry summary</AppButton>
          <AppMessage role="alert" tone="danger">We couldn’t load your viewing summary. Try again.</AppMessage>
        </section>

        <div :class="$style.columns">
          <section :class="$style.history" :aria-labelledby="historyHeadingId">
            <div :class="$style.sectionHeader">
              <h2 :id="historyHeadingId" ref="historyHeading" :class="$style.subheading" tabindex="-1">Viewing history</h2>
            </div>
            <fieldset :class="$style.filters">
              <legend :class="$style.visuallyHidden">Viewing status</legend>
              <label v-for="filter in filters" :key="filter.label" :class="$style.filter">
                <input :name="filterName" type="radio" :value="filter.value ?? 'all'" :checked="selectedStatus === filter.value" @change="selectStatus(filter.value)">
                <span>{{ filter.label }}</span>
              </label>
            </fieldset>
            <p role="status" :class="$style.visuallyHidden">{{ announcement }}</p>
            <AppMessage v-if="needsRefresh" tone="neutral">Your viewings changed. Reload this page to load more.</AppMessage>

            <div v-if="isHistoryLoading" :class="$style.list" aria-label="Loading viewing history" role="region" aria-busy="true">
              <div v-for="row in 3" :key="row" :class="$style.row" aria-hidden="true">
                <div :class="$style.skeletonPoster" />
                <div :class="$style.copy">
                  <div :class="$style.skeletonText" />
                  <div :class="$style.skeletonText" />
                  <div :class="$style.skeletonText" />
                </div>
              </div>
            </div>
            <div v-else-if="hasHistoryError" :class="$style.message">
              <AppButton ref="historyRetryButton" :class="$style.action" size="small" variant="secondary" :aria-disabled="isHistoryRefreshing" :aria-busy="isHistoryRefreshing" @click="retryHistory">Retry history</AppButton>
              <AppMessage role="alert" tone="danger">We couldn’t load your viewing history. Try again.</AppMessage>
            </div>
            <div v-else-if="isHistoryEmpty" :class="$style.message">
              <h3 :class="$style.itemTitle">{{ emptyHeading }}</h3>
              <AppButton v-if="isFiltered" size="small" variant="secondary" @click="showAll">Show all</AppButton>
              <template v-else>
                <p :class="$style.supportingText">Open a movie or series to record your first viewing.</p>
                <NuxtLink :class="$style.catalogLink" to="/">Browse catalog</NuxtLink>
              </template>
            </div>
            <ul v-else ref="historyList" :class="$style.list" aria-label="Viewing entries">
              <li v-for="item in historyRows" :key="item.viewingId">
                <NuxtLink :class="$style.row" :to="item.location" :data-viewing-id="item.viewingId">
                  <CatalogPoster compact :poster-url="item.posterUrl" :title="item.title" />
                  <div :class="$style.copy">
                    <h3 :class="$style.itemTitle" :lang="item.titleLocale">{{ item.title }}</h3>
                    <p :class="$style.metadata">{{ item.metadata }}</p>
                    <div :class="$style.viewingState">
                      <AppStatusChip :tone="item.tone" :class="$style.status"><Icon :class="$style.statusIcon" aria-hidden="true" mode="svg" :name="item.statusIcon" />{{ item.statusLabel }}</AppStatusChip>
                      <span :class="[$style.score, { 'is-rated': item.isRated }]">{{ item.scoreLabel }}</span>
                    </div>
                    <p v-for="date in item.dates" :key="date.label" :class="$style.timestamp">{{ date.label }} <time :datetime="date.value">{{ date.display }}</time></p>
                  </div>
                </NuxtLink>
              </li>
            </ul>

            <div v-if="showLoadMore" :class="$style.more">
              <AppButton :class="$style.action" size="small" :aria-disabled="isLoadingMore" :aria-busy="isLoadingMore" variant="secondary" @click="loadOlderViewings">Load more</AppButton>
              <AppMessage v-if="hasLoadMoreError" role="alert" tone="danger">We couldn’t load older viewings. Try again.</AppMessage>
            </div>
          </section>

          <section :class="$style.series" :aria-labelledby="seriesHeadingId">
            <div :class="$style.sectionHeader">
              <h2 :id="seriesHeadingId" :class="$style.subheading">Currently watching</h2>
              <NuxtLink v-if="hasMoreActiveSeries" :class="$style.catalogLink" :to="watchingLocation" @click.prevent="viewAllWatching">View all</NuxtLink>
            </div>
            <div v-if="isSummaryLoading" :class="$style.seriesSkeleton" aria-label="Loading active series" aria-busy="true">
              <div v-for="row in 3" :key="row" :class="$style.skeletonText" aria-hidden="true" />
            </div>
            <p v-else-if="hasSummaryError" :class="$style.supportingText">Active series are unavailable. Retry the viewing summary above.</p>
            <p v-else-if="isSeriesEmpty" :class="$style.supportingText">No series in progress.</p>
            <ul v-else :class="$style.seriesList" aria-label="Currently watching series">
              <li v-for="item in seriesRows" :key="item.viewingId">
                <NuxtLink :class="$style.seriesLink" :to="item.location">
                  <CatalogPoster compact :poster-url="item.posterUrl" :title="item.title" />
                  <div :class="$style.copy">
                    <h3 :class="$style.itemTitle" :lang="item.titleLocale">{{ item.title }}</h3>
                    <p :class="$style.metadata">{{ item.label }}</p>
                  </div>
                </NuxtLink>
              </li>
            </ul>
          </section>
        </div>
      </main>
    </AppShell>
  </div>
</template>

<script lang="ts" setup>
  import { definePageMeta } from '#app/composables/pages'
  import { navigateTo, useHead, useResponseHeader, useRoute, useRouter } from '#app'
  import { useEventListener } from '@vueuse/core'
  import type { CatalogViewingStatus } from '@tv/shared/catalog'
  import { computed, nextTick, ref, useId, useTemplateRef, watch } from 'vue'
  import AppShell from '~/components/app/AppShell.vue'
  import CatalogPoster from '~/components/catalog/CatalogPoster.vue'
  import AppButton from '~/components/ui/AppButton.vue'
  import AppMessage from '~/components/ui/AppMessage.vue'
  import AppStatusChip from '~/components/ui/AppStatusChip.vue'
  import { catalogViewingStatusSchema } from '@tv/shared/catalog-viewings'
  import { viewingStatusPresentation } from '~/utils/catalog-viewing-status.ts'
  import { useAuthSession } from '~/composables/use-auth-session.ts'
  import { useViewingHistory } from '~/composables/use-viewing-history.ts'
  import { formatCalendarDateForDisplay } from '~/utils/calendar-date.ts'
  import { useViewingSummary } from '~/composables/use-viewing-summary.ts'

  definePageMeta({ middleware: 'authenticated' })
  useHead({ title: 'Dashboard · TV' })

  const cacheControlHeader = useResponseHeader('Cache-Control')

  cacheControlHeader.value = 'private, no-store'

  const route = useRoute()
  const router = useRouter()
  const { restoreSession, setAnonymous, state } = useAuthSession()
  const isAuthenticated = computed(() => state.value.status === 'authenticated')
  const hasSessionError = computed(() => state.value.status === 'error')
  const accountId = computed(() => state.value.status === 'authenticated' ? state.value.user.id : null)

  const selectedStatus = computed(() => {
    const value = route.query.status
    const status = catalogViewingStatusSchema.options.find(option => option === value)

    return status ?? null
  })

  const isFiltered = computed(() => selectedStatus.value !== null)

  const filters = [{
    label: 'All',
    value: null
  }, {
    label: 'Watching',
    value: 'watching'
  }, {
    label: 'Paused',
    value: 'paused'
  }, {
    label: 'Dropped',
    value: 'dropped'
  }, {
    label: 'Completed',
    value: 'completed'
  }] as const

  const filterName = useId()
  const historyHeadingId = useId()
  const seriesHeadingId = useId()
  const isRetryingSession = ref(false)
  const isAddingPage = ref(false)
  const announcement = ref('')
  let actionGeneration = 0
  let focusGeneration = 0

  useEventListener('focusin', () => { focusGeneration += 1 })
  useEventListener('pointerdown', () => { focusGeneration += 1 })

  const heading = useTemplateRef('heading')
  const historyHeading = useTemplateRef('historyHeading')
  const historyList = useTemplateRef('historyList')
  const historyRetryButton = useTemplateRef('historyRetryButton')
  const summaryRetryButton = useTemplateRef('summaryRetryButton')
  const sessionRetryButton = useTemplateRef('sessionRetryButton')

  const {
    hasError: hasHistoryError,
    hasLoadMoreError,
    hasMore,
    isLoading: isHistoryLoading,
    isLoadingMore,
    isRefreshing: isHistoryRefreshing,
    items,
    loadMore,
    needsRefresh,
    ready: historyReady,
    reload: reloadHistory,
    unauthorized: historyUnauthorized
  } = useViewingHistory(accountId, selectedStatus)

  const {
    hasError: hasSummaryError,
    isLoading: isSummaryLoading,
    isRefreshing: isSummaryRefreshing,
    ready: summaryReady,
    reload: reloadSummary,
    summary,
    unauthorized: summaryUnauthorized
  } = useViewingSummary(accountId)

  const isRefreshing = computed(() => isHistoryRefreshing.value || isSummaryRefreshing.value || isHistoryLoading.value || isSummaryLoading.value)
  const showLoadMore = computed(() => hasMore.value || isAddingPage.value)
  const isHistoryEmpty = computed(() => items.value.length === 0)
  const emptyHeading = computed(() => isFiltered.value ? 'No viewings with this status' : 'No viewings yet')
  const isSeriesEmpty = computed(() => (summary.value?.activeSeries.length ?? 0) === 0)
  const hasMoreActiveSeries = computed(() => (summary.value?.watchingSeriesCount ?? 0) > 5)

  const watchingLocation = computed(() => {return {
    path: '/dashboard',

    query: {
      ...route.query,
      status: 'watching'
    }
  }})

  const shouldSignIn = computed(() => state.value.status === 'anonymous' || historyUnauthorized.value || summaryUnauthorized.value)

  const historyRows = computed(() => items.value.map(item => {
    const typeLabel = item.type === 'movie' ? 'Movie' : 'Series'
    const metadata = item.releaseYear === null ? typeLabel : `${typeLabel} · ${item.releaseYear}`
    const presentation = viewingStatusPresentation[item.status]
    const dates = []

    if (item.startedOn !== null) {
      const display = formatCalendarDateForDisplay(item.startedOn, { dateStyle: 'medium' })

      dates.push({
        label: 'Started on',
        value: item.startedOn,
        display
      })
    }

    if (item.completedOn !== null) {
      const display = formatCalendarDateForDisplay(item.completedOn, { dateStyle: 'medium' })
      const label = item.type === 'movie' ? 'Watched on' : 'Completed on'

      dates.push({
        label,
        value: item.completedOn,
        display
      })
    }

    return {
      viewingId: item.viewingId,
      location: `/titles/${item.id}`,
      dates,
      metadata,
      tone: presentation.tone,
      statusIcon: presentation.icon,
      statusLabel: presentation.label,
      scoreLabel: item.score === null ? 'Not rated' : `${item.score}/10`,
      isRated: item.score !== null,
      posterUrl: item.posterUrl,
      title: item.title,
      titleLocale: item.titleLocale
    }
  }))

  const seriesRows = computed(() => (summary.value?.activeSeries ?? []).map(item => {
    const noun = item.watchedEpisodeCount === 1 ? 'episode' : 'episodes'

    return {
      viewingId: item.viewingId,
      label: `${item.watchedEpisodeCount} ${noun} watched`,
      location: `/titles/${item.id}`,
      posterUrl: item.posterUrl,
      title: item.title,
      titleLocale: item.titleLocale
    }
  }))

  watch([accountId, selectedStatus], () => {
    actionGeneration += 1
    announcement.value = ''
    isAddingPage.value = false
  }, { flush: 'sync' })

  watch(shouldSignIn, async redirect => {
    if (!redirect) { return }

    if (historyUnauthorized.value || summaryUnauthorized.value) { setAnonymous() }

    await navigateTo({
      path: '/sign-in',
      query: { redirectTo: route.fullPath }
    }, { replace: true })
  }, {
    flush: 'sync',
    immediate: true
  })

  if (import.meta.server) { await Promise.all([historyReady, summaryReady]) }

  async function selectStatus(status: CatalogViewingStatus | null): Promise<void> {
    const query = { ...route.query }

    if (status === null) { delete query.status } else { query.status = status }

    await router.push({
      path: '/dashboard',
      query
    })
  }

  async function viewAllWatching(): Promise<void> {
    await selectStatus('watching')
    await nextTick()
    historyHeading.value?.focus()
  }

  async function showAll(): Promise<void> {
    await selectStatus(null)
    await nextTick()
    historyHeading.value?.focus()
  }

  async function retrySession(): Promise<void> {
    const requestedFocus = focusGeneration

    isRetryingSession.value = true

    await restoreSession({ force: true })

    isRetryingSession.value = false

    await nextTick()

    if (requestedFocus !== focusGeneration) { return }

    if (hasSessionError.value) { sessionRetryButton.value?.focus() } else { heading.value?.focus() }
  }

  async function retrySummary(): Promise<void> {
    if (isSummaryRefreshing.value) { return }

    const requestedFocus = focusGeneration
    const requestedAction = actionGeneration
    const succeeded = await reloadSummary()

    await nextTick()

    if (requestedFocus !== focusGeneration || requestedAction !== actionGeneration) { return }

    if (succeeded) { heading.value?.focus() } else { summaryRetryButton.value?.focus() }
  }

  async function retryHistory(): Promise<void> {
    if (isHistoryRefreshing.value) { return }

    const requestedFocus = focusGeneration
    const requestedAction = actionGeneration
    const succeeded = await reloadHistory()

    await nextTick()

    if (requestedFocus !== focusGeneration || requestedAction !== actionGeneration) { return }

    if (succeeded) { historyHeading.value?.focus() } else { historyRetryButton.value?.focus() }
  }

  async function loadOlderViewings(event: MouseEvent): Promise<void> {
    if (isLoadingMore.value || isRefreshing.value) { return }

    const trigger = event.currentTarget

    actionGeneration += 1

    const requestGeneration = actionGeneration

    isAddingPage.value = true
    announcement.value = 'Loading older viewings…'

    const added = await loadMore()

    await nextTick()

    const isCurrent = isAuthenticated.value && requestGeneration === actionGeneration

    if (isCurrent) {
      const succeeded = !hasLoadMoreError.value && !needsRefresh.value
      const addedAnnouncement = added.length === 1 ? '1 older viewing added.' : `${added.length} older viewings added.`
      const pageAnnouncement = succeeded ? addedAnnouncement : ''

      announcement.value = needsRefresh.value ? 'Your viewings changed. Reload this page to load more.' : pageAnnouncement

      if (globalThis.document.activeElement === trigger) {
        const [first] = added

        if (first !== undefined) {
          const selector = `a[data-viewing-id="${first.viewingId}"]`

          historyList.value?.querySelector<HTMLAnchorElement>(selector)?.focus()
        } else if (!hasMore.value) {
          historyHeading.value?.focus()
        }
      }
    }

    if (isCurrent) { isAddingPage.value = false }
  }
</script>
<style module>
  @layer reset, vendor, tokens, base, components, utilities;

  @layer components {
    .component { min-block-size: 100svh; }
    .content { max-inline-size: var(--layout-content-max); margin-inline: auto; padding: var(--space-6) var(--layout-page-mobile); }
    .pageHeader { margin-block-end: var(--space-6); }
    .heading { font-size: 1.75rem; line-height: 1.15; font-weight: 600; }
    .supportingText { margin-block-start: var(--space-3); color: var(--color-text-secondary); }
    .metrics { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3); margin-block-end: var(--space-8); }
    .metric { min-block-size: 7rem; display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-4); border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface); }
    .metricLabel { color: var(--color-text-secondary); font-size: 0.875rem; }
    .metricValue { margin-block-start: auto; font-size: 2rem; font-weight: 600; font-variant-numeric: tabular-nums; }
    .columns { display: grid; gap: var(--space-8); }
    .history, .series { min-inline-size: 0; }
    .subheading { font-size: 1.375rem; font-weight: 600; }
    .sectionHeader { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-3); margin-block-end: var(--space-4); }
    .filters { display: flex; flex-wrap: wrap; gap: var(--space-2); padding: 0; border: 0; margin-block-end: var(--space-4); }
    .filter { display: inline-flex; align-items: center; gap: var(--space-2); min-block-size: 2.75rem; padding: var(--space-2) var(--space-3); border: 1px solid var(--color-border-strong); border-radius: var(--radius-sm); background: var(--color-surface); font-size: 0.875rem; cursor: pointer; }
    .filter:has(:checked) { border-color: var(--color-accent); }
    .filter input { accent-color: var(--color-accent); }
    .action[aria-disabled='true'] { background: var(--color-surface-muted); color: var(--color-text-secondary); cursor: progress; }
    .status { gap: var(--space-1); }
    .statusIcon { inline-size: 1rem; block-size: 1rem; flex-shrink: 0; }
    .viewingState { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); margin-block: var(--space-1); }
    .score {
      color: var(--color-text-secondary);
      font-size: 0.875rem;
      font-variant-numeric: tabular-nums;
      &:global(.is-rated) { color: var(--color-accent); font-weight: 600; }
    }
    .list, .seriesList { display: grid; gap: var(--space-3); padding: 0; list-style: none; }
    .row { display: grid; grid-template-columns: 5rem minmax(0, 1fr); align-items: center; gap: var(--space-4); padding: var(--space-3); border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface); color: var(--color-text-primary); text-decoration: none; }
    .row:hover, .seriesLink:hover { border-color: var(--color-border-strong); }
    .copy { display: grid; gap: var(--space-1); }
    .itemTitle { overflow-wrap: anywhere; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; font-size: 1rem; line-height: 1.5; font-weight: 600; }
    .metadata, .timestamp { color: var(--color-text-secondary); font-size: 0.875rem; }
    .timestamp { font-variant-numeric: tabular-nums; }
    .more, .message { display: grid; justify-items: start; gap: var(--space-4); margin-block: var(--space-4); }
    .catalogLink { display: inline-flex; align-items: center; min-block-size: 2.75rem; }
    .seriesLink { display: grid; grid-template-columns: 5rem minmax(0, 1fr); align-items: center; gap: var(--space-3); padding: var(--space-3); border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface); color: var(--color-text-primary); text-decoration: none; }
    .skeletonPoster, .skeletonText, .skeletonValue { background: var(--color-surface-muted); border-radius: var(--radius-sm); }
    .skeletonPoster { inline-size: 5rem; aspect-ratio: 2 / 3; }
    .skeletonText { block-size: 1.25rem; inline-size: 85%; }
    .skeletonValue { block-size: 2.5rem; inline-size: 3rem; }
    .seriesSkeleton { display: grid; gap: var(--space-6); }
    .visuallyHidden { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    .sessionPanel { display: grid; justify-items: start; gap: var(--space-4); max-inline-size: 38rem; margin-inline: auto; padding: var(--space-8) var(--space-4); }
    .wordmark { color: var(--color-accent); font-size: 2rem; font-weight: 700; }
    @media (width >= 40rem) {
      .content { padding: var(--space-8) var(--layout-page-compact); }
      .heading { font-size: 2.25rem; }
      .metrics { grid-template-columns: repeat(4, minmax(0, 1fr)); }
      .subheading { font-size: 1.5rem; }
      .row { grid-template-columns: 6rem minmax(0, 1fr); }
      .seriesLink { grid-template-columns: 6rem minmax(0, 1fr); }
      .skeletonPoster { inline-size: 6rem; }
      .columns { grid-template-columns: minmax(0, 1fr) 15rem; gap: var(--space-6); }
    }
    @media (forced-colors: active) {
      .filter:has(:checked) { border-color: Highlight; }
    }
    @media (width >= 64rem) {
      .content { padding-inline: var(--layout-page-wide); }
      .columns { grid-template-columns: minmax(0, 1fr) var(--layout-rail); gap: var(--space-8); }
    }
  }
</style>
