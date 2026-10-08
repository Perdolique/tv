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
      :target-key="episode.id"
      :label="editorLabel"
      action-label="Rate episode"
      :has-session-error="hasSessionError"
      :is-anonymous="isAnonymous"
      :is-saving="rating.isSaving"
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
      @saved="handleSaved"
    />
  </section>
</template>

<script setup lang="ts">
  import type { CatalogEpisode } from '@tv/shared/catalog'
  import type { RouteLocationRaw } from 'vue-router'
  import { computed } from 'vue'
  import CatalogRating from '~/components/catalog/CatalogRating.vue'
  import CatalogRatingSummary from '~/components/catalog/CatalogRatingSummary.vue'
  import type { useCatalogEpisodeRatings } from '~/composables/use-catalog-episode-ratings.ts'
  import type { useCatalogEpisodeRatingSummaries } from '~/composables/use-catalog-episode-rating-summaries.ts'

  interface Props {
    accountId: string | null;
    episode: CatalogEpisode;
    hasSessionError: boolean;
    isAnonymous: boolean;
    signInLocation: RouteLocationRaw;
    ratings: ReturnType<typeof useCatalogEpisodeRatings>;
    summaries: ReturnType<typeof useCatalogEpisodeRatingSummaries>;
  }

  interface Emits {
    saved: [];
  }

  const { episode, ratings, summaries } = defineProps<Props>()
  const emit = defineEmits<Emits>()
  const rating = computed(() => ratings.ratingFor(episode.id))
  const summary = computed(() => summaries.summaryFor(episode.id))
  const episodeLabel = computed(() => `season ${episode.seasonNumber}, episode ${episode.episodeNumber}`)
  const regionLabel = computed(() => `Ratings for ${episodeLabel.value}`)
  const summaryLabel = computed(() => `Viewer rating for ${episodeLabel.value}`)
  const editorLabel = computed(() => `Your rating for ${episodeLabel.value}`)
  const showLoadError = computed(() => !ratings.batchError.value)

  function load(): Promise<void> {
    return ratings.load(episode.id)
  }

  function save(score: number | null): Promise<boolean> {
    return ratings.save(episode.id, score)
  }

  function handleSaved(): void {
    void summaries.reload(episode.id)

    emit('saved')
  }

  function clearError(): void {
    ratings.ratingFor(episode.id).saveError = ''
  }
</script>

<style module>
  @layer reset, vendor, tokens, base, components, utilities;

  @layer components {
    .component { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); min-inline-size: 0; }
    .summary { flex: 1 1 6rem; }
  }
</style>
