<template>
  <section
    ref="summaryRegion"
    :class="$style.component"
    :data-presentation="presentation"
    aria-label="TV viewer rating"
    tabindex="-1"
  >
    <p :class="$style.label">TV viewer rating</p>
    <div v-if="summary" :class="$style.summary">
      <p :class="$style.score">
        <Icon aria-hidden="true" mode="svg" name="hugeicons:star" />
        <span>{{ scoreLabel }}<span v-if="hasScore" :class="$style.accessible"> out of 10</span></span>
      </p>
      <p :class="$style.count">{{ countLabel }}</p>
    </div>
    <p v-else-if="!hasError" :class="$style.placeholder" aria-busy="true">Loading viewer rating…</p>
    <div v-if="hasError" :class="$style.error">
      <AppMessage role="alert" tone="danger">{{ errorLabel }}</AppMessage>
      <AppButton ref="retryButton" :disabled="isLoading" aria-label="Retry viewer rating" variant="secondary" @click="retry">Retry</AppButton>
    </div>
  </section>
</template>

<script lang="ts" setup>
  import type { CatalogRatingSummaryResponse } from '@tv/shared/catalog'
  import { useMediaQuery } from '@vueuse/core'
  import { computed, nextTick, useTemplateRef, watch } from 'vue'
  import AppButton from '~/components/ui/AppButton.vue'
  import AppMessage from '~/components/ui/AppMessage.vue'

  interface Props {
    hasError: boolean;
    isLoading: boolean;
    presentation?: 'inline' | 'card';
    summary?: CatalogRatingSummaryResponse;
  }

  interface Emits {
    retry: [];
  }

  const { summary, hasError, isLoading, presentation = 'inline' } = defineProps<Props>()
  const emit = defineEmits<Emits>()
  const summaryRegion = useTemplateRef('summaryRegion')
  const retryButton = useTemplateRef('retryButton')
  const isDesktop = useMediaQuery('(width >= 64rem)')
  const isPresented = computed(() => presentation === 'card' ? isDesktop.value : !isDesktop.value)
  const errorLabel = computed(() => summary === undefined ? 'Viewer rating unavailable' : 'Viewer rating update failed. Try again.')
  const hasScore = computed(() => summary?.averageScore !== null && summary?.averageScore !== undefined)
  const scoreFormatter = new Intl.NumberFormat('en', { maximumFractionDigits: 1 })
  const countFormatter = new Intl.NumberFormat('en')
  let retryFocusOwner: Element | null = null

  const scoreLabel = computed(() => {
    const averageScore = summary?.averageScore

    return averageScore === null || averageScore === undefined ? 'Not rated' : scoreFormatter.format(averageScore)
  })

  const countLabel = computed(() => {
    const count = summary?.ratingCount ?? 0
    const formattedCount = countFormatter.format(count)
    const unit = count === 1 ? 'rating' : 'ratings'

    return `${formattedCount} ${unit}`
  })

  function retry(): void {
    retryFocusOwner = globalThis.document.activeElement

    emit('retry')
  }

  watch(() => isLoading, async loading => {
    if (loading || retryFocusOwner === null) {
      return
    }

    const focusOwner = retryFocusOwner

    retryFocusOwner = null

    await nextTick()

    const { activeElement, body } = globalThis.document

    if (!isPresented.value || (activeElement !== focusOwner && activeElement !== body)) {
      return
    }

    if (hasError) {
      retryButton.value?.focus()
    } else {
      summaryRegion.value?.focus()
    }
  })
</script>

<style module>
  @layer reset, vendor, tokens, base, components, utilities;

  @layer components {
    .component { --rating-icon-size: 2rem; display: grid; align-content: start; justify-items: start; gap: var(--space-1); min-inline-size: 0; }
    .label, .count { color: var(--color-text-secondary); font-size: 0.875rem; }
    .label {
      .component[data-presentation='inline'] & { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    }
    .accessible { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    .summary { display: grid; gap: var(--space-1); min-inline-size: 0; }
    .score {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      min-block-size: 2.75rem;
      font-size: 1.5rem;
      font-weight: 600;
      line-height: 1.25;
      font-variant-numeric: tabular-nums;
      .component[data-presentation='card'] & { font-size: 2rem; }
    }
    .score :global(svg) { flex: 0 0 auto; inline-size: var(--rating-icon-size); block-size: var(--rating-icon-size); color: var(--color-accent); }
    .count { padding-inline-start: calc(var(--rating-icon-size) + var(--space-3)); font-variant-numeric: tabular-nums; }
    .placeholder { display: flex; align-items: center; min-block-size: calc(2.75rem + var(--space-1) + 1.3125rem); color: var(--color-text-secondary); font-size: 0.875rem; }
    .error { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); }
    .component[data-presentation='card'] { --rating-icon-size: 2.5rem; display: none; padding: var(--space-5); border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface); }
    @media (width >= 64rem) {
      .component[data-presentation='inline'] { display: none; }
      .component[data-presentation='card'] { display: grid; }
    }
  }
</style>
