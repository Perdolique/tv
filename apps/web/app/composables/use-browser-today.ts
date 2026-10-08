import { onMounted, shallowRef } from 'vue'
import { useTimer, useWindowEventListener } from '@vuetify/v0'
import { getLocalCalendarDate } from '~/utils/calendar-date.ts'

function timeUntilTomorrow(): number {
  const now = new Date()
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  const remaining = tomorrow.getTime() - now.getTime()

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
