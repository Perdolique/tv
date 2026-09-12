<template>
  <section :class="$style.component" :aria-labelledby="headingId">
    <h2 :id="headingId" :class="$style.visuallyHidden">Month</h2>
    <div :class="$style.weekdays" aria-hidden="true">
      <span>Mon</span>
      <span>Tue</span>
      <span>Wed</span>
      <span>Thu</span>
      <span>Fri</span>
      <span>Sat</span>
      <span>Sun</span>
    </div>
    <div v-if="isLoading" :class="$style.grid" role="status" aria-label="Loading month" aria-busy="true">
      <div v-for="cell in 42" :key="cell" :class="$style.skeletonCell" aria-hidden="true" />
    </div>
    <div v-else :class="$style.grid" role="group" aria-label="Calendar days">
      <button
        v-for="day in days"
        :key="day.date"
        ref="dayButtons"
        :class="$style.day"
        :data-in-month="day.inMonth"
        :data-selected="day.date === selectedDate"
        :disabled="!day.selectable"
        :tabindex="getTabIndex(day)"
        :aria-current="day.isToday ? 'date' : undefined"
        :aria-label="getDayLabel(day)"
        :aria-pressed="day.selectable ? day.date === selectedDate : undefined"
        @click="selectDay(day)"
        @focus="focusDay(day)"
        @keydown="moveFocus($event, day)"
      >
        <span :class="$style.dayHeader">
          <span>{{ day.day }}</span>
          <span v-if="day.isToday" :class="$style.today">Today</span>
          <span v-if="day.date === selectedDate" :class="$style.selectedMark" aria-hidden="true">✓</span>
        </span>
        <span v-if="getReleaseCount(day) > 0" :class="$style.releaseSummary" aria-hidden="true">
          <span v-for="cue in getReleaseCues(day)" :key="cue.releaseId" :class="$style.cue" :data-type="cue.type">
            <span :class="$style.cueLabel">{{ cue.label }}</span>
          </span>
          <span :class="$style.releaseCount">{{ getReleaseCount(day) }}</span>
        </span>
      </button>
    </div>
  </section>
</template>

<script lang="ts" setup>
  import type { CatalogReleaseItem } from '@tv/shared/catalog'
  import { nextTick, ref, useId, useTemplateRef, watch } from 'vue'
  import { formatCalendarDateForDisplay, type CalendarDay } from '~/utils/calendar-date.ts'

  interface Props {
    days: CalendarDay[];
    isLoading: boolean;
    releasesByDate: Map<string, CatalogReleaseItem[]>;
    selectedDate: string | null;
  }

  interface Emits {
    select: [date: string];
  }

  interface ReleaseCue {
    label: 'E' | 'M' | 'S';
    releaseId: string;
    type: 'episode' | 'movie' | 'series';
  }

  const { days, isLoading, releasesByDate, selectedDate } = defineProps<Props>()
  const emit = defineEmits<Emits>()
  const headingId = useId()
  const dayButtons = useTemplateRef('dayButtons')
  const focusedDate = ref<string | null>(selectedDate)

  watch(() => selectedDate, (date) => {
    focusedDate.value = date
  })

  function getReleaseCount(day: CalendarDay): number {
    return releasesByDate.get(day.date)?.length ?? 0
  }

  function getDayLabel(day: CalendarDay): string {
    const formatted = formatCalendarDateForDisplay(day, { dateStyle: 'full' })
    const releaseCount = getReleaseCount(day)
    const releaseLabel = releaseCount === 1 ? 'release' : 'releases'
    const todayLabel = day.isToday ? ', today' : ''

    return `${formatted}${todayLabel}, ${releaseCount} ${releaseLabel}`
  }

  function getReleaseCue(item: CatalogReleaseItem): ReleaseCue {
    if (item.type === 'movie') {
      return {
        label: 'M',
        releaseId: item.releaseId,
        type: 'movie'
      }
    }

    if (item.episodeNumber !== null) {
      return {
        label: 'E',
        releaseId: item.releaseId,
        type: 'episode'
      }
    }

    return {
      label: 'S',
      releaseId: item.releaseId,
      type: 'series'
    }
  }

  function getReleaseCues(day: CalendarDay): ReleaseCue[] {
    const releases = releasesByDate.get(day.date)?.slice(0, 2) ?? []

    return releases.map(release => getReleaseCue(release))
  }

  function getTabIndex(day: CalendarDay): 0 | -1 {
    return day.selectable && day.date === focusedDate.value ? 0 : -1
  }

  function selectDay(day: CalendarDay): void {
    if (day.selectable) {
      emit('select', day.date)
    }
  }

  function focusDay(day: CalendarDay): void {
    if (day.selectable) {
      focusedDate.value = day.date
    }
  }

  async function focusIndex(index: number): Promise<void> {
    const target = days[index]

    if (target === undefined || !target.selectable) {
      return
    }

    focusedDate.value = target.date

    await nextTick()
    dayButtons.value?.[index]?.focus()
  }

  function findAvailableIndex(start: number, step: number): number | null {
    let index = start

    while (index >= 0 && index < days.length) {
      if (days[index]?.selectable) {
        return index
      }

      index += step
    }

    return null
  }

  function moveFocus(event: KeyboardEvent, day: CalendarDay): void {
    const offsets: Partial<Record<string, number>> = {
      ArrowDown: 7,
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7
    }

    const offset = offsets[event.key]

    if (offset !== undefined) {
      event.preventDefault()

      const currentIndex = days.findIndex(candidate => candidate.date === day.date)
      const step = Math.sign(offset)
      const targetIndex = findAvailableIndex(currentIndex + offset, step)

      if (targetIndex !== null) {
        void focusIndex(targetIndex)
      }

    }
  }
</script>

<style module>
  @layer reset, vendor, tokens, base, components, utilities;

  @layer components {
    .component {
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      background: var(--color-surface);
      box-shadow: var(--shadow-card);
    }
    .visuallyHidden {
      position: absolute;
      inline-size: 1px;
      block-size: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    .weekdays, .grid {
      display: grid;
      grid-template-columns: repeat(7, minmax(0, 1fr));
    }
    .weekdays {
      border-block-end: 1px solid var(--color-border);
      color: var(--color-text-secondary);
      font-size: 0.75rem;
      font-weight: 600;
      text-align: center;
    }
    .weekdays span { padding: var(--space-2) var(--space-1); }
    .day, .skeletonCell {
      min-inline-size: 0;
      min-block-size: 4.75rem;
      border: 0;
      border-inline-end: 1px solid var(--color-border);
      border-block-end: 1px solid var(--color-border);
    }
    .day {
      display: grid;
      align-content: space-between;
      gap: var(--space-2);
      padding: var(--space-1);
      background: var(--color-surface);
      cursor: pointer;
      font-variant-numeric: tabular-nums;
      text-align: start;
    }
    .day:nth-child(7n), .skeletonCell:nth-child(7n) { border-inline-end: 0; }
    .day:nth-last-child(-n + 7), .skeletonCell:nth-last-child(-n + 7) { border-block-end: 0; }
    .day:nth-last-child(7), .skeletonCell:nth-last-child(7) { border-end-start-radius: var(--radius-lg); }
    .day:last-child, .skeletonCell:last-child { border-end-end-radius: var(--radius-lg); }
    .day:disabled {
      color: var(--color-text-tertiary);
      cursor: default;
    }
    .day:focus-visible {
      position: relative;
      z-index: 2;
      outline: 0.125rem solid var(--color-focus);
      outline-offset: 0.125rem;
    }
    .day[data-in-month='false'] { background: var(--color-surface-muted); }
    .day[data-selected='true'] {
      position: relative;
      z-index: 1;
      border: 2px solid var(--color-accent);
      border-radius: var(--radius-sm);
      background: var(--color-surface-muted);
      font-weight: 700;
    }
    .dayHeader { display: flex; align-items: center; gap: var(--space-1); }
    .today {
      overflow: hidden;
      font-size: 0.75rem;
      font-weight: 700;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .selectedMark { margin-inline-start: auto; }
    .releaseSummary {
      display: flex;
      align-items: center;
      gap: var(--space-1);
      min-inline-size: 0;
    }
    .cue {
      flex: 0 0 auto;
      display: inline-grid;
      place-items: center;
      inline-size: 1rem;
      block-size: 1rem;
      border: 1px solid currentcolor;
      border-radius: 50%;
      color: var(--color-accent);
      font-size: 0.5rem;
      font-weight: 800;
    }
    .cue:nth-child(n + 2) { display: none; }
    .cue[data-type='episode'] {
      border-radius: 0.2rem;
    }
    .cue[data-type='series'] { block-size: 0.625rem; border-radius: var(--radius-round); }
    .cueLabel { line-height: 1; }
    .releaseCount {
      flex: 0 0 auto;
      margin-inline-start: auto;
      color: var(--color-text-secondary);
      font-size: 0.625rem;
      font-weight: 700;
    }
    .skeletonCell {
      background: linear-gradient(135deg, var(--color-surface-muted), var(--color-surface));
    }
    @media (width >= 40rem) {
      .day { padding: var(--space-2); }
      .cue,
      .cue:nth-child(n + 2) {
        display: inline-grid;
        inline-size: 1.25rem;
        block-size: 1.25rem;
        font-size: 0.625rem;
      }
      .cue[data-type='series'] { block-size: 0.75rem; }
      .releaseCount { font-size: 0.75rem; }
    }
    @media (width >= 64rem) {
      .day, .skeletonCell { min-block-size: 6.5rem; }
    }
    @media (prefers-reduced-motion: no-preference) {
      .day { transition: background var(--duration-fast) var(--ease-standard); }
    }
    @media (forced-colors: active) {
      .day[data-selected='true'] { border-color: SelectedItem; }
    }
  }
</style>
