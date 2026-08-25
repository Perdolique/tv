<template>
  <div>
    <div ref="container" />

    <p v-if="hasChallengeError" role="alert">
      The security check is unavailable. Refresh the page and try again.
    </p>
  </div>
</template>

<script lang="ts" setup>
  import { useHead, useRuntimeConfig } from '#app'
  import type { TurnstileAction } from '@tv/shared/turnstile'
  import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue'

  const TURNSTILE_SCRIPT_ID = 'tv-turnstile-script'
  const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

  interface Props {
    action: TurnstileAction;
  }

  interface TurnstileRenderOptions {
    action: TurnstileAction;
    callback: (token: string) => void;
    'error-callback': () => void;
    'expired-callback': () => void;
    'response-field': false;
    sitekey: string;
    size: 'flexible';
    'timeout-callback': () => void;
  }

  interface TurnstileApi {
    remove: (widgetId: string) => void;
    render: (container: HTMLElement, options: TurnstileRenderOptions) => string;
    reset: (widgetId: string) => void;
  }

  interface TurnstileGlobal {
    turnstile?: TurnstileApi;
  }

  const turnstileGlobal = globalThis as typeof globalThis & TurnstileGlobal
  const { action } = defineProps<Props>()
  const model = defineModel<string>({ required: true })
  const runtimeConfig = useRuntimeConfig()
  const container = useTemplateRef('container')
  const widgetId = ref<string>()
  const challengeError = ref('')
  const isMounted = ref(false)
  const hasChallengeError = computed(() => challengeError.value !== '')

  function clearToken(): void {
    model.value = ''
  }

  function handleSuccess(token: string): void {
    challengeError.value = ''
    model.value = token
  }

  function handleError(): void {
    clearToken()
    challengeError.value = 'unavailable'
  }

  function renderWidget(): void {
    const { turnstile } = turnstileGlobal

    if (
      !isMounted.value
      || widgetId.value !== undefined
      || container.value === null
      || turnstile === undefined
    ) {
      return
    }

    widgetId.value = turnstile.render(container.value, {
      action,
      callback: handleSuccess,
      'error-callback': handleError,
      'expired-callback': clearToken,
      'response-field': false,
      sitekey: runtimeConfig.public.turnstileSiteKey,
      size: 'flexible',
      'timeout-callback': clearToken
    })
  }

  function handleScriptError(): void {
    handleError()
  }

  function reset(): void {
    clearToken()

    const currentWidgetId = widgetId.value

    if (currentWidgetId !== undefined) {
      turnstileGlobal.turnstile?.reset(currentWidgetId)
    }
  }

  useHead({
    script: [{
      async: true,
      defer: true,
      id: TURNSTILE_SCRIPT_ID,
      onerror: handleScriptError,
      onload: renderWidget,
      src: TURNSTILE_SCRIPT_URL
    }]
  })

  onMounted(() => {
    isMounted.value = true
    renderWidget()
  })

  onBeforeUnmount(() => {
    const currentWidgetId = widgetId.value

    if (currentWidgetId !== undefined) {
      turnstileGlobal.turnstile?.remove(currentWidgetId)
    }
  })

  defineExpose({ reset })
</script>
