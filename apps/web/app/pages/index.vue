<template>
  <main :class="$style.component">
    <section v-if="hasSessionError" :class="$style.panel">
      <p :class="$style.wordmark">
        TV
      </p>

      <h1 :class="$style.heading">
        We couldn’t verify your session.
      </h1>

      <p :class="$style.supportingText">
        Try again.
      </p>

      <button
        ref="retryButton"
        :class="$style.primaryButton"
        :disabled="isRetrying"
        type="button"
        @click="retrySession"
      >
        Try again
      </button>
    </section>

    <section v-else-if="isAuthenticated" :class="$style.panel">
      <p :class="$style.wordmark">
        TV
      </p>

      <h1
        ref="authenticatedHeading"
        :class="$style.heading"
        tabindex="-1"
      >
        Your catalog starts here.
      </h1>

      <p :class="$style.supportingText">
        Signed in as <strong>{{ userEmail }}</strong>
      </p>

      <p v-if="hasSignOutError" :class="$style.error" role="alert">
        {{ signOutError }}
      </p>

      <button
        ref="signOutButton"
        :class="$style.primaryButton"
        :disabled="isSigningOut"
        type="button"
        @click="signOut"
      >
        Sign out
      </button>
    </section>

    <section v-else-if="isAnonymous" :class="$style.panel">
      <h1
        ref="anonymousHeading"
        :class="$style.anonymousHeading"
        tabindex="-1"
      >
        TV
      </h1>

      <nav :class="$style.navigation" aria-label="Authentication">
        <NuxtLink :class="$style.primaryLink" :to="signInLocation">
          Sign in
        </NuxtLink>
        <NuxtLink :class="$style.secondaryLink" :to="registerLocation">
          Create an account
        </NuxtLink>
      </nav>
    </section>
  </main>
</template>

<script lang="ts" setup>
  import { definePageMeta } from '#app/composables/pages'
  import { useHead, useRequestFetch, useResponseHeader, useRoute } from '#app'
  import { sanitizeRedirectTo } from '@tv/shared/redirect'
  import { computed, nextTick, onMounted, ref, useTemplateRef } from 'vue'
  import { useAuthSession } from '~/composables/use-auth-session.ts'

  definePageMeta({ middleware: 'session' })

  const cacheControlHeader = useResponseHeader('Cache-Control')

  cacheControlHeader.value = 'private, no-store'

  const route = useRoute()
  const requestFetch = useRequestFetch()
  const { restoreSession, setAnonymous, state } = useAuthSession()
  const signOutError = ref('')
  const isSigningOut = ref(false)
  const isRetrying = ref(false)
  const retryButton = useTemplateRef('retryButton')
  const signOutButton = useTemplateRef('signOutButton')
  const authenticatedHeading = useTemplateRef('authenticatedHeading')
  const anonymousHeading = useTemplateRef('anonymousHeading')
  const isAuthenticated = computed(() => state.value.status === 'authenticated')
  const isAnonymous = computed(() => state.value.status === 'anonymous')
  const hasSessionError = computed(() => state.value.status === 'error')
  const hasSignOutError = computed(() => signOutError.value !== '')
  const redirectTo = computed(() => sanitizeRedirectTo(route.fullPath))

  const signInLocation = computed(() => redirectTo.value === '/'
    ? '/sign-in'
    : {
        path: '/sign-in',
        query: { redirectTo: redirectTo.value }
      })

  const registerLocation = computed(() => redirectTo.value === '/'
    ? '/register'
    : {
        path: '/register',
        query: { redirectTo: redirectTo.value }
      })

  const userEmail = computed(() => state.value.status === 'authenticated'
    ? state.value.user.email
    : '')

  const pageTitle = computed(() => isAuthenticated.value
    ? 'Your catalog · TV'
    : 'TV')

  useHead(() => {
    return { title: pageTitle.value }
  })

  onMounted(() => {
    if (globalThis.location.hash.startsWith('#token=')) {
      globalThis.history.replaceState(
        globalThis.history.state,
        '',
        `${globalThis.location.pathname}${globalThis.location.search}`
      )
    }
  })

  async function retrySession(): Promise<void> {
    isRetrying.value = true
    await restoreSession({ force: true })
    isRetrying.value = false

    if (state.value.status === 'anonymous') {
      await nextTick()
      anonymousHeading.value?.focus()

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
      await nextTick()
      anonymousHeading.value?.focus()
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
  @layer reset, vendor, tokens, base, components, utilities;

  @layer components {
    .component {
      display: grid;
      place-items: center;
      min-block-size: 100svh;
      padding: var(--space-6) var(--layout-page-mobile);
      background:
        radial-gradient(circle at top, var(--color-surface-muted), transparent 52%),
        var(--color-canvas);
    }

    .panel {
      display: grid;
      gap: var(--space-5);
      inline-size: min(100%, 34rem);
      padding: var(--space-8);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-xl);
      background: var(--color-surface);
      box-shadow: var(--shadow-card);
    }

    .wordmark,
    .anonymousHeading {
      color: var(--color-accent);
      font-weight: 700;
      letter-spacing: -0.08em;
      line-height: 1;
    }

    .wordmark {
      font-size: 1.5rem;
    }

    .anonymousHeading {
      font-size: clamp(3.5rem, 18vw, 6rem);
      text-align: center;
    }

    .heading {
      font-size: clamp(1.75rem, 7vw, 2.5rem);
      line-height: 1.15;
    }

    .supportingText {
      color: var(--color-text-secondary);
    }

    .error {
      padding: var(--space-3) var(--space-4);
      border-radius: var(--radius-sm);
      background: var(--color-surface-muted);
      color: var(--color-danger);
    }

    .navigation {
      display: grid;
      gap: var(--space-3);
    }

    .primaryButton,
    .primaryLink,
    .secondaryLink {
      min-block-size: 3.5rem;
      padding: var(--space-3) var(--space-6);
      border-radius: var(--radius-md);
      font-weight: 700;
      text-align: center;
      text-decoration: none;
    }

    .primaryButton,
    .primaryLink {
      border: 0;
      background: var(--color-accent-fill);
      color: var(--color-on-accent);
    }

    .primaryButton {
      cursor: pointer;
    }

    .primaryButton:disabled {
      cursor: not-allowed;
      opacity: 0.55;
    }

    .secondaryLink {
      border: 1px solid var(--color-border-strong);
      background: var(--color-surface);
      color: var(--color-text-primary);
    }

    @media (width >= 40rem) {
      .component {
        padding-inline: var(--layout-page-compact);
      }
    }
  }
</style>
