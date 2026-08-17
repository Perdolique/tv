<script setup lang="ts">
import { definePageMeta } from '#app/composables/pages'
import { navigateTo, useHead, useRequestFetch } from '#app'
import { computed, nextTick, ref, useTemplateRef } from 'vue'
import { useAuthSession } from '~/composables/use-auth-session.ts'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Your catalog · TV' })

const requestFetch = useRequestFetch()
const { restoreSession, setAnonymous, state } = useAuthSession()
const signOutError = ref('')
const isSigningOut = ref(false)
const isRetrying = ref(false)
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
  }
}
</script>

<template>
  <main :class="$style.component">
    <section v-if="hasSessionError" :class="$style.card">
      <p :class="$style.brand">
        TV
      </p>

      <h1 :class="$style.heading">
        We couldn’t verify your session.
      </h1>

      <p :class="$style.description">
        Try again.
      </p>

      <button
        :class="$style.primaryButton"
        :disabled="isRetrying"
        type="button"
        @click="retrySession"
      >
        Try again
      </button>
    </section>

    <section v-if="isAuthenticated" :class="$style.card">
      <p :class="$style.brand">
        TV
      </p>

      <h1
        ref="authenticatedHeading"
        :class="$style.heading"
        tabindex="-1"
      >
        Your catalog starts here.
      </h1>

      <p :class="$style.description">
        Signed in as <strong :class="$style.userEmail">{{ userEmail }}</strong>
      </p>

      <p v-if="hasSignOutError" :class="$style.error" role="alert">
        {{ signOutError }}
      </p>

      <button
        :class="$style.secondaryButton"
        :disabled="isSigningOut"
        type="button"
        @click="signOut"
      >
        Sign out
      </button>
    </section>
  </main>
</template>

<style module>
.component {
  display: grid;
  min-block-size: 100vh;
  place-items: center;
  padding: 2rem 1rem;
  background:
    radial-gradient(circle at top, rgb(37 99 235 / 18%), transparent 34rem),
    #090d16;
  color: #f8fafc;
  font-family: Inter, ui-sans-serif, system-ui, sans-serif;
}

.card {
  inline-size: min(100%, 36rem);
  padding: 2.5rem;
  border: 1px solid #263244;
  border-radius: 1.25rem;
  background: #111827;
  box-shadow: 0 1.5rem 4rem rgb(0 0 0 / 35%);
  text-align: center;
}

.brand {
  color: #60a5fa;
  font-size: 0.875rem;
  font-weight: 800;
  letter-spacing: 0.18em;
}

.heading {
  margin-block-start: 0.75rem;
  font-size: clamp(2rem, 6vw, 3rem);
  line-height: 1.1;
}

.heading:focus-visible {
  outline: 3px solid #60a5fa;
  outline-offset: 2px;
}

.description {
  margin-block-start: 1rem;
  color: #aeb9c9;
  line-height: 1.6;
}

.userEmail {
  overflow-wrap: anywhere;
}

.error {
  margin-block-start: 1.25rem;
  padding: 0.75rem;
  border: 1px solid #991b1b;
  border-radius: 0.625rem;
  background: #450a0a;
  color: #fca5a5;
}

.primaryButton,
.secondaryButton {
  min-block-size: 2.875rem;
  margin-block-start: 1.5rem;
  padding: 0.7rem 1.25rem;
  border-radius: 0.625rem;
  cursor: pointer;
  font: inherit;
  font-weight: 800;
}

.primaryButton {
  border: 0;
  background: #2563eb;
  color: #fff;
}

.secondaryButton {
  border: 1px solid #475569;
  background: transparent;
  color: #e2e8f0;
}

.primaryButton:focus-visible,
.secondaryButton:focus-visible {
  outline: 3px solid #60a5fa;
  outline-offset: 2px;
}

.primaryButton:disabled,
.secondaryButton:disabled {
  cursor: wait;
  opacity: 0.65;
}

@media (max-width: 30rem) {
  .card {
    padding: 1.5rem;
  }
}
</style>
