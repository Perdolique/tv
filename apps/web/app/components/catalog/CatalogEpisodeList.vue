<template>
  <section :class="$style.component" aria-labelledby="episodes-heading">
    <h2 id="episodes-heading" :class="$style.accessible">Episodes</h2>
    <div :class="$style.header">
      <h3 v-if="showSeasonHeading" :class="[$style.seasonHeading, { 'is-accessible': hasSeasonSelector }]">Season {{ selectedSeason }}</h3>
      <label v-if="hasSeasonSelector" :class="$style.seasonField">
        <span :class="$style.accessible">Season</span>
        <select v-model.number="selectedSeason" :class="$style.seasonSelect">
          <option v-for="seasonNumber in seasonNumbers" :key="seasonNumber" :value="seasonNumber">
            Season {{ seasonNumber }}
          </option>
        </select>
      </label>
      <p v-if="showWatchedStatus" :class="$style.watchedCount" role="status">{{ watchedStatusLabel }}</p>
    </div>

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
      <slot name="season-rating" :season-number="selectedSeason" />
      <section v-if="showBulkActions" :class="$style.bulk" aria-label="Mark released episodes">
        <p :class="$style.supportingText">Only episodes with a known air date up to today in your time zone are included.</p>
        <div :class="$style.bulkActions">
          <AppButton variant="secondary" :disabled="isWatchedDisabled" :aria-busy="isSaving || undefined" @click="emit('markReleased', selectedSeason)">Mark released episodes in season {{ selectedSeason }}</AppButton>
          <AppButton variant="secondary" :disabled="isWatchedDisabled" @click="emit('markReleased', null)">Mark all released episodes</AppButton>
        </div>
        <p v-if="isBulkSaving" :class="$style.supportingText" role="status">Saving released episodes…</p>
        <AppMessage v-if="actionError" role="alert" tone="danger">{{ actionError }}</AppMessage>
      </section>
      <div v-if="showReadError" :class="$style.privateError">
        <AppMessage role="alert" tone="danger">{{ readError }}</AppMessage>
        <AppButton variant="secondary" :disabled="isSaving" @click="emit('retryWatched')">Retry watched status</AppButton>
      </div>
      <div v-if="hasWatchedError" :class="$style.privateError">
        <AppMessage role="alert" tone="danger">We couldn’t load your watched episodes. The episode list is still available.</AppMessage>
        <AppButton variant="secondary" @click="emit('retryWatched')">Retry watched status</AppButton>
      </div>

      <CatalogEpisodeRatings
        v-if="isActive"
        :key="ratingsKey"
        :account-id="accountId"
        :catalog-item-id="catalogItemId"
        :season-number="selectedSeason"
        :episode-ids="selectedEpisodeIds"
        @unauthorized="emit('ratingUnauthorized', $event)"
      >
        <template #default="{ ratings, summaries }">
          <ul :class="$style.episodeList">
            <li v-for="{ episode, headingId, isWatched, isEpisodeSaving } in selectedEpisodeRows" :key="episode.id" :class="$style.episode">
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
                :episode="episode"
                :has-session-error="hasSessionError"
                :is-anonymous="isAnonymous"
                :sign-in-location="signInLocation"
                :ratings="ratings"
                :summaries="summaries"
                @saved="emit('ratingSaved')"
              />
              <NuxtLink v-if="isAnonymous" :class="$style.signInLink" :to="signInLocation" :aria-describedby="headingId" aria-label="Sign in to mark watched">
                <span :class="$style.accessible">Sign in to mark watched</span>
              </NuxtLink>
              <AppButton
                v-else-if="hasSessionError"
                :class="$style.watchedButton"
                :aria-describedby="headingId"
                aria-label="Watched unavailable"
                disabled
                variant="secondary"
              >
                <span :class="$style.accessible">Watched unavailable</span>
              </AppButton>
              <AppButton
                v-else
                :aria-busy="episodeAriaBusy(episode.id)"
                :aria-describedby="headingId"
                :aria-pressed="isWatched"
                :class="$style.watchedButton"
                :disabled="isWatchedDisabled"
                aria-label="Watched"
                variant="secondary"
                @click="emit('toggleWatched', episode.id)"
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

      <p :class="$style.credit">
        <a href="https://www.tvmaze.com/">Episode data from TVMaze</a>
      </p>
    </template>
  </section>
</template>

<script setup lang="ts">
  import type { CatalogEpisode } from '@tv/shared/catalog'
  import type { RouteLocationRaw } from 'vue-router'
  import { computed, ref, watch } from 'vue'
  import CatalogEpisodeRatings from '~/components/catalog/CatalogEpisodeRatings.vue'
  import CatalogEpisodeRating from '~/components/catalog/CatalogEpisodeRating.vue'
  import AppButton from '~/components/ui/AppButton.vue'
  import AppMessage from '~/components/ui/AppMessage.vue'

  interface EpisodeRow {
    episode: CatalogEpisode;
    headingId: string;
    isWatched: boolean;
    isEpisodeSaving: boolean;
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

  const { catalogItemId, episodes, hasSessionError, isAnonymous, isSaving, readError, savingEpisodeId, watchedCount, watchedEpisodeIds, watchedStatus } = defineProps<Props>()
  const emit = defineEmits<Emits>()
  const selectedSeason = ref(1)
  let hasSelectedInitialSeason = false

  const seasonNumbers = computed(() => {
    const numbers = new Set(episodes.map(episode => episode.seasonNumber))

    return [...numbers].toSorted((first, second) => first - second)
  })

  const showBulkActions = computed(() => !isAnonymous && !hasSessionError && watchedStatus === 'loaded')
  const showSeasonHeading = computed(() => episodes.length > 0)
  const hasSeasonSelector = computed(() => seasonNumbers.value.length > 1)
  const newestSeason = computed(() => seasonNumbers.value.at(-1) ?? 1)

  const selectedEpisodeRows = computed(() => {
    const rows: EpisodeRow[] = []

    for (const episode of episodes) {
      if (episode.seasonNumber === selectedSeason.value) {
        const headingId = `episode-${episode.id}`
        const isWatched = watchedEpisodeIds.includes(episode.id)
        const isEpisodeSaving = isSaving && savingEpisodeId === episode.id

        rows.push({
          episode,
          headingId,
          isWatched,
          isEpisodeSaving
        })
      }
    }

    return rows
  })

  const selectedEpisodeIds = computed(() => selectedEpisodeRows.value.map(row => row.episode.id))

  const ratingsKey = computed(() => {
    const episodeKey = selectedEpisodeIds.value.join(':')

    return `${catalogItemId}:${selectedSeason.value}:${episodeKey}`
  })

  const isWatchedLoading = computed(() => !isAnonymous && !hasSessionError && (
    watchedStatus === 'idle' || watchedStatus === 'loading'
  ))

  const hasWatchedError = computed(() => watchedStatus === 'error')
  const showReadError = computed(() => readError !== '' && !hasWatchedError.value)
  const isBulkSaving = computed(() => isSaving && savingEpisodeId === null)
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
    } else if (!numbers.includes(selectedSeason.value)) {
      selectedSeason.value = newestSeason.value
    }
  }, { immediate: true })

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
    .bulk { display: grid; gap: var(--space-3); }
    .bulkActions { display: flex; flex-wrap: wrap; gap: var(--space-3); }
    .header {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-4);
    }
    .watchedCount, .supportingText, .airDate, .credit { color: var(--color-text-secondary); }
    .watchedCount { font-size: 0.875rem; }
    .seasonField { display: grid; }
    .seasonSelect {
      min-block-size: 2.75rem;
      padding-inline: var(--space-3);
      border: 1px solid var(--color-border-strong);
      border-radius: var(--radius-sm);
      background: var(--color-surface);
      color: var(--color-text-primary);
    }
    .loading, .episodeList {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
    }
    .loading { gap: var(--space-3); }
    .episodeList { gap: 0; padding: 0; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface); list-style: none; }
    .skeleton {
      min-block-size: 5rem;
      border-radius: var(--radius-md);
      background: var(--color-surface-muted);
    }
    .message, .privateError { display: grid; justify-items: start; gap: var(--space-3); }
    .seasonHeading {
      display: flex;
      align-items: center;
      min-block-size: 2.75rem;
      font-size: 1rem;
      font-weight: 600;
      &:global(.is-accessible) { position: absolute; inline-size: 1px; block-size: 1px; min-block-size: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    }
    .episode {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-3) var(--space-4);
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
    .watchedButton, .signInLink { inline-size: 2.75rem; min-block-size: 2.75rem; padding: 0; border-radius: var(--radius-sm); }
    .watchedButton[aria-pressed='true'], .watchedButton[aria-pressed='true']:disabled {
      border-color: var(--color-accent);
      background: var(--color-surface-selected);
      color: var(--color-accent);
    }
    .savingIndicator { inline-size: 1.25rem; block-size: 1.25rem; border: 0.125rem solid currentcolor; border-inline-end-color: transparent; border-radius: var(--radius-round); animation: saving-spin 0.8s linear infinite; }
    @keyframes saving-spin { to { transform: rotate(1turn); } }
    @media (prefers-reduced-motion: reduce) { .savingIndicator { animation: none; } }
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
      .episode { grid-template-columns: minmax(0, 1fr) 13.5rem auto; gap: var(--space-4); }
      .episodeIdentity { grid-column: auto; }
    }
  }
</style>
