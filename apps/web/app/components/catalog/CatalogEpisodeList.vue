<template>
  <section :class="$style.component" aria-labelledby="episodes-heading">
    <h2 id="episodes-heading" :class="$style.accessible">Episodes</h2>
    <div :class="$style.header">
      <h3 v-if="episodes.length > 0" :class="hasSeasonSelector ? $style.accessible : $style.seasonHeading">Season {{ selectedSeason }}</h3>
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
      <div v-if="hasWatchedError" :class="$style.privateError">
        <AppMessage role="alert" tone="danger">We couldn’t load your watched episodes. The episode list is still available.</AppMessage>
        <AppButton variant="secondary" @click="emit('retryWatched')">Retry watched status</AppButton>
      </div>

      <ul :class="$style.episodeList">
        <li v-for="episode in selectedEpisodes" :key="episode.id" :class="$style.episode">
          <p :class="$style.episodeNumber"><span :class="$style.accessible">Season {{ episode.seasonNumber }}, </span>E{{ episode.episodeNumber }}</p>
          <div :class="$style.episodeCopy">
            <h4 :id="`episode-${episode.id}`" :class="$style.episodeTitle">{{ episodeTitle(episode) }}</h4>
            <p v-if="episode.airDate !== null" :class="$style.airDate">
              <time :datetime="episode.airDate">{{ formatAirDate(episode.airDate) }}</time>
            </p>
          </div>

          <NuxtLink v-if="isAnonymous" :class="$style.signInLink" :to="signInLocation" :aria-describedby="`episode-${episode.id}`" aria-label="Sign in to mark watched">
            <span :class="$style.accessible">Sign in to mark watched</span>
          </NuxtLink>
          <AppButton
            v-else-if="hasSessionError"
            :class="$style.watchedButton"
            :aria-describedby="`episode-${episode.id}`"
            aria-label="Watched unavailable"
            disabled
            variant="secondary"
          >
            <span :class="$style.accessible">Watched unavailable</span>
          </AppButton>
          <AppButton
            v-else
            :aria-busy="episodeAriaBusy(episode.id)"
            :aria-describedby="`episode-${episode.id}`"
            :aria-pressed="isEpisodeWatched(episode.id)"
            :class="$style.watchedButton"
            :disabled="isWatchedDisabled"
            aria-label="Watched"
            variant="secondary"
            @click="emit('toggleWatched', episode.id)"
          >
            <Icon v-if="isEpisodeWatched(episode.id)" aria-hidden="true" mode="svg" name="hugeicons:tick-02" />
          </AppButton>
          <AppMessage v-if="saveErrorFor(episode.id) !== ''" :class="$style.episodeError" role="alert" tone="danger">
            {{ saveErrorFor(episode.id) }}
          </AppMessage>
        </li>
      </ul>

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
  import AppButton from '~/components/ui/AppButton.vue'
  import AppMessage from '~/components/ui/AppMessage.vue'

  interface Props {
    episodes: CatalogEpisode[];
    hasEpisodesError: boolean;
    hasSessionError: boolean;
    isAnonymous: boolean;
    isEpisodesEmpty: boolean;
    isEpisodesLoading: boolean;
    isSaving: boolean;
    saveErrorFor: (episodeId: string) => string;
    savingEpisodeId: string | null;
    signInLocation: RouteLocationRaw;
    watchedCount: number;
    watchedEpisodeIds: string[];
    watchedStatus: 'idle' | 'loading' | 'loaded' | 'error';
  }

  interface Emits {
    retryEpisodes: [];
    retryWatched: [];
    toggleWatched: [episodeId: string];
  }

  const props = defineProps<Props>()
  const emit = defineEmits<Emits>()
  const selectedSeason = ref(1)
  let hasSelectedInitialSeason = false

  const seasonNumbers = computed(() => {
    const numbers = new Set(props.episodes.map(episode => episode.seasonNumber))

    return [...numbers].toSorted((first, second) => first - second)
  })

  const hasSeasonSelector = computed(() => seasonNumbers.value.length > 1)
  const newestSeason = computed(() => seasonNumbers.value.at(-1) ?? 1)

  const selectedEpisodes = computed(() => props.episodes.filter(
    episode => episode.seasonNumber === selectedSeason.value
  ))

  const isWatchedLoading = computed(() => !props.isAnonymous && !props.hasSessionError && (
    props.watchedStatus === 'idle' || props.watchedStatus === 'loading'
  ))

  const hasWatchedError = computed(() => props.watchedStatus === 'error')
  const isWatchedDisabled = computed(() => props.watchedStatus !== 'loaded' || props.isSaving)
  const showWatchedStatus = computed(() => isWatchedLoading.value || props.watchedStatus === 'loaded')

  const watchedStatusLabel = computed(() => {
    if (isWatchedLoading.value) {
      return 'Loading watched status…'
    }

    const noun = props.watchedCount === 1 ? 'episode' : 'episodes'

    return `${props.watchedCount} watched ${noun}`
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

  function isEpisodeWatched(episodeId: string): boolean {
    return props.watchedEpisodeIds.includes(episodeId)
  }

  function episodeAriaBusy(episodeId: string): true | undefined {
    const isEpisodeSaving = props.isSaving && props.savingEpisodeId === episodeId
    const isBusy = isWatchedLoading.value || isEpisodeSaving

    return isBusy || undefined
  }

</script>

<style module>
  @layer reset, vendor, tokens, base, components, utilities;

  @layer components {
    .component { display: grid; gap: var(--space-5); }
    .header {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-4);
    }
    .watchedCount, .supportingText, .airDate, .credit { color: var(--color-text-secondary); }
    .watchedCount { font-size: 0.875rem; }
    .seasonField { display: grid; gap: var(--space-1); }
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
      gap: var(--space-3);
    }
    .episodeList { gap: 0; padding: 0; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface); list-style: none; }
    .skeleton {
      min-block-size: 10rem;
      border-radius: var(--radius-md);
      background: var(--color-surface-muted);
    }
    .message, .privateError { display: grid; justify-items: start; gap: var(--space-3); }
    .seasonHeading { display: flex; align-items: center; min-block-size: 2.75rem; font-size: 1rem; font-weight: 600; }
    .episode {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      align-items: center;
      gap: var(--space-4);
      min-block-size: 6rem;
      padding: var(--space-4);
    }
    .episode + .episode { border-block-start: 1px solid var(--color-border); }
    .episodeCopy { min-inline-size: 0; }
    .episodeNumber {
      font-size: 1.125rem;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
    .episodeTitle { font-size: 1rem; font-weight: 600; }
    .airDate { margin-block-start: var(--space-2); font-size: 0.875rem; }
    .watchedButton, .signInLink { inline-size: 2.75rem; min-block-size: 2.75rem; padding: 0; border-radius: var(--radius-sm); }
    .watchedButton[aria-pressed='true'], .watchedButton[aria-pressed='true']:disabled {
      border-color: var(--color-accent);
      background: var(--color-surface-selected);
      color: var(--color-accent);
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
    @media (width >= 40rem) {
      .loading, .episodeList { grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr)); }
      .episodeList { gap: var(--space-3); border: 0; background: transparent; }
      .episode { border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface); }
    }
  }
</style>
