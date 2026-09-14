import { useRoute, useRouter } from '#app'
import type { CatalogReleaseItem } from '@tv/shared/catalog'
import { computed, ref, watch, type Ref } from 'vue'

import {
  formatCalendarDateForDisplay,
  getCalendarWeekDays,
  normalizeCalendarMonthQuery,
  normalizeCalendarQuery,
  parseCalendarDate,
  shiftCalendarMonth,
  shiftCalendarWeek,
  type CalendarReleaseRange
} from '~/utils/calendar-date.ts'

interface CalendarPeriodNavigationOptions {
  hasError: Readonly<Ref<boolean>>;
  isLoading: Readonly<Ref<boolean>>;
  items: Readonly<Ref<CatalogReleaseItem[]>>;
  selectedDate: Ref<string | null>;
  today: Readonly<Ref<string | null>>;
  visibleDate: Ref<string | null>;
}

type CalendarNavigationAmount = -1 | 1
type MobileMode = 'agenda' | 'month'
type RouterNavigationMethod = 'push' | 'replace'

// Owns route-backed month and week navigation while keeping the visible period and day selection distinct.
function useCalendarPeriodNavigation(options: CalendarPeriodNavigationOptions) {
  const { hasError, isLoading, items, selectedDate, today, visibleDate } = options
  const route = useRoute()
  const router = useRouter()
  const pendingWeekSelection = ref<CalendarReleaseRange | null>(null)
  const mobileMode = ref<MobileMode>('agenda')

  const weekDays = computed(() => selectedDate.value === null || today.value === null
    ? []
    : getCalendarWeekDays(selectedDate.value, today.value))

  const monthLabel = computed(() => {
    if (visibleDate.value === null) {
      return 'Loading month…'
    }

    return formatCalendarDateForDisplay(`${visibleDate.value.slice(0, 7)}-01`, {
      month: 'long',
      year: 'numeric'
    })
  })

  const weekLabel = computed(() => {
    const supportedDays = weekDays.value.filter(day => parseCalendarDate(day.date) !== null)
    const firstDay = supportedDays.at(0)
    const lastDay = supportedDays.at(-1)

    if (firstDay === undefined || lastDay === undefined) {
      return 'Loading week…'
    }

    const startLabel = formatCalendarDateForDisplay(firstDay, {
      day: 'numeric',
      month: 'short'
    })

    const endLabel = formatCalendarDateForDisplay(lastDay, {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    })

    return `${startLabel} – ${endLabel}`
  })

  const mobilePeriodLabel = computed(() => mobileMode.value === 'agenda' ? weekLabel.value : monthLabel.value)
  const mobilePreviousLabel = computed(() => mobileMode.value === 'agenda' ? 'Previous week' : 'Previous month')
  const mobileNextLabel = computed(() => mobileMode.value === 'agenda' ? 'Next week' : 'Next month')

  const isPreviousMonthDisabled = computed(() => {
    if (visibleDate.value === null || today.value === null) {
      return true
    }

    return visibleDate.value.slice(0, 7) === today.value.slice(0, 7)
  })

  const isPreviousWeekDisabled = computed(() => {
    if (today.value === null) {
      return true
    }

    const firstDay = weekDays.value.at(0)

    return firstDay === undefined || firstDay.date <= today.value
  })

  const isTodaySelected = computed(() => selectedDate.value === today.value)
  const isNextMonthDisabled = computed(() => visibleDate.value?.startsWith('9999-12') ?? true)

  const isNextWeekDisabled = computed(() => {
    if (selectedDate.value === null || today.value === null) {
      return true
    }

    return shiftCalendarWeek(selectedDate.value, 1, today.value) === selectedDate.value
  })

  const isMobilePreviousDisabled = computed(() => mobileMode.value === 'agenda'
    ? isPreviousWeekDisabled.value
    : isPreviousMonthDisabled.value)

  const isMobileNextDisabled = computed(() => mobileMode.value === 'agenda'
    ? isNextWeekDisabled.value
    : isNextMonthDisabled.value)

  async function navigateToDate(date: string, method: RouterNavigationMethod): Promise<void> {
    if (
      today.value === null
      || date < today.value
      || parseCalendarDate(date) === null
      || (route.query.date === date && route.query.month === undefined)
    ) {
      return
    }

    await router[method]({
      path: '/calendar',
      query: { date }
    })
  }

  async function navigateToMonth(month: string, method: RouterNavigationMethod): Promise<void> {
    if (
      today.value === null
      || normalizeCalendarMonthQuery(month, today.value) === null
      || (route.query.month === month && route.query.date === undefined)
    ) {
      return
    }

    await router[method]({
      path: '/calendar',
      query: { month }
    })
  }

  watch([() => route.query.date, () => route.query.month, today], ([dateValue, monthValue, currentToday]) => {
    if (currentToday === null) {
      return
    }

    const normalizedDate = normalizeCalendarQuery(dateValue, currentToday)
    const hasSelectedDate = typeof dateValue === 'string' && dateValue === normalizedDate

    const normalizedMonth = hasSelectedDate
      ? null
      : normalizeCalendarMonthQuery(monthValue, currentToday)

    if (hasSelectedDate) {
      visibleDate.value = normalizedDate
      selectedDate.value = normalizedDate

      if (monthValue !== undefined) {
        void router.replace({
          path: '/calendar',
          query: { date: normalizedDate }
        })
      }

      return
    }

    if (normalizedMonth !== null) {
      const currentMonth = currentToday.slice(0, 7)

      mobileMode.value = 'month'
      visibleDate.value = normalizedMonth === currentMonth
        ? currentToday
        : `${normalizedMonth}-01`

      selectedDate.value = null

      if (dateValue !== undefined || monthValue !== normalizedMonth) {
        void router.replace({
          path: '/calendar',
          query: { month: normalizedMonth }
        })
      }

      return
    }

    visibleDate.value = currentToday
    selectedDate.value = currentToday

    if (dateValue !== currentToday || monthValue !== undefined) {
      void router.replace({
        path: '/calendar',
        query: { date: currentToday }
      })
    }
  }, {
    flush: 'sync',
    immediate: true
  })

  watch(
    [pendingWeekSelection, selectedDate, items, isLoading, hasError],
    ([targetWeek, currentDate, currentItems, loading, requestFailed]) => {
      if (
        targetWeek === null
        || currentDate === null
        || currentDate < targetWeek.from
        || currentDate > targetWeek.to
        || loading
        || requestFailed
      ) {
        return
      }

      pendingWeekSelection.value = null

      const firstRelease = currentItems.find(item => (
        item.releaseDate >= targetWeek.from && item.releaseDate <= targetWeek.to
      ))

      if (firstRelease !== undefined && firstRelease.releaseDate !== currentDate) {
        void navigateToDate(firstRelease.releaseDate, 'replace')
      }
    },
    { flush: 'post' }
  )

  async function pushDate(date: string): Promise<void> {
    pendingWeekSelection.value = null

    await navigateToDate(date, 'push')
  }

  async function navigateMonth(amount: CalendarNavigationAmount): Promise<void> {
    if (
      visibleDate.value === null
      || today.value === null
      || (amount === -1 && isPreviousMonthDisabled.value)
      || (amount === 1 && isNextMonthDisabled.value)
    ) {
      return
    }

    const targetDate = shiftCalendarMonth(visibleDate.value, amount, today.value)
    const targetMonth = targetDate.slice(0, 7)

    pendingWeekSelection.value = null

    await navigateToMonth(targetMonth, 'push')
  }

  async function navigateWeek(amount: CalendarNavigationAmount): Promise<void> {
    if (
      selectedDate.value === null
      || today.value === null
      || (amount === -1 && isPreviousWeekDisabled.value)
      || (amount === 1 && isNextWeekDisabled.value)
    ) {
      return
    }

    const targetWeekAnchor = shiftCalendarWeek(selectedDate.value, amount, today.value)
    const targetWeekDays = getCalendarWeekDays(targetWeekAnchor, today.value)
    const firstSelectableDay = targetWeekDays.find(day => day.selectable)
    const lastSelectableDay = targetWeekDays.findLast(day => day.selectable)

    if (firstSelectableDay === undefined || lastSelectableDay === undefined) {
      return
    }

    pendingWeekSelection.value = {
      from: firstSelectableDay.date,
      to: lastSelectableDay.date
    }

    await navigateToDate(firstSelectableDay.date, 'push')
  }

  async function navigateMobilePeriod(amount: CalendarNavigationAmount): Promise<void> {
    if (mobileMode.value === 'agenda') {
      await navigateWeek(amount)

      return
    }

    await navigateMonth(amount)
  }

  async function openMobileAgenda(): Promise<void> {
    if (selectedDate.value === null && visibleDate.value !== null) {
      await pushDate(visibleDate.value)
    }

    mobileMode.value = 'agenda'
  }

  function openMobileMonth(): void {
    mobileMode.value = 'month'
  }

  function selectToday(): void {
    if (today.value !== null) {
      pendingWeekSelection.value = null

      void pushDate(today.value)
    }
  }

  return {
    isMobileNextDisabled,
    isMobilePreviousDisabled,
    isNextMonthDisabled,
    isPreviousMonthDisabled,
    isTodaySelected,
    mobileMode,
    mobileNextLabel,
    mobilePeriodLabel,
    mobilePreviousLabel,
    monthLabel,
    navigateMobilePeriod,
    navigateMonth,
    openMobileAgenda,
    openMobileMonth,
    pushDate,
    selectToday,
    weekDays
  }
}

export { useCalendarPeriodNavigation }
