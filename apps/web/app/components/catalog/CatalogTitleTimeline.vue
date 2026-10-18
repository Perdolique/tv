<template>
  <section ref="region" :class="$style.component" :aria-labelledby="headingId">
    <h2 :id="headingId" ref="heading" :class="$style.heading" tabindex="-1">Your timeline</h2>
    <p v-if="isLoading" :class="$style.supporting" role="status">Loading your timeline…</p>
    <p v-else-if="isEmpty" :class="$style.supporting">Your activity for this title will appear here.</p>
    <div v-if="readError">
      <AppMessage role="alert" tone="danger">{{ readError }}</AppMessage>
      <AppButton size="small" ref="historyRetry" variant="secondary" :disabled="isLoadingMore" @click="retry">Retry history</AppButton>
    </div>
    <div v-for="day in days" :key="day.date" :class="$style.day">
      <h3 :class="$style.date"><time :datetime="day.date">{{ day.label }}</time></h3>
      <ol :class="$style.entries">
        <li v-for="row in day.rows" :key="row.key" :class="$style.entry">
          <span :class="$style.marker" aria-hidden="true" />
          <span :class="[$style.icon, { 'is-accent': row.isRating }]" aria-hidden="true"><Icon mode="svg" :name="row.icon" /></span>
          <div :class="$style.copy">
            <div :class="$style.rowHeader">
              <p>{{ row.label }}</p>
              <p v-if="row.rating" :class="$style.rating">{{ row.rating }} / 10</p>
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
  import { computed, nextTick, shallowRef, useId, useTemplateRef, watch } from 'vue'
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
    state: TitleTimelineState;
    timeZone: string | null;
  }

  const { state, timeZone } = defineProps<Props>()
  const { failedPage, isLoadingMore, items, nextCursor, readError, status } = state
  const headingId = useId()
  const heading = useTemplateRef('heading')
  const historyRetry = useTemplateRef('historyRetry')
  const region = useTemplateRef('region')
  const showFull = shallowRef(false)
  const announcement = shallowRef('')
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
      let date = formatter.format(occurredAt)

      if (item.kind === 'movie_viewing') { date = item.completedOn }
      else if (item.kind === 'episode_group') { date = item.localDate }
      else if (item.kind === 'series_started' || item.kind === 'rewatch_started') { date = item.startedOn }
      else if (item.kind === 'series_completed') { date = item.completedOn }

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
      return {
        label: 'Watched movie',
        detail: '',
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

    return {
      label: 'Completed viewing',
      detail: '',
      icon: 'hugeicons:checkmark-circle-02'
    }
  }

  function ratingCopy(item: CatalogTimelineItem) {
    const hasScore = item.kind === 'movie_viewing' || item.kind === 'series_started' || item.kind === 'rewatch_started'

    if (!hasScore || item.score === null) { return null }

    return String(item.score)
  }

  function prepareRow(item: CatalogTimelineItem) {
    const key = timelineItemKey(item)
    const copy = eventCopy(item)
    const rating = ratingCopy(item)

    return {
      key,
      label: copy.label,
      detail: copy.detail,
      icon: copy.icon,
      rating,
      isRating: rating !== null
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
      announcement.value = state.didRecoverCursor.value ? 'Timeline refreshed.' : `${items.value.length - count} more history entries loaded.`
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
    .footer { justify-content: space-between; inline-size: 100%; border-block-start: 1px solid var(--color-border); text-align: start; }
    .accessible { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  }
</style>
