<template>
  <section :class="$style.component" :aria-labelledby="episodesHeadingId">
    <h2 :id="episodesHeadingId" :class="$style.accessible">Episodes</h2>

    <div v-if="isEpisodesLoading" :class="$style.loading" aria-busy="true" aria-label="Loading episodes">
      <div v-for="placeholder in 3" :key="placeholder" :class="$style.skeleton" aria-hidden="true" />
    </div>
    <div v-else-if="hasEpisodesError" :class="$style.message">
      <AppMessage role="alert" tone="danger">We couldn’t load the episodes. The title details are still available.</AppMessage>
      <AppButton variant="secondary" @click="emit('retryEpisodes')">Try again</AppButton>
    </div>
    <div v-else-if="isEpisodesEmpty" :class="$style.message">
      <p :class="$style.supportingText">No episode data is available yet.</p>
    </div>
    <template v-else>
      <p v-if="showWatchedStatus" :class="$style.watchedCount" role="status">{{ watchedStatusLabel }}</p>
      <p v-else :class="$style.watchedCount">{{ episodeCountLabel }}</p>
      <p v-if="isBulkSaving" :class="$style.accessible" role="status">Saving watched episodes…</p>
      <AppMessage v-if="actionError" role="alert" tone="danger">{{ actionError }}</AppMessage>
      <div v-if="showReadError" :class="$style.privateError">
        <AppMessage role="alert" tone="danger">{{ readError }}</AppMessage>
        <AppButton variant="secondary" :disabled="isSaving" @click="emit('retryWatched')">Retry watched status</AppButton>
      </div>
      <div v-if="hasWatchedError" :class="$style.privateError">
        <AppMessage role="alert" tone="danger">We couldn’t load your watched episodes. The episode list is still available.</AppMessage>
        <AppButton variant="secondary" @click="emit('retryWatched')">Retry watched status</AppButton>
      </div>

      <ExpansionPanel.Group v-model="selectedSeason" :class="$style.seasons">
        <ExpansionPanel.Root v-for="season in seasons" :key="season.number" v-slot="{ isSelected }" :value="season.number" :class="$style.season">
          <div :class="$style.seasonHeader">
            <ExpansionPanel.Header :class="$style.seasonHeading" :aria-label="season.label">
              <ExpansionPanel.Activator :class="$style.seasonToggle" :aria-label="season.label" :aria-describedby="season.metadataId">
                <ExpansionPanel.Cue :class="$style.seasonCue"><Icon mode="svg" name="hugeicons:arrow-down-01" /></ExpansionPanel.Cue>
                <span :class="$style.seasonIdentity">
                  <span :class="$style.seasonLabel">{{ season.label }}</span>
                  <span :id="season.metadataId" :class="$style.seasonMetadata">{{ season.metadata }}</span>
                </span>
              </ExpansionPanel.Activator>
            </ExpansionPanel.Header>
          </div>
          <ExpansionPanel.Content :class="$style.seasonContent" :aria-hidden="!isSelected || undefined" :inert="!isSelected">
            <div :class="$style.seasonClip">
              <Presence :model-value="isSelected && isActive" lazy>
                <div :class="$style.seasonDetails">
                  <slot name="season-rating" :season-number="season.number" :is-active="isSelected && isActive" />
                  <div v-if="showBulkActions" :class="$style.watchedActions" role="group" :aria-label="season.actionsLabel">
                    <AppButton v-if="season.hasReleasedEpisodes" size="small" variant="secondary" :aria-label="season.actionLabel" :disabled="isWatchedDisabled" :aria-busy="season.isSaving || undefined" @click="emit('markReleased', season.number)">Mark season watched</AppButton>
                    <AppButton size="small" variant="secondary" :disabled="isWatchedDisabled" :aria-busy="isAllSaving || undefined" aria-label="Mark all episodes watched" @click="emit('markReleased', null)">Mark all watched</AppButton>
                  </div>
                  <CatalogEpisodeRatings
                    :key="season.ratingsKey"
                    :account-id="accountId"
                    :catalog-item-id="catalogItemId"
                    :season-number="season.number"
                    :episode-ids="season.episodeIds"
                    @unauthorized="emit('ratingUnauthorized', $event)"
                  >
                    <template #default="{ ratings, summaries }">
                      <ul :class="$style.episodeList">
                        <li v-for="{ episode, headingId, isWatched, isEpisodeSaving, showWatchedControl } in season.rows" :key="episode.id" :class="$style.episode" :aria-labelledby="headingId" tabindex="-1">
                          <div :class="$style.episodeIdentity">
                            <p :class="$style.episodeNumber"><span :class="$style.accessible">Season {{ episode.seasonNumber }}, </span>E{{ episode.episodeNumber }}</p>
                            <div>
                              <h4 :id="headingId" :class="$style.episodeTitle">{{ episodeTitle(episode) }}</h4>
                              <p v-if="episode.airDate !== null" :class="$style.airDate">
                                <time :datetime="episode.airDate">{{ formatAirDate(episode.airDate) }}</time>
                              </p>
                            </div>
                          </div>
                          <CatalogEpisodeRating
                            :account-id="accountId"
                            :is-active="isSelected && isActive"
                            :episode="episode"
                            :has-session-error="hasSessionError"
                            :is-anonymous="isAnonymous"
                            :sign-in-location="signInLocation"
                            :ratings="ratings"
                            :summaries="summaries"
                            @saved="emit('ratingSaved')"
                          />
                          <NuxtLink v-if="showWatchedControl && isAnonymous" :class="$style.signInLink" :to="signInLocation" :aria-describedby="headingId" aria-label="Sign in to mark watched">
                            <span :class="$style.accessible">Sign in to mark watched</span>
                          </NuxtLink>
                          <AppButton
                            v-else-if="showWatchedControl && hasSessionError"
                            :class="$style.watchedButton"
                            size="small"
                            icon-only
                            :aria-describedby="headingId"
                            aria-label="Watched unavailable"
                            disabled
                            variant="secondary"
                          >
                            <span :class="$style.accessible">Watched unavailable</span>
                          </AppButton>
                          <AppButton
                            v-else-if="showWatchedControl"
                            :aria-busy="episodeAriaBusy(episode.id)"
                            :aria-describedby="headingId"
                            :aria-pressed="isWatched"
                            :class="$style.watchedButton"
                            size="small"
                            icon-only
                            :disabled="isWatchedDisabled"
                            aria-label="Watched"
                            variant="secondary"
                            @click="toggleWatched(episode, $event)"
                          >
                            <span v-if="isEpisodeSaving" :class="$style.savingIndicator" aria-hidden="true" />
                            <Icon v-else-if="isWatched" aria-hidden="true" mode="svg" name="hugeicons:tick-02" />
                          </AppButton>
                          <AppMessage v-if="saveErrorFor(episode.id) !== ''" :class="$style.episodeError" role="alert" tone="danger">
                            {{ saveErrorFor(episode.id) }}
                          </AppMessage>
                        </li>
                      </ul>
                    </template>
                  </CatalogEpisodeRatings>
                </div>
              </Presence>
            </div>
          </ExpansionPanel.Content>
        </ExpansionPanel.Root>
      </ExpansionPanel.Group>

      <p :class="$style.credit">
        <a href="https://www.tvmaze.com/">Episode data from TVMaze</a>
      </p>
    </template>
  </section>
</template>

<script setup lang="ts">
  import type { CatalogEpisode } from '@tv/shared/catalog'
  import type { RouteLocationRaw } from 'vue-router'
  import { computed, ref, useId, watch } from 'vue'
  import { ExpansionPanel, Presence } from '@vuetify/v0/components'
  import CatalogEpisodeRatings from '~/components/catalog/CatalogEpisodeRatings.vue'
  import CatalogEpisodeRating from '~/components/catalog/CatalogEpisodeRating.vue'
  import { useBrowserToday } from '~/composables/use-browser-today.ts'
  import AppButton from '~/components/ui/AppButton.vue'
  import AppMessage from '~/components/ui/AppMessage.vue'

  interface EpisodeRow {
    episode: CatalogEpisode;
    headingId: string;
    isWatched: boolean;
    isEpisodeSaving: boolean;
    isReleased: boolean;
    showWatchedControl: boolean;
  }

  interface SeasonRow {
    number: number;
    label: string;
    metadata: string;
    metadataId: string;
    actionLabel: string;
    actionsLabel: string;
    hasReleasedEpisodes: boolean;
    isSaving: boolean;
    ratingsKey: string;
    episodeIds: string[];
    rows: EpisodeRow[];
  }

  interface WatchFocus {
    accountId: string | null;
    seasonNumber: number;
    row: HTMLElement;
    trigger: HTMLElement;
  }

  interface Props {
    accountId: string | null;
    catalogItemId: string;
    isActive: boolean;
    episodes: CatalogEpisode[];
    hasEpisodesError: boolean;
    hasSessionError: boolean;
    isAnonymous: boolean;
    isEpisodesEmpty: boolean;
    isEpisodesLoading: boolean;
    isSaving: boolean;
    actionError: string;
    readError: string;
    saveErrorFor: (episodeId: string) => string;
    savingEpisodeId: string | null;
    savingAction: string | null;
    signInLocation: RouteLocationRaw;
    watchedCount: number;
    watchedEpisodeIds: string[];
    watchedStatus: 'idle' | 'loading' | 'loaded' | 'error';
  }

  interface Emits {
    ratingUnauthorized: [reason: 'load' | 'mutation'];
    ratingSaved: [];
    markReleased: [seasonNumber: number | null];
    retryEpisodes: [];
    retryWatched: [];
    toggleWatched: [episodeId: string];
  }

  const { accountId, catalogItemId, episodes, hasSessionError, isActive, isAnonymous, isSaving, readError, savingAction, savingEpisodeId, watchedCount, watchedEpisodeIds, watchedStatus } = defineProps<Props>()
  const emit = defineEmits<Emits>()
  const selectedSeason = ref<number | undefined>()
  const episodesHeadingId = useId()
  const seasonId = useId()
  const { today } = useBrowserToday()
  let hasSelectedInitialSeason = false
  let watchFocus: WatchFocus | null = null

  const seasonNumbers = computed(() => {
    const episodeSeasons = episodes.map(episode => episode.seasonNumber)
    const numbers = new Set(episodeSeasons)
    const sortedNumbers = [...numbers].toSorted((first, second) => second - first)

    return sortedNumbers
  })

  function isReleased(episode: CatalogEpisode): boolean {
    return today.value !== null && episode.airDate !== null && episode.airDate <= today.value
  }

  const hasReleasedEpisodes = computed(() => episodes.some(episode => isReleased(episode)))
  const showBulkActions = computed(() => !isAnonymous && !hasSessionError && watchedStatus === 'loaded' && hasReleasedEpisodes.value)
  const newestSeason = computed(() => seasonNumbers.value.at(0) ?? 1)

  const seasons = computed(() => {
    const rowsBySeason = new Map<number, EpisodeRow[]>()
    const watchedIds = new Set(watchedEpisodeIds)

    for (const episode of episodes) {
      let rows = rowsBySeason.get(episode.seasonNumber)

      if (rows === undefined) {
        rows = []

        rowsBySeason.set(episode.seasonNumber, rows)
      }

      const headingId = `episode-${episode.id}`
      const isWatched = watchedIds.has(episode.id)
      const isEpisodeSaving = isSaving && savingEpisodeId === episode.id
      const released = isReleased(episode)
      const showWatchedControl = released || isWatched

      rows.push({
        episode,
        headingId,
        isWatched,
        isEpisodeSaving,
        isReleased: released,
        showWatchedControl
      })
    }

    const result: SeasonRow[] = []

    for (const number of seasonNumbers.value) {
      const rows = rowsBySeason.get(number) ?? []
      const episodeIds = rows.map(row => row.episode.id)
      const episodeKey = episodeIds.join(':')
      const count = rows.length
      const noun = count === 1 ? 'episode' : 'episodes'
      const episodeCount = `${count} ${noun}`
      const watchedRows = rows.filter(row => row.isWatched)
      const watched = watchedRows.length
      const showProgress = !isAnonymous && !hasSessionError && watchedStatus === 'loaded'
      const metadata = showProgress ? `${episodeCount} · ${watched} watched` : episodeCount
      const hasSeasonReleasedEpisodes = rows.some(row => row.isReleased)

      result.push({
        number,
        label: `Season ${number}`,
        metadata,
        metadataId: `${seasonId}-${number}-metadata`,
        actionLabel: `Mark season ${number} watched`,
        actionsLabel: `Watched actions for season ${number}`,
        hasReleasedEpisodes: hasSeasonReleasedEpisodes,
        isSaving: isSaving && savingAction === `season:${number}`,
        ratingsKey: `${catalogItemId}:${number}:${episodeKey}`,
        episodeIds,
        rows
      })
    }

    return result
  })

  const isWatchedLoading = computed(() => !isAnonymous && !hasSessionError && (
    watchedStatus === 'idle' || watchedStatus === 'loading'
  ))

  const hasWatchedError = computed(() => watchedStatus === 'error')
  const showReadError = computed(() => readError !== '' && !hasWatchedError.value)
  const isBulkSaving = computed(() => isSaving && (savingAction === 'all' || savingAction?.startsWith('season:') === true))
  const isAllSaving = computed(() => isSaving && savingAction === 'all')

  const episodeCountLabel = computed(() => {
    const noun = episodes.length === 1 ? 'episode' : 'episodes'

    return `${episodes.length} ${noun}`
  })

  const isWatchedDisabled = computed(() => watchedStatus !== 'loaded' || isSaving)
  const showWatchedStatus = computed(() => isWatchedLoading.value || watchedStatus === 'loaded')

  const watchedStatusLabel = computed(() => {
    if (isWatchedLoading.value) {
      return 'Loading watched status…'
    }

    const noun = watchedCount === 1 ? 'episode' : 'episodes'

    return `${watchedCount} watched ${noun}`
  })

  watch(seasonNumbers, (numbers) => {
    if (!hasSelectedInitialSeason && numbers.length > 0) {
      hasSelectedInitialSeason = true
      selectedSeason.value = newestSeason.value
    } else if (selectedSeason.value !== undefined && !numbers.includes(selectedSeason.value)) {
      selectedSeason.value = newestSeason.value
    }
  }, { immediate: true })

  watch(() => watchedEpisodeIds, () => {
    const focus = watchFocus

    if (focus === null || focus.trigger.isConnected) {
      return
    }

    watchFocus = null

    const ownsFocus = globalThis.document.activeElement === globalThis.document.body
    const isSameScope = isActive && accountId === focus.accountId && selectedSeason.value === focus.seasonNumber && focus.row.isConnected

    if (ownsFocus && isSameScope) {
      focus.row.focus()
    }
  }, { flush: 'post' })

  function toggleWatched(episode: CatalogEpisode, event: MouseEvent): void {
    const trigger = event.currentTarget
    const row = trigger instanceof globalThis.HTMLElement ? trigger.closest('li') : null

    watchFocus = trigger instanceof globalThis.HTMLElement && row !== null ? {
      accountId,
      seasonNumber: episode.seasonNumber,
      row,
      trigger
    } : null

    emit('toggleWatched', episode.id)
  }

  function episodeTitle(episode: CatalogEpisode): string {
    const title = episode.sourceTitle?.trim()

    if (title === undefined || title === '' || title.toUpperCase() === 'TBA') {
      return `Episode ${episode.episodeNumber}`
    }

    return title
  }

  function formatAirDate(airDate: string): string {
    const [year, month, day] = airDate.split('-').map(Number)
    const localDate = new Date(year ?? 0, (month ?? 1) - 1, day ?? 1)

    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(localDate)
  }

  function episodeAriaBusy(episodeId: string): true | undefined {
    const isEpisodeSaving = isSaving && savingEpisodeId === episodeId
    const isBusy = isWatchedLoading.value || isEpisodeSaving

    return isBusy || undefined
  }
</script>

<style module>
  @layer reset, vendor, tokens, base, components, utilities;

  @layer components {
    .component { container: episodes / inline-size; display: grid; gap: var(--space-5); }
    .watchedCount, .supportingText, .airDate, .credit { color: var(--color-text-secondary); }
    .watchedCount { font-size: 0.875rem; }
    .seasons { border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface); }
    .season + .season { border-block-start: 1px solid var(--color-border); }
    .season:first-child .seasonHeader { border-start-start-radius: var(--radius-md); border-start-end-radius: var(--radius-md); }
    .season:last-child:not([data-selected]) .seasonHeader { border-end-start-radius: var(--radius-md); border-end-end-radius: var(--radius-md); }
    .seasonHeader:hover, .seasonHeader:focus-within { background: var(--color-surface-muted); }
    .seasonHeading { font-size: 1rem; }
    .seasonToggle { display: flex; align-items: center; gap: var(--space-3); inline-size: 100%; min-block-size: 4rem; padding: var(--space-3) var(--space-4); border: 0; border-radius: 0; background: transparent; color: var(--color-text-primary); text-align: start; cursor: pointer; }
    .seasonIdentity { display: grid; gap: var(--space-1); }
    .seasonLabel { font-weight: 600; }
    .seasonMetadata { color: var(--color-text-secondary); font-size: 0.875rem; font-weight: 400; font-variant-numeric: tabular-nums; }
    .seasonCue { display: flex; flex: 0 0 auto; color: var(--color-text-secondary); transition: transform var(--duration-disclosure) var(--ease-standard); &[data-state='open'] { transform: rotate(180deg); } }
    .seasonCue :global(svg) { inline-size: 1.25rem; block-size: 1.25rem; }
    .seasonContent {
      /* Override hidden's display rule for the exit transition; inert and aria-hidden close access immediately. */
      display: grid;
      grid-template-rows: 0fr;
      visibility: hidden;
      transition: grid-template-rows var(--duration-disclosure) var(--ease-standard), visibility 0s linear var(--duration-disclosure);
      &[data-selected] { grid-template-rows: 1fr; visibility: visible; transition-delay: 0s; }
    }
    .seasonClip { min-block-size: 0; overflow: clip; }
    .seasonDetails { display: grid; gap: var(--space-4); padding: var(--space-4); border-block-start: 1px solid var(--color-border); }
    .watchedActions { display: flex; flex-wrap: wrap; justify-content: end; gap: var(--space-2); }
    .loading, .episodeList {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
    }
    .loading { gap: var(--space-3); }
    .episodeList { gap: 0; padding: 0; list-style: none; }
    .skeleton {
      min-block-size: 5rem;
      border-radius: var(--radius-md);
      background: var(--color-surface-muted);
    }
    .message, .privateError { display: grid; justify-items: start; gap: var(--space-3); }
    .episode {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 2.75rem;
      align-items: center;
      gap: var(--space-3);
      padding-block: var(--space-3);
    }
    .episode + .episode { border-block-start: 1px solid var(--color-border); }
    .episodeIdentity { grid-column: 1 / -1; display: grid; grid-template-columns: 2rem minmax(0, 1fr); align-items: center; gap: var(--space-3); }
    .episodeNumber {
      color: var(--color-text-secondary);
      font-size: 0.875rem;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
    .episodeTitle { font-size: 1rem; font-weight: 600; }
    .airDate { margin-block-start: var(--space-1); font-size: 0.875rem; }
    .signInLink { inline-size: 2.75rem; min-block-size: 2.75rem; padding: 0; border-radius: var(--radius-sm); }
    .watchedButton[aria-pressed='true'], .watchedButton[aria-pressed='true']:disabled {
      border-color: var(--color-accent);
      background: var(--color-surface-selected);
      color: var(--color-accent);
    }
    .savingIndicator { inline-size: 1.25rem; block-size: 1.25rem; border: 0.125rem solid currentcolor; border-inline-end-color: transparent; border-radius: var(--radius-round); animation: saving-spin 0.8s linear infinite; }
    @keyframes saving-spin { to { transform: rotate(1turn); } }
    @media (prefers-reduced-motion: reduce) {
      .savingIndicator { animation: none; }
      .seasonContent, .seasonCue { transition: none; }
    }
    .episodeError { grid-column: 1 / -1; }
    .accessible { position: absolute; inline-size: 1px; block-size: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
    .signInLink {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 1px solid var(--color-border-strong);
      color: var(--color-text-primary);
      text-align: center;
      text-decoration: none;
    }
    .credit { font-size: 0.875rem; }
    .credit a { color: inherit; text-underline-offset: 0.2em; }
    @media (forced-colors: active) {
      .watchedButton[aria-pressed='true'], .watchedButton[aria-pressed='true']:disabled { border-color: SelectedItem; }
    }
    @container episodes (width >= 34rem) {
      .episode { grid-template-columns: minmax(0, 1fr) 13.5rem 2.75rem; gap: var(--space-4); }
      .episodeIdentity { grid-column: auto; }
    }
  }
</style>
