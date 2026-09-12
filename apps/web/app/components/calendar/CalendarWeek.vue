<template>
  <div :class="$style.component" role="group" aria-label="Selected week">
    <button
      v-for="day in days"
      :key="day.date"
      :class="$style.day"
      :data-selected="day.date === selectedDate"
      :disabled="!day.selectable"
      :aria-current="day.isToday ? 'date' : undefined"
      :aria-pressed="day.selectable ? day.date === selectedDate : undefined"
      :aria-label="getDayLabel(day)"
      @click="selectDay(day)"
    >
      <span :class="$style.weekday">{{ getWeekday(day) }}</span>
      <span :class="$style.number">{{ day.day }}</span>
      <span v-if="day.isToday" :class="$style.today">Today</span>
    </button>
  </div>
</template>

<script lang="ts" setup>
  import { formatCalendarDateForDisplay, type CalendarDay } from '~/utils/calendar-date.ts'

  interface Props {
    days: CalendarDay[];
    selectedDate: string;
  }

  interface Emits {
    select: [date: string];
  }

  const { days, selectedDate } = defineProps<Props>()
  const emit = defineEmits<Emits>()

  function getWeekday(day: CalendarDay): string {
    return formatCalendarDateForDisplay(day, { weekday: 'short' })
  }

  function getDayLabel(day: CalendarDay): string {
    return formatCalendarDateForDisplay(day, { dateStyle: 'full' })
  }

  function selectDay(day: CalendarDay): void {
    if (day.selectable) {
      emit('select', day.date)
    }
  }
</script>

<style module>
  @layer reset, vendor, tokens, base, components, utilities;

  @layer components {
    .component {
      display: grid;
      grid-template-columns: repeat(7, minmax(0, 1fr));
      gap: var(--space-1);
    }
    .day {
      display: grid;
      justify-items: center;
      gap: var(--space-1);
      min-inline-size: 0;
      min-block-size: 4.5rem;
      padding: var(--space-2) var(--space-1);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm);
      background: var(--color-surface);
      cursor: pointer;
      font-variant-numeric: tabular-nums;
    }
    .day:disabled { color: var(--color-text-tertiary); cursor: default; }
    .day[data-selected='true'] {
      border: 2px solid var(--color-accent);
      background: var(--color-accent-fill);
      color: var(--color-on-accent);
      font-weight: 700;
    }
    .weekday, .today { font-size: 0.625rem; line-height: 1; }
    .number { font-weight: 700; }
    .today { font-weight: 700; }
  }
</style>
