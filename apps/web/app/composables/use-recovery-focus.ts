import { useEventListener } from '@vuetify/v0'
import { IN_BROWSER } from '@vuetify/v0/constants'
import { nextTick, onScopeDispose } from 'vue'

function useRecoveryFocus() {
  let focusGeneration = 0

  if (IN_BROWSER) {
    useEventListener(globalThis.document, ['focusin', 'pointerdown'], () => { focusGeneration += 1 })
  }

  onScopeDispose(() => { focusGeneration += 1 })

  function capture(event: Event) {
    const requestedGeneration = focusGeneration
    const ownsFocus = IN_BROWSER && event.currentTarget === globalThis.document.activeElement

    return async function restoreFocus(getTarget: () => HTMLElement | null | undefined): Promise<void> {
      await nextTick()

      if (!ownsFocus || requestedGeneration !== focusGeneration) { return }

      const target = getTarget()

      target?.focus()
    }
  }

  return { capture }
}

export { useRecoveryFocus }
