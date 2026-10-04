<template>
  <section ref="region" :class="$style.component" :aria-label="label" tabindex="-1">
    <div v-if="hasSummaryError" :class="$style.error">
      <AppMessage role="alert" tone="danger">We couldn’t load episode viewer ratings. The episode list is still available.</AppMessage>
      <AppButton ref="summaryRetry" :disabled="isSummaryLoading" variant="secondary" @click="retry('summary')">Retry episode viewer ratings</AppButton>
    </div>
    <div v-if="hasPersonalError" :class="$style.error">
      <AppMessage role="alert" tone="danger">We couldn’t load your episode ratings. The episode list is still available.</AppMessage>
      <AppButton ref="personalRetry" :disabled="isPersonalLoading" variant="secondary" @click="retry('personal')">Retry your episode ratings</AppButton>
    </div>
    <slot :ratings="ratings" :summaries="summaries" />
  </section>
</template>

<script setup lang="ts">
  import { computed, nextTick, useTemplateRef, watch } from 'vue'
  import AppButton from '~/components/ui/AppButton.vue'
  import AppMessage from '~/components/ui/AppMessage.vue'
  import { useCatalogEpisodeRatings } from '~/composables/use-catalog-episode-ratings.ts'
  import { useCatalogEpisodeRatingSummaries } from '~/composables/use-catalog-episode-rating-summaries.ts'

  interface Props {
    accountId: string | null;
    catalogItemId: string;
    seasonNumber: number;
    episodeIds: string[];
  }

  interface Emits {
    unauthorized: [reason: 'load' | 'mutation'];
  }

  const { accountId, catalogItemId, seasonNumber, episodeIds } = defineProps<Props>()
  const emit = defineEmits<Emits>()
  const account = computed(() => accountId)
  const label = computed(() => `Season ${seasonNumber} episode ratings`)

  // The list keys this owner by season and episode identities, not watched state.
  const season = {
    catalogItemId,
    seasonNumber
  }

  const ratings = useCatalogEpisodeRatings(season, episodeIds, account)
  const summaries = useCatalogEpisodeRatingSummaries(season, episodeIds)
  const { batchError: hasPersonalError, isBatchLoading: isPersonalLoading, unauthorized } = ratings
  const { batchError: hasSummaryError, isBatchLoading: isSummaryLoading } = summaries
  const region = useTemplateRef('region')
  const personalRetry = useTemplateRef('personalRetry')
  const summaryRetry = useTemplateRef('summaryRetry')

  watch(unauthorized, reason => {
    if (reason !== null) {
      emit('unauthorized', reason)
    }
  }, { flush: 'sync' })

  async function retry(kind: 'personal' | 'summary'): Promise<void> {
    const focusOwner = globalThis.document.activeElement
    const request = kind === 'personal' ? ratings.loadBatch() : summaries.ready.execute({ dedupe: 'cancel' })

    await request

    await nextTick()

    const { activeElement, body } = globalThis.document

    if (activeElement !== focusOwner && activeElement !== body) {
      return
    }

    if (kind === 'personal' && hasPersonalError.value) {
      personalRetry.value?.focus()
    } else if (kind === 'summary' && hasSummaryError.value) {
      summaryRetry.value?.focus()
    } else {
      region.value?.focus()
    }
  }
</script>

<style module>
  @layer reset, vendor, tokens, base, components, utilities;

  @layer components {
    .component { display: grid; gap: var(--space-4); min-inline-size: 0; }
    .error { display: grid; justify-items: start; gap: var(--space-3); }
  }
</style>
