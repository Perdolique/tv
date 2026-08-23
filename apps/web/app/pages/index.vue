<template>
  <main :class="$style.component">
    <section v-if="hasSessionError">
      <p>
        TV
      </p>

      <h1>
        We couldn’t verify your session.
      </h1>

      <p>
        Try again.
      </p>

      <button
        ref="retryButton"
        :disabled="isRetrying"
        type="button"
        @click="retrySession"
      >
        Try again
      </button>
    </section>

    <section v-if="isAuthenticated">
      <p>
        TV
      </p>

      <h1
        ref="authenticatedHeading"
        tabindex="-1"
      >
        Your catalog starts here.
      </h1>

      <p>
        Signed in as <strong>{{ userEmail }}</strong>
      </p>

      <p v-if="hasSignOutError" role="alert">
        {{ signOutError }}
      </p>

      <button
        ref="signOutButton"
        :disabled="isSigningOut"
        type="button"
        @click="signOut"
      >
        Sign out
      </button>
    </section>
  </main>
</template>

<script lang="ts" setup>
  import { definePageMeta } from '#app/composables/pages'
  import { navigateTo, useHead, useRequestFetch, useResponseHeader } from '#app'
  import { computed, nextTick, ref, useTemplateRef } from 'vue'
  import { useAuthSession } from '~/composables/use-auth-session.ts'

  definePageMeta({ middleware: 'auth' })
  useHead({ title: 'Your catalog · TV' })

  const cacheControlHeader = useResponseHeader('Cache-Control')

  cacheControlHeader.value = 'private, no-store'

  const requestFetch = useRequestFetch()
  const { restoreSession, setAnonymous, state } = useAuthSession()
  const signOutError = ref('')
  const isSigningOut = ref(false)
  const isRetrying = ref(false)
  const retryButton = useTemplateRef('retryButton')
  const signOutButton = useTemplateRef('signOutButton')
  const authenticatedHeading = useTemplateRef('authenticatedHeading')
  const isAuthenticated = computed(() => state.value.status === 'authenticated')
  const hasSessionError = computed(() => state.value.status === 'error')
  const hasSignOutError = computed(() => signOutError.value !== '')

  const userEmail = computed(() => state.value.status === 'authenticated'
    ? state.value.user.email
    : '')

  async function retrySession(): Promise<void> {
    isRetrying.value = true
    await restoreSession({ force: true })
    isRetrying.value = false

    if (state.value.status === 'anonymous') {
      await navigateTo({
        path: '/sign-in',
        query: { redirectTo: '/' }
      }, { replace: true })

      return
    }

    if (state.value.status === 'authenticated') {
      await nextTick()
      authenticatedHeading.value?.focus()

      return
    }

    if (state.value.status === 'error') {
      await nextTick()
      retryButton.value?.focus()
    }
  }

  async function signOut(): Promise<void> {
    signOutError.value = ''
    isSigningOut.value = true

    try {
      await requestFetch('/api/auth/sign-out', { method: 'POST' })
      setAnonymous()
      await navigateTo('/sign-in', { replace: true })
    } catch {
      signOutError.value = 'We couldn’t sign you out. Try again.'
    } finally {
      isSigningOut.value = false

      if (signOutError.value !== '') {
        await nextTick()
        signOutButton.value?.focus()
      }
    }
  }
</script>

<style module>
  .component {
    overflow-wrap: anywhere;
  }
</style>
