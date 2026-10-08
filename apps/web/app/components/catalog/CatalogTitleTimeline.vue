<template>
  <section ref="region" :class="$style.component" :aria-labelledby="headingId">
    <h2 :id="headingId" ref="heading" :class="$style.heading" tabindex="-1">Your timeline</h2>
    <p v-if="isLoading" :class="$style.supporting" role="status">Loading your timeline…</p>
    <p v-else-if="isEmpty" :class="$style.supporting">Your activity for this title will appear here.</p>
    <div v-if="readError" :class="$style.error">
      <AppMessage role="alert" tone="danger">{{ readError }}</AppMessage>
      <AppButton ref="historyRetry" variant="secondary" :disabled="isLoadingMore" @click="retry">Retry history</AppButton>
    </div>
    <div v-for="day in days" :key="day.date" :class="$style.day">
      <h3 :class="$style.date"><time :datetime="day.date">{{ day.label }}</time></h3>
      <ol :class="$style.entries">
        <li v-for="row in day.rows" :key="row.key" :class="$style.entry">
          <span :class="$style.marker" aria-hidden="true" />
          <span :class="[$style.icon, { 'is-accent': row.isRating }]" aria-hidden="true"><Icon mode="svg" :name="row.icon" /></span>
          <div :class="$style.copy">
            <div :class="$style.rowHeader">
              <NuxtLink v-if="row.movieLocation" :class="$style.movieLink" :to="row.movieLocation">{{ row.label }}</NuxtLink>
              <p v-else>{{ row.label }}</p>
              <p v-if="row.rating" :class="$style.rating">{{ row.rating.previous }}<span v-if="row.rating.hasPrevious"> → </span><span :class="[$style.newScore, { 'is-changed': row.rating.hasPrevious }]">{{ row.rating.current }}</span><span v-if="row.rating.showScale"> / 10</span></p>
            </div>
            <p v-if="row.detail" :class="$style.supporting">{{ row.detail }}</p>
          </div>
        </li>
      </ol>
    </div>
    <AppButton v-if="canExpand" :class="$style.footer" size="small" variant="text" :aria-expanded="showFull" @click="expandHistory">Show full history<Icon aria-hidden="true" mode="svg" name="hugeicons:arrow-right-02" /></AppButton>
    <AppButton v-else-if="showLoadMore" :class="$style.footer" size="small" variant="text" :disabled="isLoadingMore" @click="more">{{ loadMoreLabel }}<Icon aria-hidden="true" mode="svg" name="hugeicons:arrow-right-02" /></AppButton>
    <p :class="$style.accessible" role="status">{{ announcement }}</p>
  </section>
</template>

<script setup lang="ts">
  import type { CatalogTimelineItem } from '@tv/shared/catalog-timeline'
  import { computed, nextTick, ref, useId, useTemplateRef, watch } from 'vue'
  import type { TitleTimelineState } from '~/composables/use-title-timeline.ts'
  import AppButton from '~/components/ui/AppButton.vue'
  import AppMessage from '~/components/ui/AppMessage.vue'
  import { timelineItemKey } from '~/utils/title-timeline.ts'
  import { formatCalendarDateForDisplay } from '~/utils/calendar-date.ts'

  interface TimelineDay {
    date: string;
    label: string;
    rows: ReturnType<typeof prepareRow>[];
  }

  interface Props {
    catalogItemId: string;
    state: TitleTimelineState;
    timeZone: string | null;
  }

  const { catalogItemId, state, timeZone } = defineProps<Props>()
  const { failedPage, isLoadingMore, items, nextCursor, readError, status } = state
  const headingId = useId()
  const heading = useTemplateRef('heading')
  const historyRetry = useTemplateRef('historyRetry')
  const region = useTemplateRef('region')
  const showFull = ref(false)
  const announcement = ref('')
  const isLoading = computed(() => status.value === 'idle' || status.value === 'loading')
  const isEmpty = computed(() => status.value === 'loaded' && items.value.length === 0)
  const canExpand = computed(() => !showFull.value && (items.value.length > 6 || nextCursor.value !== null))
  const showLoadMore = computed(() => showFull.value && nextCursor.value !== null && failedPage.value !== 'more')
  const loadMoreLabel = computed(() => isLoadingMore.value ? 'Loading history…' : 'Load more')
  const visibleItems = computed(() => showFull.value ? items.value : items.value.slice(0, 6))

  const days = computed(() => {
    const result: TimelineDay[] = []
    const zone = timeZone ?? 'UTC'

    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    })

    for (const item of visibleItems.value) {
      const occurredAt = new Date(item.occurredAt)
      const date = item.kind === 'episode_group' ? item.localDate : formatter.format(occurredAt)
      let day = result.at(-1)

      if (day?.date !== date) {
        const label = formatCalendarDateForDisplay(date, { dateStyle: 'medium' })

        day = {
          date,
          label,
          rows: []
        }

        result.push(day)
      }

      // oxlint-disable-next-line eslint/no-use-before-define -- Vue computed values stay together before hoisted rendering helpers.
      const row = prepareRow(item)

      day.rows.push(row)
    }

    return result
  })

  function eventCopy(item: CatalogTimelineItem) {
    if (item.kind === 'movie_viewing') {
      const dates: string[] = []

      if (item.startedOn !== null) {
        const startedOn = formatCalendarDateForDisplay(item.startedOn, { dateStyle: 'medium' })
        const label = `Started ${startedOn}`

        dates.push(label)
      }

      if (item.completedOn !== null) {
        const completedOn = formatCalendarDateForDisplay(item.completedOn, { dateStyle: 'medium' })
        const label = `Finished ${completedOn}`

        dates.push(label)
      }

      const detail = dates.join(' · ')

      return {
        label: 'Watched movie',
        detail,
        icon: 'hugeicons:play-circle'
      }
    }

    if (item.kind === 'episode_group') {
      const noun = item.totalCount === 1 ? 'episode' : 'episodes'
      const label = `Watched ${item.totalCount} ${noun}`

      return {
        label,
        detail: '',
        icon: 'hugeicons:play-circle'
      }
    }

    if (item.kind === 'rating_changed') {
      let label = 'Updated rating'
      let detail = ''

      if (item.score === null) { label = 'Removed rating' } else if (item.previousScore === null) { label = 'Rated' }

      if (item.target === 'season') { detail = `Season ${item.seasonNumber}` } else if (item.target === 'episode') { detail = `S${item.seasonNumber} E${item.episodeNumber}` }

      return {
        label,
        detail,
        icon: 'hugeicons:star'
      }
    }

    if (item.kind === 'season_completed') {
      const detail = `Season ${item.seasonNumber}`

      return {
        label: 'Completed season',
        detail,
        icon: 'hugeicons:layers-01'
      }
    }

    if (item.kind === 'available_completed') {
      return {
        label: 'Finished watching',
        detail: 'All available episodes',
        icon: 'hugeicons:checkmark-circle-02'
      }
    }

    if (item.kind === 'rewatch_started') {
      return {
        label: 'Started rewatch',
        detail: '',
        icon: 'hugeicons:reload'
      }
    }

    if (item.kind === 'series_started') {
      return {
        label: 'Started watching',
        detail: '',
        icon: 'hugeicons:play-circle'
      }
    }

    if (item.kind === 'series_paused') {
      return {
        label: 'Paused watching',
        detail: '',
        icon: 'hugeicons:pause-circle'
      }
    }

    return {
      label: 'Completed viewing',
      detail: '',
      icon: 'hugeicons:checkmark-circle-02'
    }
  }

  function ratingCopy(item: Extract<CatalogTimelineItem, { kind: 'rating_changed' }>) {
    const previous = item.previousScore === null ? '' : String(item.previousScore)
    const current = item.score === null ? 'Removed' : String(item.score)
    const showScale = item.previousScore === null && item.score !== null

    return {
      previous,
      hasPrevious: item.previousScore !== null,
      current,
      showScale
    }
  }

  function viewingLocation(item: Extract<CatalogTimelineItem, { kind: 'movie_viewing' }>) {
    const path = `/titles/${catalogItemId}`
    const hash = `#viewing-${item.viewingId}`

    return {
      path,
      query: { viewingId: item.viewingId },
      hash
    }
  }

  function prepareRow(item: CatalogTimelineItem) {
    const key = timelineItemKey(item)
    const copy = eventCopy(item)
    const rating = item.kind === 'rating_changed' ? ratingCopy(item) : null
    const movieLocation = item.kind === 'movie_viewing' ? viewingLocation(item) : null

    return {
      key,
      label: copy.label,
      detail: copy.detail,
      icon: copy.icon,
      rating,
      movieLocation,
      isRating: item.kind === 'rating_changed'
    }
  }

  async function expandHistory(): Promise<void> {
    showFull.value = true

    await nextTick()
    heading.value?.focus()
  }
  async function more(): Promise<void> {
    const count = items.value.length
    const focusOwner = globalThis.document.activeElement
    const loaded = await state.load(true)

    if (loaded) {
      announcement.value = `${items.value.length - count} more history entries loaded.`
    }

    await nextTick()

    if (focusOwner !== null && !focusOwner.isConnected && globalThis.document.activeElement === globalThis.document.body) {
      if (!loaded && historyRetry.value !== null) { historyRetry.value.focus() } else { heading.value?.focus() }
    }
  }
  async function retry(): Promise<void> {
    const focusOwner = globalThis.document.activeElement

    await state.load(failedPage.value === 'more')
    await nextTick()

    if (focusOwner !== null && !focusOwner.isConnected && globalThis.document.activeElement === globalThis.document.body) { heading.value?.focus() }
  }

  watch(items, async () => {
    const focusOwner = globalThis.document.activeElement
    const ownedFocus = focusOwner instanceof globalThis.HTMLElement && region.value?.contains(focusOwner)

    await nextTick()

    if (ownedFocus && !focusOwner.isConnected && globalThis.document.activeElement === globalThis.document.body) { heading.value?.focus() }
  })
</script>

<style module>
  @layer reset, vendor, tokens, base, components, utilities;
  @layer components {
    .component { display: grid; align-content: start; gap: var(--space-5); padding: var(--space-5); border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface); }
    .heading { font-size: 1.5rem; line-height: 1.25; font-weight: 600; }
    .day { display: grid; gap: var(--space-3); }
    .day + .day { padding-block-start: var(--space-4); border-block-start: 1px solid var(--color-border); }
    .date, .supporting { color: var(--color-text-secondary); font-size: 0.875rem; }
    .date { font-weight: 400; font-variant-numeric: tabular-nums; }
    .entries { display: grid; padding: 0; list-style: none; }
    .entry { position: relative; display: grid; grid-template-columns: 1.5rem minmax(0, 1fr); gap: var(--space-3); margin-inline-start: var(--space-4); padding: var(--space-3) 0 var(--space-3) var(--space-4); }
    .entry::before { position: absolute; inset-inline-start: 0; inset-block: 0; inline-size: 1px; background: var(--color-border-strong); content: ''; }
    .entry:first-child::before { inset-block-start: 1.75rem; }
    .entry:last-child::before { inset-block-end: calc(100% - 1.75rem); }
    .entry:only-child::before { display: none; }
    .marker { position: absolute; inset-inline-start: calc(-0.25rem + 0.5px); inset-block-start: 1.5rem; inline-size: 0.5rem; block-size: 0.5rem; border-radius: var(--radius-round); background: var(--color-accent-fill); }
    .icon { display: flex; color: var(--color-text-primary); &:global(.is-accent) { color: var(--color-accent); } }
    .icon :global(svg) { inline-size: 1.5rem; block-size: 1.5rem; }
    .copy { display: grid; gap: var(--space-1); }
    .entry + .entry::after { position: absolute; inset-block-start: 0; inset-inline-start: calc(var(--space-4) + 1.5rem + var(--space-3)); inset-inline-end: 0; border-block-start: 1px solid var(--color-border); content: ''; }
    .rowHeader { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: var(--space-2); }
    .rating { font-variant-numeric: tabular-nums; }
    .newScore { &:global(.is-changed) { color: var(--color-accent); } }
    .movieLink { color: var(--color-text-primary); text-underline-offset: 0.2em; }
    .footer { justify-content: space-between; inline-size: 100%; padding-block-start: var(--space-4); border-block-start: 1px solid var(--color-border); border-radius: 0; text-align: start; }
    .accessible { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  }
</style>
