import { onMounted, shallowRef } from 'vue'

function useBrowserTimeZone() {
  const timeZone = shallowRef<string | null>(null)

  onMounted(() => {
    const formatter = new Intl.DateTimeFormat()
    const options = formatter.resolvedOptions()

    timeZone.value = options.timeZone
  })

  return { timeZone }
}

export { useBrowserTimeZone }
