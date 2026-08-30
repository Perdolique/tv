import { onBeforeUnmount, shallowRef } from 'vue'

type RequestController = InstanceType<typeof globalThis.AbortController>

function useRequestCancellation() {
  const activeController = shallowRef<RequestController>()

  function start(): RequestController {
    activeController.value?.abort()

    const controller = new globalThis.AbortController()

    activeController.value = controller

    return controller
  }

  function isCurrent(controller: RequestController): boolean {
    return activeController.value === controller && !controller.signal.aborted
  }

  function finish(controller: RequestController): boolean {
    if (!isCurrent(controller)) {
      return false
    }

    activeController.value = undefined

    return true
  }

  onBeforeUnmount(() => {
    activeController.value?.abort()
    activeController.value = undefined
  })

  return {
    finish,
    isCurrent,
    start
  }
}

export { useRequestCancellation }
