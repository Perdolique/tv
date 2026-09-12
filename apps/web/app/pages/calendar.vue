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
            <p :class="$style.supportingText">Upcoming movies and episodes from your watchlist.</p>
          </div>
          <div :class="$style.monthNavigation" aria-label="Calendar navigation">
            <AppButton :disabled="isPreviousDisabled" variant="secondary" @click="previousMonth">
              <Icon aria-hidden="true" mode="svg" name="hugeicons:arrow-left-01" />
              Previous
            </AppButton>
            <p :class="$style.monthLabel" aria-live="polite">{{ monthLabel }}</p>
            <AppButton :disabled="isNextDisabled" variant="secondary" @click="nextMonth">
              Next
              <Icon aria-hidden="true" mode="svg" name="hugeicons:arrow-right-01" />
            </AppButton>
            <AppButton :disabled="isTodaySelected" variant="secondary" @click="selectToday">Today</AppButton>
          </div>
        </header>

        <div :class="$style.mobileModes" role="group" aria-label="Calendar view">
          <button :class="$style.modeButton" :aria-pressed="mobileMode === 'agenda'" @click="mobileMode = 'agenda'">Agenda</button>
          <button :class="$style.modeButton" :aria-pressed="mobileMode === 'month'" @click="mobileMode = 'month'">Month</button>
        </div>

        <CalendarWeek
          v-if="selectedDate !== null"
          :class="$style.mobileWeek"
          :days="weekDays"
          :selected-date="selectedDate"
          @select="pushDate"
        />
        <div v-else :class="$style.weekSkeleton" aria-hidden="true">
          <span v-for="day in 7" :key="day" />
        </div>

        <div
          :class="$style.layout"
          :data-mobile-mode="mobileMode"
          :data-show-mobile-agenda-outcome="showMobileAgendaOutcome"
        >
          <CalendarMonth
            :class="$style.month"
            :days="monthDays"
            :is-loading="showLoading"
            :releases-by-date="releasesByDate"
            :selected-date="selectedDate"
            @select="selectDateFromMonth"
          />
          <CalendarAgenda
            ref="agenda"
            :class="$style.agenda"
            :has-error="hasError"
            :is-loading="showLoading"
            :items="selectedItems"
            :month-has-items="items.length > 0"
            :selected-date="selectedDate"
            @retry="retryReleases"
          />
        </div>
      </main>
    </AppShell>
  </div>
</template>

<script lang="ts" setup>
  import { Icon } from '#components'
  import { definePageMeta } from '#app/composables/pages'
  import { navigateTo, useHead, useResponseHeader, useRoute, useRouter } from '#app'
  import { sanitizeRedirectTo } from '@tv/shared/redirect'
  import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
  import AppShell from '~/components/app/AppShell.vue'
  import CalendarAgenda from '~/components/calendar/CalendarAgenda.vue'
  import CalendarMonth from '~/components/calendar/CalendarMonth.vue'
  import CalendarWeek from '~/components/calendar/CalendarWeek.vue'
  import AppButton from '~/components/ui/AppButton.vue'
  import { useAuthSession } from '~/composables/use-auth-session.ts'
  import { useCatalogReleases } from '~/composables/use-catalog-releases.ts'

  import {
    formatCalendarDateForDisplay,
    getCalendarMonthDays,
    getCalendarReleaseRange,
    getCalendarWeekDays,
    getLocalCalendarDate,
    groupReleasesByDate,
    normalizeCalendarQuery,
    parseCalendarDate,
    shiftCalendarMonth,
    type CalendarReleaseRange
  } from '~/utils/calendar-date.ts'

  type MobileMode = 'agenda' | 'month'

  definePageMeta({ middleware: 'authenticated' })
  useHead({ title: 'Release calendar · TV' })

  const cacheControlHeader = useResponseHeader('Cache-Control')

  cacheControlHeader.value = 'private, no-store'

  const route = useRoute()
  const router = useRouter()
  const { restoreSession, setAnonymous, state } = useAuthSession()
  const agenda = useTemplateRef('agenda')
  const heading = useTemplateRef('heading')
  const sessionRetryButton = useTemplateRef('sessionRetryButton')
  const today = ref<string | null>(null)
  const selectedDate = ref<string | null>(null)
  const mobileMode = ref<MobileMode>('agenda')
  const isRetryingSession = ref(false)
  const isAuthenticated = computed(() => state.value.status === 'authenticated')
  const isAnonymous = computed(() => state.value.status === 'anonymous')
  const hasSessionError = computed(() => state.value.status === 'error')
  const accountId = computed(() => state.value.status === 'authenticated' ? state.value.user.id : null)

  const range = computed<CalendarReleaseRange | null>(() => {
    if (selectedDate.value === null || today.value === null) {
      return null
    }

    return getCalendarReleaseRange(selectedDate.value, today.value)
  })

  const { hasError, isLoading, items, reload, unauthorized } = useCatalogReleases(accountId, range)
  const showLoading = computed(() => selectedDate.value === null || isLoading.value)
  const shouldSignIn = computed(() => isAnonymous.value || unauthorized.value)
  const redirectTo = computed(() => sanitizeRedirectTo(route.fullPath))
  const releasesByDate = computed(() => groupReleasesByDate(items.value))

  const selectedItems = computed(() => selectedDate.value === null
    ? []
    : releasesByDate.value.get(selectedDate.value) ?? [])

  const monthDays = computed(() => selectedDate.value === null || today.value === null
    ? []
    : getCalendarMonthDays(selectedDate.value, today.value))

  const weekDays = computed(() => selectedDate.value === null || today.value === null
    ? []
    : getCalendarWeekDays(selectedDate.value, today.value))

  const showMobileAgendaOutcome = computed(() => (
    !showLoading.value
    && !unauthorized.value
    && (hasError.value || items.value.length === 0 || selectedItems.value.length === 0)
  ))

  const monthLabel = computed(() => {
    if (selectedDate.value === null) {
      return 'Loading month…'
    }

    return formatCalendarDateForDisplay(`${selectedDate.value.slice(0, 7)}-01`, {
      month: 'long',
      year: 'numeric'
    })
  })

  const isPreviousDisabled = computed(() => {
    if (selectedDate.value === null || today.value === null) {
      return true
    }

    return selectedDate.value.slice(0, 7) === today.value.slice(0, 7)
  })

  const isTodaySelected = computed(() => selectedDate.value === null || selectedDate.value === today.value)
  const isNextDisabled = computed(() => selectedDate.value?.startsWith('9999-12') ?? true)

  const signInLocation = computed(() => {
    return {
      path: '/sign-in',
      query: { redirectTo: redirectTo.value }
    }
  })

  watch(shouldSignIn, async (redirect) => {
    if (!redirect) {
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

  watch([() => route.query.date, today], ([value, currentToday]) => {
    if (currentToday === null) {
      return
    }

    const normalized = normalizeCalendarQuery(value, currentToday)

    selectedDate.value = normalized

    if (value !== normalized) {
      void router.replace({
        path: '/calendar',
        query: { date: normalized }
      })
    }
  }, {
    flush: 'sync',
    immediate: true
  })

  let todayRefreshTimer: ReturnType<typeof globalThis.setTimeout> | null = null

  function refreshLocalToday(): void {
    if (todayRefreshTimer !== null) {
      globalThis.clearTimeout(todayRefreshTimer)
    }

    const now = new Date()
    const nextLocalDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
    const delay = Math.max(1000, nextLocalDay.getTime() - now.getTime() + 100)

    today.value = getLocalCalendarDate(now)
    todayRefreshTimer = globalThis.setTimeout(refreshLocalToday, delay)
  }

  function refreshVisibleCalendar(): void {
    if (globalThis.document.visibilityState === 'visible') {
      refreshLocalToday()
    }
  }

  onMounted(() => {
    refreshLocalToday()
    globalThis.addEventListener('focus', refreshLocalToday)
    globalThis.document.addEventListener('visibilitychange', refreshVisibleCalendar)
  })

  onBeforeUnmount(() => {
    if (todayRefreshTimer !== null) {
      globalThis.clearTimeout(todayRefreshTimer)
    }

    globalThis.removeEventListener('focus', refreshLocalToday)
    globalThis.document.removeEventListener('visibilitychange', refreshVisibleCalendar)
  })

  async function pushDate(date: string): Promise<void> {
    if (
      today.value === null
      || date < today.value
      || parseCalendarDate(date) === null
      || route.query.date === date
    ) {
      return
    }

    await router.push({
      path: '/calendar',
      query: { date }
    })
  }

  async function selectDateFromMonth(date: string): Promise<void> {
    mobileMode.value = 'agenda'

    await pushDate(date)
    await nextTick()
    agenda.value?.focusHeading()
  }

  function previousMonth(): void {
    if (selectedDate.value === null || today.value === null || isPreviousDisabled.value) {
      return
    }

    void pushDate(shiftCalendarMonth(selectedDate.value, -1, today.value))
  }

  function nextMonth(): void {
    if (selectedDate.value === null || today.value === null || isNextDisabled.value) {
      return
    }

    void pushDate(shiftCalendarMonth(selectedDate.value, 1, today.value))
  }

  function selectToday(): void {
    if (today.value !== null) {
      void pushDate(today.value)
    }
  }

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
    .monthNavigation {
      display: grid;
      grid-template-columns: 1fr 1fr;
      align-items: center;
      gap: var(--space-2);
    }
    .monthLabel {
      grid-column: 1 / -1;
      grid-row: 1;
      font-size: 1.125rem;
      font-weight: 700;
      text-align: center;
    }
    .monthNavigation > :last-child { grid-column: 1 / -1; justify-self: center; }
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
    .layout { min-inline-size: 0; }
    .layout[data-mobile-mode='agenda'] .month { display: none; }
    .layout[data-mobile-mode='month'] .agenda { display: none; }
    .layout[data-mobile-mode='month'][data-show-mobile-agenda-outcome='true'] .agenda {
      display: grid;
      margin-block-start: var(--space-5);
    }
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
      .monthNavigation { grid-template-columns: auto minmax(10rem, auto) auto auto; }
      .monthLabel { grid-column: auto; grid-row: auto; }
      .monthNavigation > :last-child { grid-column: auto; justify-self: auto; }
      .mobileModes, .mobileWeek, .weekSkeleton { display: none; }
      .layout { display: grid; gap: var(--space-6); }
      .layout[data-mobile-mode] .month, .layout[data-mobile-mode] .agenda { display: grid; }
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
