import { onScopeDispose, shallowRef } from 'vue'

type RequestController = InstanceType<typeof globalThis.AbortController>

function useRequestCancellation() {
  const activeController = shallowRef<RequestController>()

  function cancel(): void {
    activeController.value?.abort()

    activeController.value = undefined
  }

  function start(): RequestController {
    cancel()

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

  onScopeDispose(cancel)

  return {
    cancel,
    finish,
    isCurrent,
    start
  }
}

export { useRequestCancellation }
