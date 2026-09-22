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
          <p :class="$style.supportingText">Your current watched marks. Dates show when you marked a title, not when you watched it.</p>
        </header>

        <section v-if="isSummaryLoading" :class="$style.metrics" aria-label="Loading viewing summary" aria-busy="true">
          <div v-for="metric in 2" :key="metric" :class="$style.metric" aria-hidden="true">
            <span :class="$style.skeletonText" />
            <span :class="$style.skeletonValue" />
          </div>
        </section>
        <section v-else-if="hasSummaryError" :class="$style.message" aria-label="Viewing summary">
          <AppMessage role="alert" tone="danger">We couldn’t load your viewing summary. Try again.</AppMessage>
          <AppButton ref="summaryRetryButton" variant="secondary" @click="retrySummary">Retry summary</AppButton>
        </section>
        <dl v-else-if="summary" :class="$style.metrics" aria-label="Viewing summary">
          <div :class="$style.metric">
            <dt :class="$style.metricLabel">Movies watched</dt>
            <dd :class="$style.metricValue">{{ summary.watchedMovieCount }}</dd>
          </div>
          <div :class="$style.metric">
            <dt :class="$style.metricLabel">Episodes watched</dt>
            <dd :class="$style.metricValue">{{ summary.watchedEpisodeCount }}</dd>
          </div>
        </dl>

        <div :class="$style.columns">
          <section :class="$style.history" :aria-labelledby="historyHeadingId">
            <h2 :id="historyHeadingId" ref="historyHeading" :class="$style.subheading" tabindex="-1">Viewing history</h2>
            <p role="status" :class="$style.status">{{ announcement }}</p>

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
              <AppMessage role="alert" tone="danger">We couldn’t load your viewing history. Try again.</AppMessage>
              <AppButton ref="historyRetryButton" variant="secondary" @click="retryHistory">Retry history</AppButton>
            </div>
            <div v-else-if="isHistoryEmpty" :class="$style.message">
              <h3 :class="$style.itemTitle">Nothing marked as watched yet</h3>
              <p :class="$style.supportingText">Open a movie or series and mark what you have watched to see it here.</p>
              <NuxtLink :class="$style.catalogLink" to="/">Browse catalog</NuxtLink>
            </div>
            <ul v-else ref="historyList" :class="$style.list" aria-label="Watched marks">
              <li v-for="item in historyRows" :key="item.key">
                <NuxtLink :class="$style.row" :to="item.location" :data-entry-key="item.key">
                  <CatalogPoster compact :poster-url="item.posterUrl" :title="item.title" />
                  <div :class="$style.copy">
                    <h3 :class="$style.itemTitle" :lang="item.titleLocale">{{ item.title }}</h3>
                    <p :class="$style.metadata">{{ item.metadata }}</p>
                    <p v-if="item.sourceTitle" :class="$style.episodeTitle">{{ item.sourceTitle }}</p>
                    <p :class="$style.timestamp">Marked <NuxtTime :datetime="item.markedAt" date-style="medium" time-style="short" /></p>
                  </div>
                </NuxtLink>
              </li>
            </ul>

            <div v-if="hasMore" :class="$style.more">
              <AppMessage v-if="hasLoadMoreError" role="alert" tone="danger">We couldn’t load older marks. Try again.</AppMessage>
              <AppButton ref="loadMoreButton" :disabled="isLoadingMore" :aria-busy="isLoadingMore" variant="secondary" @click="loadOlderMarks">Load more</AppButton>
            </div>
          </section>

          <section :class="$style.series" :aria-labelledby="seriesHeadingId">
            <h2 :id="seriesHeadingId" :class="$style.subheading">By series</h2>
            <div v-if="isSummaryLoading" :class="$style.seriesSkeleton" aria-label="Loading series summary" aria-busy="true">
              <div v-for="row in 3" :key="row" :class="$style.skeletonText" aria-hidden="true" />
            </div>
            <p v-else-if="hasSummaryError" :class="$style.supportingText">Series counts are unavailable. Retry the viewing summary above.</p>
            <p v-else-if="isSeriesEmpty" :class="$style.supportingText">No episodes marked as watched yet.</p>
            <ul v-else :class="$style.seriesList" aria-label="Watched episodes by series">
              <li v-for="item in seriesRows" :key="item.id">
                <NuxtLink :class="$style.seriesLink" :to="item.location">
                  <h3 :class="$style.itemTitle" :lang="item.titleLocale">{{ item.title }}</h3>
                  <p :class="$style.metadata">{{ item.label }}</p>
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
  import { navigateTo, useHead, useResponseHeader } from '#app'
  import { NuxtTime } from '#components'
  import { computed, nextTick, ref, useId, useTemplateRef, watch } from 'vue'
  import AppShell from '~/components/app/AppShell.vue'
  import CatalogPoster from '~/components/catalog/CatalogPoster.vue'
  import AppButton from '~/components/ui/AppButton.vue'
  import AppMessage from '~/components/ui/AppMessage.vue'
  import { useAuthSession } from '~/composables/use-auth-session.ts'
  import { useViewingHistory } from '~/composables/use-viewing-history.ts'
  import { useViewingSummary } from '~/composables/use-viewing-summary.ts'

  definePageMeta({ middleware: 'authenticated' })
  useHead({ title: 'Dashboard · TV' })

  const cacheControlHeader = useResponseHeader('Cache-Control')

  cacheControlHeader.value = 'private, no-store'

  const { restoreSession, setAnonymous, state } = useAuthSession()
  const isAuthenticated = computed(() => state.value.status === 'authenticated')
  const hasSessionError = computed(() => state.value.status === 'error')
  const accountId = computed(() => state.value.status === 'authenticated' ? state.value.user.id : null)
  const historyHeadingId = useId()
  const seriesHeadingId = useId()
  const isRetryingSession = ref(false)
  const announcement = ref('')
  const heading = useTemplateRef('heading')
  const historyHeading = useTemplateRef('historyHeading')
  const historyList = useTemplateRef('historyList')
  const historyRetryButton = useTemplateRef('historyRetryButton')
  const summaryRetryButton = useTemplateRef('summaryRetryButton')
  const sessionRetryButton = useTemplateRef('sessionRetryButton')
  const loadMoreButton = useTemplateRef('loadMoreButton')

  const {
    hasError: hasHistoryError,
    hasLoadMoreError,
    hasMore,
    isLoading: isHistoryLoading,
    isLoadingMore,
    items,
    loadMore,
    ready: historyReady,
    reload: reloadHistory,
    unauthorized: historyUnauthorized
  } = useViewingHistory(accountId)

  const {
    hasError: hasSummaryError,
    isLoading: isSummaryLoading,
    ready: summaryReady,
    reload: reloadSummary,
    summary,
    unauthorized: summaryUnauthorized
  } = useViewingSummary(accountId)

  const isHistoryEmpty = computed(() => items.value.length === 0)
  const isSeriesEmpty = computed(() => (summary.value?.series.length ?? 0) === 0)
  const shouldSignIn = computed(() => state.value.status === 'anonymous' || historyUnauthorized.value || summaryUnauthorized.value)

  const historyRows = computed(() => items.value.map((item) => {
    const movieMetadata = item.releaseYear === null ? 'Movie' : `Movie · ${item.releaseYear}`
    const metadata = item.kind === 'episode' ? `Episode · S${item.seasonNumber} · E${item.episodeNumber}` : movieMetadata

    return {
      key: `${item.kind}:${item.entryId}`,
      location: `/titles/${item.id}`,
      markedAt: item.markedAt,
      metadata,
      posterUrl: item.posterUrl,
      sourceTitle: item.sourceTitle,
      title: item.title,
      titleLocale: item.titleLocale
    }
  }))

  const seriesRows = computed(() => (summary.value?.series ?? []).map((item) => {
    const noun = item.watchedEpisodeCount === 1 ? 'episode' : 'episodes'

    return {
      id: item.id,
      label: `${item.watchedEpisodeCount} ${noun} watched`,
      location: `/titles/${item.id}`,
      title: item.title,
      titleLocale: item.titleLocale
    }
  }))

  watch(accountId, () => { announcement.value = '' }, { flush: 'sync' })

  watch(shouldSignIn, async (redirect) => {
    if (!redirect) {
      return
    }

    if (historyUnauthorized.value || summaryUnauthorized.value) {
      setAnonymous()
    }

    await navigateTo({
      path: '/sign-in',
      query: { redirectTo: '/dashboard' }
    }, { replace: true })
  }, {
    flush: 'sync',
    immediate: true
  })

  if (import.meta.server) {
    await Promise.all([historyReady, summaryReady])
  }

  async function retrySession(): Promise<void> {
    isRetryingSession.value = true

    await restoreSession({ force: true })

    isRetryingSession.value = false

    await nextTick()

    if (hasSessionError.value) {
      sessionRetryButton.value?.focus()
    } else {
      heading.value?.focus()
    }
  }

  async function retrySummary(): Promise<void> {
    await reloadSummary()
    await nextTick()

    if (hasSummaryError.value) {
      summaryRetryButton.value?.focus()
    } else {
      heading.value?.focus()
    }
  }

  async function retryHistory(): Promise<void> {
    await reloadHistory()
    await nextTick()

    if (hasHistoryError.value) {
      historyRetryButton.value?.focus()
    } else {
      historyHeading.value?.focus()
    }
  }

  async function loadOlderMarks(): Promise<void> {
    const requestedAccountId = accountId.value

    announcement.value = 'Loading older marks…'

    const added = await loadMore()

    await nextTick()

    if (!isAuthenticated.value || requestedAccountId !== accountId.value) {
      return
    }

    if (hasLoadMoreError.value) {
      announcement.value = ''

      loadMoreButton.value?.focus()

      return
    }

    const [first] = added

    announcement.value = added.length === 1 ? '1 older mark added.' : `${added.length} older marks added.`

    if (first !== undefined) {
      const selector = `a[data-entry-key="${first.kind}:${first.entryId}"]`

      historyList.value?.querySelector<HTMLAnchorElement>(selector)?.focus()
    } else if (hasMore.value) {
      loadMoreButton.value?.focus()
    } else {
      historyHeading.value?.focus()
    }
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
    .metricValue { font-size: 2rem; font-weight: 600; font-variant-numeric: tabular-nums; }
    .columns { display: grid; gap: var(--space-8); }
    .history, .series { min-inline-size: 0; }
    .subheading { margin-block-end: var(--space-4); font-size: 1.375rem; font-weight: 600; }
    .list, .seriesList { display: grid; gap: var(--space-3); padding: 0; list-style: none; }
    .row { display: grid; grid-template-columns: 5rem minmax(0, 1fr); align-items: center; gap: var(--space-4); padding: var(--space-3); border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface); color: var(--color-text-primary); text-decoration: none; }
    .row:hover, .seriesLink:hover { border-color: var(--color-border-strong); }
    .copy { display: grid; gap: var(--space-1); }
    .itemTitle { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; font-size: 1rem; line-height: 1.5; font-weight: 600; }
    .metadata, .episodeTitle, .timestamp { color: var(--color-text-secondary); font-size: 0.875rem; }
    .episodeTitle { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
    .timestamp { font-variant-numeric: tabular-nums; }
    .more, .message { display: grid; justify-items: start; gap: var(--space-4); margin-block: var(--space-4); }
    .catalogLink { display: inline-flex; align-items: center; min-block-size: 2.75rem; }
    .seriesLink { display: block; padding: var(--space-3); border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface); color: var(--color-text-primary); text-decoration: none; }
    .skeletonPoster, .skeletonText, .skeletonValue { background: var(--color-surface-muted); border-radius: var(--radius-sm); }
    .skeletonPoster { inline-size: 5rem; aspect-ratio: 2 / 3; }
    .skeletonText { block-size: 1.25rem; inline-size: 85%; }
    .skeletonValue { block-size: 2.5rem; inline-size: 3rem; }
    .seriesSkeleton { display: grid; gap: var(--space-6); }
    .status { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    .sessionPanel { display: grid; justify-items: start; gap: var(--space-4); max-inline-size: 38rem; margin-inline: auto; padding: var(--space-8) var(--space-4); }
    .wordmark { color: var(--color-accent); font-size: 2rem; font-weight: 700; }
    @media (width >= 40rem) {
      .content { padding: var(--space-8) var(--layout-page-compact); }
      .heading { font-size: 2.25rem; }
      .subheading { font-size: 1.5rem; }
      .row { grid-template-columns: 6rem minmax(0, 1fr); }
      .skeletonPoster { inline-size: 6rem; }
      .columns { grid-template-columns: minmax(0, 1fr) 15rem; gap: var(--space-6); }
    }
    @media (width >= 64rem) {
      .content { padding-inline: var(--layout-page-wide); }
      .columns { grid-template-columns: minmax(0, 1fr) var(--layout-rail); gap: var(--space-8); }
    }
  }
</style>
