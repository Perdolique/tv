<template>
  <div :class="$style.component">
    <main v-if="hasSessionError" :class="$style.sessionPanel">
      <p :class="$style.wordmark">TV</p>
      <h1 :class="$style.heading">We couldn’t verify your session.</h1>
      <p :class="$style.supportingText">Try again to open your release calendar.</p>
      <AppButton ref="sessionRetryButton" :disabled="isRetryingSession" @click="retrySession">Try again</AppButton>
    </main>

    <AppShell v-else-if="isAuthenticated" active-destination="calendar">
      <main :class="$style.content">
        <header :class="$style.pageHeader">
          <div>
            <h1 ref="heading" :class="$style.heading" tabindex="-1">Release calendar</h1>
          </div>
          <CalendarPeriodNavigation
            :class="$style.wideMonthNavigation"
            :is-next-disabled="isNextMonthDisabled"
            :is-previous-disabled="isPreviousMonthDisabled"
            :is-today-disabled="isTodaySelected"
            :label="monthLabel"
            layout="wide"
            navigation-label="Month navigation"
            next-label="Next month"
            previous-label="Previous month"
            @next="navigateMonth(1)"
            @previous="navigateMonth(-1)"
            @today="selectToday"
          />
        </header>

        <div :class="$style.mobileModes" role="group" aria-label="Calendar view">
          <button :class="$style.modeButton" :aria-pressed="mobileMode === 'agenda'" @click="openMobileAgenda">Agenda</button>
          <button :class="$style.modeButton" :aria-pressed="mobileMode === 'month'" @click="openMobileMonth">Month</button>
        </div>

        <CalendarPeriodNavigation
          :class="$style.mobilePeriodNavigation"
          :is-next-disabled="isMobileNextDisabled"
          :is-previous-disabled="isMobilePreviousDisabled"
          :is-today-disabled="isTodaySelected"
          :label="mobilePeriodLabel"
          layout="compact"
          navigation-label="Calendar period navigation"
          :next-label="mobileNextLabel"
          :previous-label="mobilePreviousLabel"
          @next="navigateMobilePeriod(1)"
          @previous="navigateMobilePeriod(-1)"
          @today="selectToday"
        />

        <CalendarWeek
          v-if="selectedDate !== null && mobileMode === 'agenda'"
          :class="$style.mobileWeek"
          :days="weekDays"
          :selected-date="selectedDate"
          @select="pushDate"
        />
        <div v-else-if="mobileMode === 'agenda'" :class="$style.weekSkeleton" aria-hidden="true">
          <span v-for="day in 7" :key="day" />
        </div>

        <div :class="$style.layout" :data-mobile-mode="mobileMode">
          <CalendarMonth
            :class="$style.month"
            :days="monthDays"
            :is-loading="showLoading"
            :releases-by-date="releasesByDate"
            :selected-date="selectedDate"
            @select="pushDate"
          />
          <CalendarAgenda
            ref="agenda"
            :class="$style.agenda"
            :has-error="hasError"
            :is-loading="showLoading"
            :items="agendaItems"
            :month-has-items="items.length > 0"
            :period-label="monthLabel"
            :selected-date="selectedDate"
            @retry="retryReleases"
          />
        </div>
      </main>
    </AppShell>
  </div>
</template>

<script lang="ts" setup>
  import { definePageMeta } from '#app/composables/pages'
  import { navigateTo, useHead, useResponseHeader, useRoute } from '#app'
  import { sanitizeRedirectTo } from '@tv/shared/redirect'
  import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
  import AppShell from '~/components/app/AppShell.vue'
  import CalendarAgenda from '~/components/calendar/CalendarAgenda.vue'
  import CalendarMonth from '~/components/calendar/CalendarMonth.vue'
  import CalendarPeriodNavigation from '~/components/calendar/CalendarPeriodNavigation.vue'
  import CalendarWeek from '~/components/calendar/CalendarWeek.vue'
  import AppButton from '~/components/ui/AppButton.vue'
  import { useAuthSession } from '~/composables/use-auth-session.ts'
  import { useCalendarPeriodNavigation } from '~/composables/use-calendar-period-navigation.ts'
  import { useCatalogReleases } from '~/composables/use-catalog-releases.ts'

  import {
    getCalendarMonthDays,
    getCalendarReleaseRange,
    getLocalCalendarDate,
    groupReleasesByDate,
    type CalendarReleaseRange
  } from '~/utils/calendar-date.ts'

  definePageMeta({ middleware: 'authenticated' })
  useHead({ title: 'Release calendar · TV' })

  const cacheControlHeader = useResponseHeader('Cache-Control')

  cacheControlHeader.value = 'private, no-store'

  const route = useRoute()
  const { restoreSession, setAnonymous, state } = useAuthSession()
  const agenda = useTemplateRef('agenda')
  const heading = useTemplateRef('heading')
  const sessionRetryButton = useTemplateRef('sessionRetryButton')
  const today = ref<string | null>(null)
  const visibleDate = ref<string | null>(null)
  const selectedDate = ref<string | null>(null)
  const isRetryingSession = ref(false)
  const isAuthenticated = computed(() => state.value.status === 'authenticated')
  const isAnonymous = computed(() => state.value.status === 'anonymous')
  const hasSessionError = computed(() => state.value.status === 'error')
  const accountId = computed(() => state.value.status === 'authenticated' ? state.value.user.id : null)

  const range = computed<CalendarReleaseRange | null>(() => {
    if (visibleDate.value === null || today.value === null) {
      return null
    }

    const selectedDateInVisibleMonth = selectedDate.value?.startsWith(visibleDate.value.slice(0, 7))
      ? selectedDate.value
      : null

    return getCalendarReleaseRange(visibleDate.value, today.value, selectedDateInVisibleMonth)
  })

  const { clear, hasError, isLoading, items, reload, unauthorized } = useCatalogReleases(accountId, range)

  const {
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
  } = useCalendarPeriodNavigation({
    hasError,
    isLoading,
    items,
    selectedDate,
    today,
    visibleDate
  })

  const showLoading = computed(() => visibleDate.value === null || isLoading.value)
  const shouldSignIn = computed(() => isAnonymous.value || unauthorized.value)
  const redirectTo = computed(() => sanitizeRedirectTo(route.fullPath))
  const releasesByDate = computed(() => groupReleasesByDate(items.value))

  const agendaItems = computed(() => selectedDate.value === null
    ? items.value
    : releasesByDate.value.get(selectedDate.value) ?? [])

  const monthDays = computed(() => visibleDate.value === null || today.value === null
    ? []
    : getCalendarMonthDays(visibleDate.value, today.value))

  const signInLocation = computed(() => {
    return {
      path: '/sign-in',
      query: { redirectTo: redirectTo.value }
    }
  })

  watch(shouldSignIn, async (mustSignIn) => {
    if (!mustSignIn) {
      return
    }

    if (unauthorized.value) {
      setAnonymous()
    }

    await navigateTo(signInLocation.value, { replace: true })
  }, {
    flush: 'sync',
    immediate: true
  })

  const MINIMUM_TODAY_REFRESH_DELAY_MS = 1000
  const MIDNIGHT_REFRESH_BUFFER_MS = 100
  let privateSessionRefresh: Promise<void> | null = null
  let todayRefreshTimer: ReturnType<typeof globalThis.setTimeout> | null = null

  function refreshLocalToday(): void {
    if (todayRefreshTimer !== null) {
      globalThis.clearTimeout(todayRefreshTimer)
    }

    const now = new Date()
    const nextLocalDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
    const millisecondsUntilNextDay = nextLocalDay.getTime() - now.getTime()

    const delay = Math.max(
      MINIMUM_TODAY_REFRESH_DELAY_MS,
      millisecondsUntilNextDay + MIDNIGHT_REFRESH_BUFFER_MS
    )

    today.value = getLocalCalendarDate(now)
    todayRefreshTimer = globalThis.setTimeout(refreshLocalToday, delay)
  }

  async function runPrivateSessionRefresh(): Promise<void> {
    const previousAccountId = accountId.value

    clear()
    await restoreSession({ force: true })

    if (accountId.value !== null && accountId.value === previousAccountId) {
      await reload()
    }
  }

  async function refreshPrivateSession(): Promise<void> {
    if (privateSessionRefresh !== null) {
      await privateSessionRefresh

      return
    }

    const refresh = runPrivateSessionRefresh()

    privateSessionRefresh = refresh

    try {
      await refresh
    } finally {
      if (privateSessionRefresh === refresh) {
        privateSessionRefresh = null
      }
    }
  }

  function refreshLocalTodayIfVisible(): void {
    if (globalThis.document.visibilityState !== 'visible') {
      return
    }

    refreshLocalToday()

    void refreshPrivateSession()
  }

  onMounted(() => {
    refreshLocalToday()
    globalThis.addEventListener('focus', refreshLocalTodayIfVisible)
    globalThis.document.addEventListener('visibilitychange', refreshLocalTodayIfVisible)
  })

  onBeforeUnmount(() => {
    if (todayRefreshTimer !== null) {
      globalThis.clearTimeout(todayRefreshTimer)
    }

    globalThis.removeEventListener('focus', refreshLocalTodayIfVisible)
    globalThis.document.removeEventListener('visibilitychange', refreshLocalTodayIfVisible)
  })

  async function retrySession(): Promise<void> {
    isRetryingSession.value = true

    await restoreSession({ force: true })

    isRetryingSession.value = false

    await nextTick()

    if (state.value.status === 'error') {
      sessionRetryButton.value?.focus()
    } else if (state.value.status === 'authenticated') {
      heading.value?.focus()
    }
  }

  async function retryReleases(): Promise<void> {
    await reload()
    await nextTick()

    if (hasError.value) {
      agenda.value?.focusRetry()
    } else {
      heading.value?.focus()
    }
  }
</script>

<style module>
  @layer reset, vendor, tokens, base, components, utilities;

  @layer components {
    .component { min-block-size: 100svh; }
    .content {
      display: grid;
      gap: var(--space-5);
      max-inline-size: var(--layout-content-max);
      margin-inline: auto;
      padding: var(--space-8) var(--layout-page-mobile) var(--space-12);
    }
    .pageHeader { display: grid; gap: var(--space-5); }
    .heading { font-size: 1.75rem; font-weight: 600; line-height: 1.15; }
    .supportingText { color: var(--color-text-secondary); }
    .wideMonthNavigation { display: none; }
    .mobileModes {
      display: grid;
      grid-template-columns: 1fr 1fr;
      padding: var(--space-1);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      background: var(--color-surface-muted);
    }
    .modeButton {
      min-block-size: 2.75rem;
      border: 0;
      border-radius: var(--radius-sm);
      background: transparent;
      cursor: pointer;
      font-weight: 600;
    }
    .modeButton[aria-pressed='true'] {
      border: 1px solid var(--color-border-strong);
      background: var(--color-surface);
      box-shadow: var(--shadow-card);
      font-weight: 800;
    }
    .weekSkeleton { display: grid; grid-template-columns: repeat(7, 1fr); gap: var(--space-1); }
    .weekSkeleton span {
      min-block-size: 4.5rem;
      border-radius: var(--radius-sm);
      background: var(--color-surface-muted);
    }
    .layout { display: grid; gap: var(--space-5); min-inline-size: 0; }
    .layout[data-mobile-mode='agenda'] .month { display: none; }
    .sessionPanel {
      display: grid;
      justify-items: start;
      gap: var(--space-5);
      inline-size: min(calc(100% - 2 * var(--layout-page-mobile)), 34rem);
      margin: var(--space-12) auto;
      padding: var(--space-8);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-xl);
      background: var(--color-surface);
      box-shadow: var(--shadow-card);
    }
    .wordmark {
      color: var(--color-accent);
      font-size: 1.5rem;
      font-weight: 700;
      letter-spacing: -0.08em;
      line-height: 1;
    }
    @media (width >= 40rem) {
      .content { gap: var(--space-6); padding-inline: var(--layout-page-compact); }
      .heading { font-size: 2.25rem; line-height: 1.17; }
      .wideMonthNavigation { display: grid; }
      .mobileModes, .mobilePeriodNavigation, .mobileWeek, .weekSkeleton { display: none; }
      .layout { gap: var(--space-6); }
      .layout[data-mobile-mode] .month { display: grid; }
    }
    @media (width >= 64rem) {
      .content { padding: var(--space-10) var(--layout-page-wide) var(--space-16); }
      .pageHeader { grid-template-columns: minmax(0, 1fr) auto; align-items: end; }
      .layout {
        grid-template-columns: minmax(0, 1fr) var(--layout-rail);
        align-items: start;
      }
      .agenda {
        position: sticky;
        inset-block-start: var(--space-6);
      }
    }
  }
</style>
