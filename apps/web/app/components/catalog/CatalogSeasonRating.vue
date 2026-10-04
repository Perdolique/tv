<template>
  <section :class="$style.component" :aria-label="regionLabel">
    <CatalogRatingSummary
      :class="$style.summary"
      :has-error="hasError"
      :is-loading="isLoading"
      :summary="summary"
      :label="summaryLabel"
      presentation="compact"
      @retry="ready.execute({ dedupe: 'cancel' })"
    />
    <div :class="$style.personal" :aria-busy="isPersonalLoading">
      <p :class="$style.label">Your season rating</p>
      <p :class="$style.score">{{ personalScore }}<span v-if="hasScore" :class="$style.accessible"> out of 10</span></p>
    </div>
    <CatalogRating
      :class="$style.editor"
      :account-id="accountId"
      :target-key="targetKey"
      :label="editorLabel"
      :action-label="actionLabel"
      :has-session-error="hasSessionError"
      :is-anonymous="isAnonymous"
      :is-saving="isSaving"
      :load="load"
      :save="save"
      :save-error="saveError"
      :score="score"
      :sign-in-location="signInLocation"
      :status="status"
      @clear-error="clearError"
      @saved="ready.execute({ dedupe: 'cancel' })"
    />
  </section>
</template>

<script setup lang="ts">
  import type { RouteLocationRaw } from 'vue-router'
  import { computed, watch } from 'vue'
  import CatalogRating from '~/components/catalog/CatalogRating.vue'
  import CatalogRatingSummary from '~/components/catalog/CatalogRatingSummary.vue'
  import { useCatalogRating } from '~/composables/use-catalog-rating.ts'
  import { useCatalogRatingSummary } from '~/composables/use-catalog-rating-summary.ts'
  import { catalogRatingPath } from '~/utils/catalog-rating-target.ts'

  interface Props {
    accountId: string | null;
    catalogItemId: string;
    hasSessionError: boolean;
    isAnonymous: boolean;
    seasonNumber: number;
    signInLocation: RouteLocationRaw;
  }

  interface Emits {
    unauthorized: [reason: 'load' | 'mutation'];
  }

  const { accountId, catalogItemId, hasSessionError, isAnonymous, seasonNumber } = defineProps<Props>()
  const emit = defineEmits<Emits>()

  // The parent keys this component by series and season so each public request has one owner.
  const target = computed(() => {
    return {
      catalogItemId,
      seasonNumber
    }
  })

  const account = computed(() => accountId)
  const targetKey = computed(() => catalogRatingPath(target.value))
  const regionLabel = computed(() => `Season ${seasonNumber} ratings`)
  const summaryLabel = computed(() => `Season ${seasonNumber} viewer rating`)
  const editorLabel = computed(() => `Your rating for season ${seasonNumber}`)
  const actionLabel = computed(() => `Rate season ${seasonNumber}`)
  const { hasError, isLoading, ready, summary } = useCatalogRatingSummary(target.value)
  const { isSaving, load, save, saveError, score, status, unauthorized } = useCatalogRating(target, account)
  const isPersonalLoading = computed(() => !isAnonymous && !hasSessionError && (status.value === 'loading' || status.value === 'idle'))
  const hasScore = computed(() => !isAnonymous && !hasSessionError && status.value === 'loaded' && score.value !== null)

  const personalScore = computed(() => {
    if (isAnonymous) {
      return '—'
    }

    if (hasSessionError || status.value === 'error') {
      return 'Unavailable'
    }

    if (isPersonalLoading.value) {
      return 'Loading…'
    }

    const label = score.value === null ? '—' : String(score.value)

    return label
  })

  watch(unauthorized, reason => {
    if (reason !== null) {
      emit('unauthorized', reason)
    }
  }, { flush: 'sync' })

  function clearError(): void {
    saveError.value = ''
  }
</script>

<style module>
  @layer reset, vendor, tokens, base, components, utilities;

  @layer components {
    .component { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-4); }
    .summary { flex: 1 1 12rem; }
    .personal { flex: 1 1 8rem; display: grid; gap: var(--space-1); }
    .label { color: var(--color-text-secondary); font-size: 0.875rem; }
    .score { font-size: 1.5rem; font-weight: 600; font-variant-numeric: tabular-nums; }
    .editor { flex: 0 1 12rem; }
    .accessible { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  }
</style>
