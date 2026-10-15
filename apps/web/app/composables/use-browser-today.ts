import { onMounted, shallowRef } from 'vue'
import { useTimer, useWindowEventListener } from '@vuetify/v0'
import { getLocalCalendarDate } from '~/utils/calendar-date.ts'

function timeUntilTomorrow(): number {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth()
  const day = now.getDate() + 1
  const tomorrow = new Date(year, month, day)
  const tomorrowTime = tomorrow.getTime()
  const nowTime = now.getTime()
  const remaining = tomorrowTime - nowTime

  return Math.max(1, remaining)
}

function useBrowserToday() {
  const today = shallowRef<string | null>(null)

  function refreshToday(): void {
    today.value = getLocalCalendarDate()
  }

  const timer = useTimer(refreshToday, {
    duration: timeUntilTomorrow,
    repeat: true
  })

  function start(): void {
    refreshToday()
    timer.start()
  }

  onMounted(start)
  useWindowEventListener('focus', start)

  return { today }
}

export { useBrowserToday }
