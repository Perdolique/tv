<template>
  <section :class="$style.component" aria-labelledby="episodes-heading">
    <div :class="$style.header">
      <div>
        <h2 id="episodes-heading" :class="$style.heading">Episodes</h2>
        <p v-if="showWatchedStatus" :class="$style.watchedCount" role="status">{{ watchedStatusLabel }}</p>
      </div>
      <label v-if="hasSeasonSelector" :class="$style.seasonField">
        <span :class="$style.seasonLabel">Season</span>
        <select v-model.number="selectedSeason" :class="$style.seasonSelect">
          <option v-for="seasonNumber in seasonNumbers" :key="seasonNumber" :value="seasonNumber">
            Season {{ seasonNumber }}
          </option>
        </select>
      </label>
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

      <h3 :class="$style.seasonHeading">Season {{ selectedSeason }}</h3>
      <ul :class="$style.episodeList">
        <li v-for="episode in selectedEpisodes" :key="episode.id" :class="$style.episode">
          <div :class="$style.episodeCopy">
            <p :class="$style.episodeNumber">S{{ episode.seasonNumber }} · E{{ episode.episodeNumber }}</p>
            <h4 :class="$style.episodeTitle">{{ episodeTitle(episode) }}</h4>
            <p v-if="episode.airDate !== null" :class="$style.airDate">
              <time :datetime="episode.airDate">{{ formatAirDate(episode.airDate) }}</time>
            </p>
          </div>

          <NuxtLink v-if="isAnonymous" :class="$style.signInLink" :to="signInLocation">
            Sign in to mark watched
          </NuxtLink>
          <AppButton
            v-else-if="hasSessionError"
            :class="$style.watchedButton"
            disabled
            variant="secondary"
          >
            Watched unavailable
          </AppButton>
          <AppButton
            v-else
            :aria-busy="episodeAriaBusy(episode.id)"
            :aria-pressed="isEpisodeWatched(episode.id)"
            :class="$style.watchedButton"
            :disabled="isWatchedDisabled"
            variant="secondary"
            @click="emit('toggleWatched', episode.id)"
          >
            <span aria-hidden="true" :class="$style.watchedIndicator">
              <Icon :name="episodeWatchedIcon(episode.id)" />
            </span>
            Watched
          </AppButton>
          <AppMessage v-if="saveErrorFor(episode.id) !== ''" role="alert" tone="danger">
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

  function episodeWatchedIcon(episodeId: string): string {
    const isWatched = isEpisodeWatched(episodeId)

    return isWatched ? 'hugeicons:checkmark-circle-02' : 'hugeicons:circle'
  }
</script>

<style module>
  @layer reset, vendor, tokens, base, components, utilities;

  @layer components {
    .component { display: grid; gap: var(--space-5); }
    .header {
      display: flex;
      flex-wrap: wrap;
      align-items: end;
      justify-content: space-between;
      gap: var(--space-4);
    }
    .heading { font-size: 1.375rem; font-weight: 600; }
    .watchedCount, .supportingText, .airDate, .credit { color: var(--color-text-secondary); }
    .watchedCount { margin-block-start: var(--space-1); font-size: 0.875rem; }
    .seasonField { display: grid; gap: var(--space-1); }
    .seasonLabel { font-size: 0.875rem; font-weight: 600; }
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
    .skeleton {
      min-block-size: 10rem;
      border-radius: var(--radius-md);
      background: var(--color-surface-muted);
    }
    .message, .privateError { display: grid; justify-items: start; gap: var(--space-3); }
    .seasonHeading { font-size: 1.125rem; font-weight: 600; }
    .episode {
      display: grid;
      align-content: space-between;
      gap: var(--space-4);
      padding: var(--space-4);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      background: var(--color-surface);
    }
    .episodeCopy { min-inline-size: 0; }
    .episodeNumber {
      color: var(--color-text-secondary);
      font-size: 0.875rem;
      font-variant-numeric: tabular-nums;
    }
    .episodeTitle { margin-block-start: var(--space-1); font-size: 1rem; font-weight: 600; }
    .airDate { margin-block-start: var(--space-2); font-size: 0.875rem; }
    .watchedButton, .signInLink { min-block-size: 2.75rem; }
    .watchedButton[aria-pressed='true'], .watchedButton[aria-pressed='true']:disabled {
      border-color: var(--color-accent);
      background: var(--color-surface-selected);
      color: var(--color-text-primary);
    }
    .watchedIndicator { display: inline-flex; inline-size: 1.25rem; block-size: 1.25rem; color: var(--color-accent); }
    .signInLink {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding-inline: var(--space-3);
      border: 1px solid var(--color-border-strong);
      border-radius: var(--radius-md);
      color: var(--color-text-primary);
      font-weight: 600;
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
    }
  }
</style>
