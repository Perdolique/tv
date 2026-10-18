<template>
  <section :class="$style.component" :aria-label="regionLabel">
    <CatalogRatingSummary
      :class="$style.summary"
      :summary="summary.summary"
      :has-error="summary.hasError"
      :is-loading="summary.isLoading"
      :label="summaryLabel"
      presentation="episode"
      @retry="summaries.reload(episode.id)"
    />
    <CatalogRating
      :account-id="accountId"
      :is-active="isActive"
      :target-key="targetKey"
      :context-key="episode.id"
      :label="editorLabel"
      action-label="Rate episode"
      :has-session-error="hasSessionError"
      :is-anonymous="isAnonymous"
      :is-saving="isSaving"
      :is-unavailable="isUnavailable"
      :has-unconfirmed-mutation="hasUnconfirmedMutation"
      :retry-mutation="ratings.retryMutation"
      :creation-date-label="creationDateLabel"
      creation-description="Saving this rating also starts a series viewing and marks this episode watched."
      :load="load"
      :save="save"
      :save-error="rating.saveError"
      :score="rating.score"
      :sign-in-location="signInLocation"
      :status="rating.status"
      :show-load-error="showLoadError"
      show-score
      compact
      @clear-error="clearError"
      @saved="summaries.reload(episode.id)"
    />
  </section>
</template>

<script setup lang="ts">
  import type { CatalogEpisode } from '@tv/shared/catalog'
  import type { RouteLocationRaw } from 'vue-router'
  import { computed, toRef } from 'vue'
  import CatalogRating from '~/components/catalog/CatalogRating.vue'
  import CatalogRatingSummary from '~/components/catalog/CatalogRatingSummary.vue'
  import type { useCatalogEpisodeRatings } from '~/composables/use-catalog-episode-ratings.ts'
  import type { useCatalogEpisodeRatingSummaries } from '~/composables/use-catalog-episode-rating-summaries.ts'

  interface Props {
    accountId: string | null;
    episode: CatalogEpisode;
    hasSessionError: boolean;
    isActive: boolean;
    isEligible: boolean;
    viewingKey: string;
    isAnonymous: boolean;
    signInLocation: RouteLocationRaw;
    ratings: ReturnType<typeof useCatalogEpisodeRatings>;
    summaries: ReturnType<typeof useCatalogEpisodeRatingSummaries>;
  }

  const { episode, ratings, summaries, isEligible, viewingKey } = defineProps<Props>()
  const targetKey = toRef(() => `${episode.id}:${viewingKey}`)
  const hasUnconfirmedMutation = toRef(() => ratings.hasUnconfirmedMutation(episode.id))
  const rating = computed(() => ratings.ratingFor(episode.id))
  const isSaving = toRef(() => rating.value.isSaving || ratings.isSaving.value)

  const isUnavailable = toRef(() => {
    if (!isEligible) { return true }

    return ratings.isBlocked(episode.id)
  })

  const creationDateLabel = toRef(() => ratings.needsViewing.value ? 'Started on' : undefined)
  const summary = computed(() => summaries.summaryFor(episode.id))
  const episodeLabel = computed(() => `season ${episode.seasonNumber}, episode ${episode.episodeNumber}`)
  const regionLabel = computed(() => `Ratings for ${episodeLabel.value}`)
  const summaryLabel = computed(() => `Viewer rating for ${episodeLabel.value}`)
  const editorLabel = computed(() => `Your rating for ${episodeLabel.value}`)
  const showLoadError = computed(() => !ratings.batchError.value)

  function load(): Promise<void> {
    return ratings.load(episode.id)
  }

  function save(score: number | null, viewingDate?: string): Promise<boolean> {
    return ratings.save(episode.id, score, viewingDate)
  }

  function clearError(): void {
    const currentRating = ratings.ratingFor(episode.id)

    currentRating.saveError = ''
  }
</script>

<style module>
  @layer reset, vendor, tokens, base, components, utilities;

  @layer components {
    .component { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); min-inline-size: 0; }
    .summary { flex: 1 1 6rem; }
  }
</style>
