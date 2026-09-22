<template>
  <AppShell active-destination="catalog">
    <main :class="$style.component">
      <NuxtLink :class="$style.backLink" :to="backLocation">{{ backLabel }}</NuxtLink>
      <section v-if="isLoading" :class="$style.loading" aria-label="Loading title" aria-busy="true">
        <div :class="$style.posterSkeleton" aria-hidden="true" />
        <div :class="$style.loadingCopy"><h1 :class="$style.heading">Loading title…</h1></div>
      </section>
      <section v-else-if="isNotFound" :class="$style.message">
        <h1 ref="heading" :class="$style.heading" tabindex="-1">Title not found</h1>
        <p :class="$style.supportingText">This title isn’t in our catalog. Check the link or return to the catalog.</p>
      </section>
      <section v-else-if="hasError" :class="$style.message">
        <h1 ref="heading" :class="$style.heading" tabindex="-1">We couldn’t load this title.</h1>
        <AppMessage role="alert" tone="danger">The title is temporarily unavailable. Try again.</AppMessage>
        <AppButton ref="retryButton" @click="retry">Try again</AppButton>
      </section>
      <article v-else-if="item" :class="$style.details">
        <CatalogPoster :key="posterKey" :poster-url="item.posterUrl" :title="item.title" />
        <div :class="$style.information">
          <p :class="$style.metadata">{{ metadata }}</p>
          <h1 ref="heading" :class="$style.heading" :lang="item.titleLocale" tabindex="-1">{{ item.title }}</h1>
          <p v-if="showOriginalTitle" :class="$style.originalTitle" :lang="item.originalTitleLocale">{{ item.originalTitle }}</p>
          <div :class="$style.personalActions">
            <section :class="$style.personalAction" aria-label="Follow action">
              <NuxtLink v-if="isAnonymous" :class="$style.actionLink" data-variant="primary" :to="signInLocation">Follow</NuxtLink>
              <AppButton v-else-if="hasSessionError" :class="$style.actionButton" disabled variant="secondary">Follow unavailable</AppButton>
              <template v-else-if="isAuthenticated && followStatus === 'error'">
                <AppMessage role="alert" tone="danger">We couldn’t check your follow status. Try again.</AppMessage>
                <AppButton ref="followRetryButton" aria-label="Retry follow status" :class="$style.actionButton" variant="secondary" @click="retryFollow">Retry</AppButton>
              </template>
              <template v-else-if="isAuthenticated && followStatus === 'loaded'">
                <AppButton
                  ref="followButton"
                  :aria-busy="isSaving || undefined"
                  :aria-pressed="followed"
                  :class="$style.actionButton"
                  :disabled="isSaving"
                  :variant="followed ? 'secondary' : 'primary'"
                  @click="toggleFollow"
                >
                  <span aria-hidden="true" :class="$style.actionIndicator" data-action-icon="follow">
                    <Icon :class="$style.actionStateIcon" mode="svg" name="hugeicons:bookmark-02" />
                    <span :class="$style.actionProgress" data-loading-indicator />
                  </span>
                  Follow
                </AppButton>
                <AppMessage v-if="saveError !== ''" role="alert" tone="danger">{{ saveError }}</AppMessage>
              </template>
              <AppButton v-else :class="$style.actionButton" aria-busy="true" disabled variant="secondary">Checking follow status…</AppButton>
            </section>
            <section v-if="isMovie" :class="$style.personalAction" aria-label="Watched action">
              <NuxtLink v-if="isAnonymous" :class="$style.actionLink" data-variant="secondary" :to="signInLocation">Mark as watched</NuxtLink>
              <AppButton v-else-if="hasSessionError" :class="$style.actionButton" disabled variant="secondary">Watched unavailable</AppButton>
              <template v-else-if="isAuthenticated && watchedStatus === 'error'">
                <AppMessage role="alert" tone="danger">We couldn’t check whether you watched this movie. Try again.</AppMessage>
                <AppButton ref="watchedRetryButton" aria-label="Retry watched status" :class="$style.actionButton" variant="secondary" @click="retryWatched">Retry</AppButton>
              </template>
              <template v-else-if="isAuthenticated && watchedStatus === 'loaded'">
                <AppButton
                  ref="watchedButton"
                  :aria-busy="isSavingWatched || undefined"
                  :aria-pressed="watched"
                  :class="$style.actionButton"
                  :disabled="isSavingWatched"
                  variant="secondary"
                  @click="toggleWatched"
                >
                  <span aria-hidden="true" :class="$style.actionIndicator" data-action-icon="watched">
                    <Icon :class="$style.actionStateIcon" mode="svg" :name="watchedIconName" />
                    <span :class="$style.actionProgress" data-loading-indicator />
                  </span>
                  Watched
                </AppButton>
                <AppMessage v-if="watchedSaveError !== ''" role="alert" tone="danger">{{ watchedSaveError }}</AppMessage>
              </template>
              <AppButton v-else :class="$style.actionButton" aria-busy="true" disabled variant="secondary">Checking watched status…</AppButton>
            </section>
          </div>
          <section v-if="isMovie" :class="$style.overview" :aria-labelledby="overviewId">
            <h2 :id="overviewId" :class="$style.subheading">Overview</h2>
            <p v-if="hasDescription" :class="$style.description" :lang="descriptionLocale">{{ item.description }}</p>
            <p v-else :class="$style.supportingText">No description available yet.</p>
          </section>
        </div>
        <section v-if="isSeries" :class="$style.seriesContent" aria-label="Series details">
          <div :class="$style.tabs" role="tablist" aria-label="Series information">
            <button
              :id="overviewTabId"
              ref="overviewTab"
              :aria-controls="overviewPanelId"
              :aria-selected="isOverviewTabActive"
              :class="$style.tab"
              role="tab"
              :tabindex="overviewTabIndex"
              type="button"
              @click="activateTab('overview')"
              @keydown="handleTabKeydown"
            >
              Overview
            </button>
            <button
              :id="episodesTabId"
              ref="episodesTab"
              :aria-controls="episodesPanelId"
              :aria-selected="isEpisodesTabActive"
              :class="$style.tab"
              role="tab"
              :tabindex="episodesTabIndex"
              type="button"
              @click="activateTab('episodes')"
              @keydown="handleTabKeydown"
            >
              Episodes
            </button>
          </div>

          <div
            v-show="isEpisodesTabActive"
            :id="episodesPanelId"
            :aria-labelledby="episodesTabId"
            :class="$style.tabPanel"
            role="tabpanel"
            tabindex="0"
          >
            <CatalogEpisodeList
              :episodes="episodes"
              :has-episodes-error="hasEpisodesError"
              :has-session-error="hasSessionError"
              :is-anonymous="isAnonymous"
              :is-episodes-empty="isEpisodesEmpty"
              :is-episodes-loading="isEpisodesLoading"
              :is-saving="isSavingEpisode"
              :save-error-for="episodeSaveErrorFor"
              :saving-episode-id="savingEpisodeId"
              :sign-in-location="signInLocation"
              :watched-count="watchedEpisodeCount"
              :watched-episode-ids="watchedEpisodeIds"
              :watched-status="episodeWatchesStatus"
              @retry-episodes="retryEpisodes"
              @retry-watched="retryEpisodeWatches"
              @toggle-watched="toggleEpisodeWatched"
            />
          </div>
          <div
            v-show="isOverviewTabActive"
            :id="overviewPanelId"
            :aria-labelledby="overviewTabId"
            :class="$style.tabPanel"
            role="tabpanel"
            tabindex="0"
          >
            <section :class="$style.overview" :aria-labelledby="seriesOverviewId">
              <h2 :id="seriesOverviewId" :class="$style.subheading">Overview</h2>
              <p v-if="hasDescription" :class="$style.description" :lang="descriptionLocale">{{ item.description }}</p>
              <p v-else :class="$style.supportingText">No description available yet.</p>
            </section>
          </div>
        </section>
      </article>
    </main>
  </AppShell>
</template>

<script lang="ts" setup>
  import { definePageMeta } from '#app/composables/pages'
  import { navigateTo, useHead, useNuxtApp, useRequestEvent, useResponseHeader, useRoute } from '#app'
  import { sanitizeRedirectTo } from '@tv/shared/redirect'
  import { setResponseStatus } from 'h3'
  import { computed, nextTick, ref, useId, useTemplateRef, watch } from 'vue'
  import AppButton from '~/components/ui/AppButton.vue'
  import AppMessage from '~/components/ui/AppMessage.vue'
  import AppShell from '~/components/app/AppShell.vue'
  import CatalogPoster from '~/components/catalog/CatalogPoster.vue'
  import CatalogEpisodeList from '~/components/catalog/CatalogEpisodeList.vue'
  import { useAuthSession } from '~/composables/use-auth-session.ts'
  import { useCatalogDetails } from '~/composables/use-catalog-details.ts'
  import { useCatalogEpisodes } from '~/composables/use-catalog-episodes.ts'
  import { useCatalogEpisodeWatches } from '~/composables/use-catalog-episode-watches.ts'
  import { useCatalogFollow } from '~/composables/use-catalog-follow.ts'
  import { useCatalogWatched } from '~/composables/use-catalog-watched.ts'
  import { normalizeSearchQuery } from '~/utils/catalog-response.ts'

  definePageMeta({
    key: route => `${route.path}:${String(route.query.titleLocale ?? 'en')}`
  })

  const route = useRoute()
  const nuxtApp = useNuxtApp()
  const event = useRequestEvent()
  const cacheControl = useResponseHeader('Cache-Control')

  cacheControl.value = 'private, no-store'

  const id = typeof route.params.id === 'string' ? route.params.id : ''
  const titleLocale = typeof route.query.titleLocale === 'string' ? route.query.titleLocale : 'en'
  const { restoreSession, setAnonymous, state: sessionState } = useAuthSession()
  const shouldRevalidateSession = import.meta.client && !nuxtApp.isHydrating
  const sessionReady = restoreSession({ force: shouldRevalidateSession })
  const { hasError, isLoading, isNotFound, item, ready } = useCatalogDetails(id, titleLocale)
  const accountId = computed(() => sessionState.value.status === 'authenticated' ? sessionState.value.user.id : null)
  const followCatalogItemId = computed(() => item.value?.id ?? null)
  const watchedCatalogItemId = computed(() => item.value?.type === 'movie' ? item.value.id : null)

  const {
    clearUnauthorized,
    followed,
    isSaving,
    load: loadFollow,
    saveError,
    status: followStatus,
    toggle: saveFollow,
    unauthorized: followUnauthorized
  } = useCatalogFollow(followCatalogItemId, accountId)

  const {
    clearUnauthorized: clearWatchedUnauthorized,
    isSaving: isSavingWatched,
    load: loadWatched,
    saveError: watchedSaveError,
    status: watchedStatus,
    toggle: saveWatched,
    unauthorized: watchedUnauthorized,
    watched
  } = useCatalogWatched(watchedCatalogItemId, accountId)

  const heading = useTemplateRef('heading')
  const retryButton = useTemplateRef('retryButton')
  const followButton = useTemplateRef('followButton')
  const followRetryButton = useTemplateRef('followRetryButton')
  const watchedButton = useTemplateRef('watchedButton')
  const watchedRetryButton = useTemplateRef('watchedRetryButton')
  const episodesTab = useTemplateRef('episodesTab')
  const overviewTab = useTemplateRef('overviewTab')
  const watchedIconName = computed(() => watched.value ? 'hugeicons:checkmark-circle-02' : 'hugeicons:circle')
  const overviewId = useId()
  const seriesOverviewId = useId()
  const episodesTabId = useId()
  const episodesPanelId = useId()
  const overviewTabId = useId()
  const overviewPanelId = useId()
  const activeTab = ref<'episodes' | 'overview'>('episodes')
  const isEpisodesTabActive = computed(() => activeTab.value === 'episodes')
  const isOverviewTabActive = computed(() => activeTab.value === 'overview')
  const episodesTabIndex = computed(() => isEpisodesTabActive.value ? 0 : -1)
  const overviewTabIndex = computed(() => isOverviewTabActive.value ? 0 : -1)
  const posterKey = computed(() => item.value?.posterUrl ?? 'missing-poster')
  const searchQuery = computed(() => normalizeSearchQuery(route.query.query))
  const backLabel = computed(() => searchQuery.value === '' ? 'Back to catalog' : 'Back to results')
  const isAnonymous = computed(() => sessionState.value.status === 'anonymous')
  const isAuthenticated = computed(() => sessionState.value.status === 'authenticated')
  const hasSessionError = computed(() => sessionState.value.status === 'error')
  const isMovie = computed(() => item.value?.type === 'movie')
  const isSeries = computed(() => item.value?.type === 'series')
  const redirectTo = computed(() => sanitizeRedirectTo(route.fullPath))

  const signInLocation = computed(() => redirectTo.value === '/'
    ? '/sign-in'
    : {
        path: '/sign-in',
        query: { redirectTo: redirectTo.value }
      })

  const backLocation = computed(() => {
    const query = searchQuery.value === '' ? {} : { query: searchQuery.value }

    return {
      path: '/',
      query
    }
  })

  const showOriginalTitle = computed(() => item.value !== undefined && item.value.originalTitle !== item.value.title)
  const hasDescription = computed(() => item.value?.description !== null && item.value?.description !== undefined)
  const descriptionLocale = computed(() => item.value?.descriptionLocale ?? undefined)

  const metadata = computed(() => {
    if (item.value === undefined) {
      return ''
    }

    const type = item.value.type === 'movie' ? 'Movie' : 'Series'

    return item.value.releaseYear === null ? type : `${type} · ${item.value.releaseYear}`
  })

  useHead(() => {
    const title = item.value === undefined ? 'Title details · TV' : `${item.value.title} · TV`

    return { title }
  })

  watch(followUnauthorized, async (reason) => {
    if (reason === null) {
      return
    }

    clearUnauthorized()
    setAnonymous()

    if (reason === 'mutation') {
      await navigateTo(signInLocation.value, { replace: true })
    }
  }, {
    flush: 'sync'
  })

  watch(watchedUnauthorized, async (reason) => {
    if (reason === null) {
      return
    }

    clearWatchedUnauthorized()
    setAnonymous()

    if (reason === 'mutation') {
      await navigateTo(signInLocation.value, { replace: true })
    }
  }, {
    flush: 'sync'
  })

  await ready

  const episodeCatalogItemId = computed(() => item.value?.type === 'series' ? item.value.id : null)

  const {
    hasError: hasEpisodesError,
    isEmpty: isEpisodesEmpty,
    isLoading: isEpisodesLoading,
    items: episodes,
    ready: episodesReady,
    reload: reloadEpisodes
  } = useCatalogEpisodes(episodeCatalogItemId, id)

  const {
    clearUnauthorized: clearEpisodeWatchesUnauthorized,
    isSaving: isSavingEpisode,
    load: loadEpisodeWatches,
    saveErrorFor: episodeSaveErrorFor,
    savingEpisodeId,
    status: episodeWatchesStatus,
    toggle: toggleEpisodeWatched,
    unauthorized: episodeWatchesUnauthorized,
    watchedCount: watchedEpisodeCount,
    watchedEpisodeIds
  } = useCatalogEpisodeWatches(episodeCatalogItemId, accountId)

  watch(episodeWatchesUnauthorized, async (reason) => {
    if (reason === null) {
      return
    }

    clearEpisodeWatchesUnauthorized()
    setAnonymous()

    if (reason === 'mutation') {
      await navigateTo(signInLocation.value, { replace: true })
    }
  }, {
    flush: 'sync'
  })

  await episodesReady

  // Lazy title requests start on mount, so only SSR waits for account restoration.
  if (import.meta.server) {
    await sessionReady
  }

  if (event !== undefined) {
    let status = 200

    if (isNotFound.value) {
      status = 404
    } else if (hasError.value) {
      status = 503
    }

    setResponseStatus(event, status)
  }

  function canRestoreActionFocus(focusOwner: Element | null): boolean {
    const { activeElement } = globalThis.document

    return activeElement === focusOwner || activeElement === globalThis.document.body
  }

  async function retry(): Promise<void> {
    const focusOwner = globalThis.document.activeElement

    await ready.execute({ dedupe: 'cancel' })
    await nextTick()

    if (!canRestoreActionFocus(focusOwner)) {
      return
    }

    if (hasError.value) {
      retryButton.value?.focus()
    } else {
      heading.value?.focus()
    }
  }

  async function retryFollow(): Promise<void> {
    const focusOwner = globalThis.document.activeElement

    await loadFollow()
    await nextTick()

    if (!canRestoreActionFocus(focusOwner)) {
      return
    }

    if (followStatus.value === 'error') {
      followRetryButton.value?.focus()
    } else if (followStatus.value === 'loaded') {
      followButton.value?.focus()
    } else {
      heading.value?.focus()
    }
  }

  async function toggleFollow(): Promise<void> {
    const focusOwner = globalThis.document.activeElement

    await saveFollow()
    await nextTick()

    if (!canRestoreActionFocus(focusOwner)) {
      return
    }

    if (isAuthenticated.value && followStatus.value === 'loaded') {
      followButton.value?.focus()
    }
  }

  async function retryWatched(): Promise<void> {
    const focusOwner = globalThis.document.activeElement

    await loadWatched()
    await nextTick()

    if (!canRestoreActionFocus(focusOwner)) {
      return
    }

    if (watchedStatus.value === 'error') {
      watchedRetryButton.value?.focus()
    } else if (watchedStatus.value === 'loaded') {
      watchedButton.value?.focus()
    } else {
      heading.value?.focus()
    }
  }

  async function toggleWatched(): Promise<void> {
    const focusOwner = globalThis.document.activeElement

    await saveWatched()
    await nextTick()

    if (!canRestoreActionFocus(focusOwner)) {
      return
    }

    if (isAuthenticated.value && watchedStatus.value === 'loaded') {
      watchedButton.value?.focus()
    }
  }

  function activateTab(tab: 'episodes' | 'overview', focus = false): void {
    activeTab.value = tab

    if (!focus) {
      return
    }

    if (tab === 'episodes') {
      episodesTab.value?.focus()
    } else {
      overviewTab.value?.focus()
    }
  }

  function handleTabKeydown(keyboardEvent: KeyboardEvent): void {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End']

    if (!keys.includes(keyboardEvent.key)) {
      return
    }

    keyboardEvent.preventDefault()

    if (keyboardEvent.key === 'Home') {
      activateTab('overview', true)

      return
    }

    if (keyboardEvent.key === 'End') {
      activateTab('episodes', true)

      return
    }

    const nextTab = activeTab.value === 'episodes' ? 'overview' : 'episodes'

    activateTab(nextTab, true)
  }

  async function retryEpisodeWatches(): Promise<void> {
    const focusOwner = globalThis.document.activeElement

    await loadEpisodeWatches()
    await nextTick()

    if (canRestoreActionFocus(focusOwner)) {
      episodesTab.value?.focus()
    }
  }

  async function retryEpisodes(): Promise<void> {
    const focusOwner = globalThis.document.activeElement

    await reloadEpisodes()
    await nextTick()

    if (canRestoreActionFocus(focusOwner)) {
      episodesTab.value?.focus()
    }
  }

</script>

<style module>
  @layer reset, vendor, tokens, base, components, utilities;

  @layer components {
    .component {
      max-inline-size: 76rem;
      margin-inline: auto;
      padding: var(--space-6) var(--layout-page-mobile) var(--space-12);
    }
    .backLink {
      display: inline-flex;
      align-items: center;
      min-block-size: 2.75rem;
      margin-block-end: var(--space-6);
      color: var(--color-text-secondary);
      text-underline-offset: 0.25em;
    }
    .details, .loading {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: var(--space-8);
      > :first-child { max-inline-size: 16rem; }
    }
    .information { padding-block: var(--space-2); }
    .heading {
      margin-block: var(--space-2) var(--space-3);
      font-size: 1.75rem;
      font-weight: 600;
      line-height: 1.15;
    }
    .metadata, .originalTitle, .supportingText { color: var(--color-text-secondary); }
    .metadata { font-size: 0.875rem; }
    .personalActions {
      display: flex;
      flex-wrap: wrap;
      align-items: start;
      gap: var(--space-3);
      margin-block-start: var(--space-6);
    }
    .personalAction {
      display: grid;
      justify-items: start;
      gap: var(--space-3);
      min-inline-size: min(100%, 13rem);
      max-inline-size: 24rem;
    }
    .actionButton, .actionLink { min-inline-size: min(100%, 13rem); }
    .actionButton {
      --action-progress-delay: 1s;

      position: relative;
    }
    .actionIndicator {
      position: absolute;
      inset-block-start: 50%;
      inset-inline-start: var(--space-6);
      inline-size: 1.25rem;
      block-size: 1.25rem;
      color: currentcolor;
      pointer-events: none;
      transform: translateY(-50%);
    }
    .actionStateIcon, .actionProgress {
      position: absolute;
      inset: 0;
      inline-size: 100%;
      block-size: 100%;
    }
    .actionButton[aria-pressed='true'],
    .actionButton[aria-pressed='true']:disabled {
      border-color: var(--color-accent);
      background: var(--color-surface-selected);
      color: var(--color-text-primary);
    }
    .actionButton[aria-pressed='true'] .actionStateIcon { color: var(--color-accent); }
    .actionButton[aria-pressed='true'] .actionIndicator[data-action-icon='follow'] .actionStateIcon :global(path) {
      fill: currentcolor;
    }
    .actionProgress {
      box-sizing: border-box;
      visibility: hidden;
      border: 0.125rem solid currentcolor;
      border-inline-end-color: transparent;
      border-radius: var(--radius-round);
      opacity: 0;
    }
    .actionButton[aria-busy='true'] .actionStateIcon {
      animation: action-state-hide var(--duration-fast) var(--ease-standard) var(--action-progress-delay) forwards;
    }
    .actionButton[aria-busy='true'] .actionProgress {
      animation:
        action-progress-reveal var(--duration-fast) var(--ease-standard) var(--action-progress-delay) forwards,
        action-progress-spin 0.8s linear var(--action-progress-delay) infinite;
    }
    .actionLink {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-block-size: 3.5rem;
      padding: var(--space-3) var(--space-6);
      border-radius: var(--radius-md);
      font-weight: 700;
      text-decoration: none;
      transition:
        filter var(--duration-fast) var(--ease-standard),
        transform var(--duration-fast) var(--ease-standard);
    }
    .actionLink[data-variant='primary'] {
      background: var(--color-accent-fill);
      color: var(--color-on-accent);
    }
    .actionLink[data-variant='secondary'] {
      border: 1px solid var(--color-border-strong);
      background: var(--color-surface);
      color: var(--color-text-primary);
    }
    .actionLink:hover { filter: brightness(0.96); }
    .actionLink:active { transform: translateY(0.0625rem); }
    .overview {
      margin-block-start: var(--space-8);
      padding-block-start: var(--space-6);
      border-block-start: 1px solid var(--color-border);
    }
    .seriesContent {
      display: grid;
      grid-column: 1 / -1;
      gap: var(--space-6);
      margin-block-start: var(--space-2);
    }
    .tabs {
      display: flex;
      gap: var(--space-6);
      border-block-end: 1px solid var(--color-border);
    }
    .tab {
      position: relative;
      min-block-size: 2.75rem;
      padding-inline: var(--space-1);
      border: 0;
      background: transparent;
      color: var(--color-text-secondary);
      font-weight: 600;
      cursor: pointer;
    }
    .tab[aria-selected='true'] {
      color: var(--color-text-primary);
    }
    .tab[aria-selected='true']::after {
      position: absolute;
      inset-block-end: -1px;
      inset-inline: 0;
      block-size: 3px;
      background: var(--color-accent);
      content: '';
    }
    .tabPanel { min-inline-size: 0; }
    .tabPanel .overview {
      margin-block-start: 0;
      padding-block-start: 0;
      border-block-start: 0;
    }
    .subheading {
      margin-block-end: var(--space-4);
      font-size: 1.375rem;
      font-weight: 600;
    }
    .description { max-inline-size: 65ch; line-height: 1.65; }
    .message { display: grid; justify-items: start; gap: var(--space-4); }
    .posterSkeleton { inline-size: 100%; aspect-ratio: 2 / 3; border-radius: var(--radius-lg); background: var(--color-surface-muted); }
    .loadingCopy { color: var(--color-text-secondary); }
    @keyframes action-state-hide {
      from { opacity: 1; }
      to { opacity: 0; }
    }
    @keyframes action-progress-reveal {
      from { visibility: visible; opacity: 0; }
      to { visibility: visible; opacity: 1; }
    }
    @keyframes action-progress-spin {
      to { transform: rotate(1turn); }
    }
    @media (prefers-reduced-motion: reduce) {
      .actionLink { transition: none; }
      .actionButton[aria-busy='true'] .actionStateIcon {
        animation: action-state-hide 0s linear var(--action-progress-delay) forwards;
      }
      .actionButton[aria-busy='true'] .actionProgress {
        animation: action-progress-reveal 0s linear var(--action-progress-delay) forwards;
      }
    }
    @media (forced-colors: active) {
      .actionButton[aria-pressed='true'],
      .actionButton[aria-pressed='true']:disabled {
        border-color: SelectedItem;
      }
    }
    @media (width >= 40rem) {
      .component { padding-inline: var(--layout-page-compact); }
      .details, .loading { grid-template-columns: minmax(10rem, 14rem) minmax(0, 1fr); }
      .heading { font-size: 2.25rem; line-height: 1.17; }
    }
    @media (width >= 64rem) {
      .component { padding: var(--space-8) var(--layout-page-wide) var(--space-16); }
      .details, .loading { grid-template-columns: 17rem minmax(0, 1fr); gap: var(--space-10); > :first-child { max-inline-size: none; } }
    }
  }
</style>
