<template>
  <main :class="$style.component" :data-authenticated="isAuthenticated">
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

      <AppButton
        ref="retryButton"
        :disabled="isRetrying"
        @click="retrySession"
      >
        Try again
      </AppButton>
    </section>

    <template v-else-if="isAuthenticated">
      <header :class="$style.accountBar">
        <p :class="$style.wordmark">TV</p>
        <p :class="$style.accountEmail">Signed in as <strong>{{ userEmail }}</strong></p>
        <AppMessage v-if="hasSignOutError" role="alert" tone="danger">{{ signOutError }}</AppMessage>
        <AppButton ref="signOutButton" :disabled="isSigningOut" variant="secondary" @click="signOut">Sign out</AppButton>
      </header>
      <nav :class="$style.catalogNavigation" aria-label="Main navigation">
        <NuxtLink :class="$style.catalogLink" to="/" aria-current="page">
          <Icon aria-hidden="true" mode="svg" name="hugeicons:film-01" />
          <span>Catalog</span>
        </NuxtLink>
      </nav>
      <section :class="$style.catalogContent">
        <h1 ref="authenticatedHeading" :class="$style.catalogHeading" tabindex="-1">Your catalog starts here.</h1>
        <p :class="$style.supportingText">Find your next movie or series.</p>
        <CatalogSearchField :model-value="input" @update:model-value="changeInput" @submit="submitSearch" @clear="clear" />
        <CatalogResults :failure="failure" :is-loading="isLoading" :items="lastResult?.items" :result-query="lastResult?.query" @retry="retrySearch" />
      </section>
    </template>

    <section v-else-if="isAnonymous" :class="$style.panel">
      <h1
        ref="anonymousHeading"
        :class="$style.anonymousHeading"
        tabindex="-1"
      >
        TV
      </h1>

      <p :class="$style.supportingText">Sign in or create an account to search movies and series.</p>

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
  import { Icon } from '#components'
  import { definePageMeta } from '#app/composables/pages'
  import { navigateTo, useHead, useRequestFetch, useResponseHeader, useRoute } from '#app'
  import { sanitizeRedirectTo } from '@tv/shared/redirect'
  import { computed, nextTick, onMounted, ref, useTemplateRef, watch } from 'vue'
  import CatalogSearchField from '~/components/catalog/CatalogSearchField.vue'
  import CatalogResults from '~/components/catalog/CatalogResults.vue'
  import { useCatalogSearch } from '~/composables/use-catalog-search.ts'
  import AppButton from '~/components/ui/AppButton.vue'
  import AppMessage from '~/components/ui/AppMessage.vue'
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
  const { changeInput, clear, failure, input, isLoading, lastResult, ready, search, unauthorized } = useCatalogSearch(isAuthenticated)
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

  watch(unauthorized, async (expired) => {
    if (expired) {
      const target = sanitizeRedirectTo(route.fullPath)

      setAnonymous()

      await navigateTo({
        path: '/sign-in',
        query: { redirectTo: target }
      })
    }
  }, {
    immediate: true,
    flush: 'sync'
  })

  function submitSearch(): void {
    void search()
  }

  function retrySearch(): void {
    void search(true)
  }

  await ready

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

    .component[data-authenticated='true'] {
      display: block;
      padding: 0;
      padding-block-end: calc(5rem + env(safe-area-inset-bottom));
      background: var(--color-canvas);
    }

    .accountBar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-4);
      padding-block-start: max(var(--space-4), env(safe-area-inset-top));
      border-block-end: 1px solid var(--color-border);
      background: var(--color-surface);
    }

    .accountEmail {

      flex: 1 1 10rem;

      color: var(--color-text-secondary);

      font-size: 0.875rem;

    }

    .catalogNavigation {
      position: fixed;
      inset-block-end: 0;
      inset-inline: 0;
      z-index: 2;
      padding: var(--space-2) var(--space-4);
      padding-block-end: max(var(--space-2), env(safe-area-inset-bottom));
      border-block-start: 1px solid var(--color-border);
      background: var(--color-surface);
    }

    .catalogLink {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: var(--space-2);
      min-block-size: 2.75rem;
      padding: var(--space-2);
      border-radius: var(--radius-sm);
      background: var(--color-surface-muted);
      font-weight: 600;
      text-decoration: none;
    }

    .catalogHeading {

      font-size: 1.75rem;

      line-height: 1.15;

      font-weight: 600;

    }

    .catalogContent {

      display: grid;

      gap: var(--space-6);

      max-inline-size: 56rem;

      padding: var(--space-8) var(--layout-page-mobile);

    }

    @media (width >= 40rem) {
      .catalogHeading {
        font-size: 2.25rem;
        line-height: 1.17;
      }
      .component[data-authenticated='true'] {
        padding-block-end: 0;
        padding-inline-start: var(--layout-sidebar-compact);
      }
      .catalogNavigation {
        inset-inline-end: auto;
        inset-block: 0;
        inline-size: var(--layout-sidebar-compact);
        padding: var(--space-4) var(--space-1);
        border: 0;
        border-inline-end: 1px solid var(--color-border);
      }
      .catalogLink {
        flex-direction: column;
        font-size: 0.875rem;
      }
      .catalogContent {
        padding-inline: var(--layout-page-compact);
      }
    }

    @media (width >= 64rem) {
      .component[data-authenticated='true'] {
        padding-inline-start: var(--layout-sidebar-wide);
      }
      .catalogNavigation {
        inline-size: var(--layout-sidebar-wide);
        padding: var(--space-8) var(--space-4);
      }
      .catalogLink {
        flex-direction: row;
        justify-content: flex-start;
        font-size: 1rem;
      }
      .catalogContent {
        padding: var(--space-10) var(--layout-page-wide);
      }
      .accountBar {
        position: fixed;
        inset-inline-start: 0;
        inset-block: 0;
        display: flex;
        flex-direction: column;
        align-items: stretch;
        inline-size: var(--layout-sidebar-wide);
        padding: var(--space-8) var(--space-4);
        border-block-end: 0;
        border-inline-end: 1px solid var(--color-border);
      }
      .accountEmail {
        flex: 0 1 auto;
        margin-block-start: auto;
      }
      .catalogNavigation {
        inset-block: 6rem auto;
        border-inline-end: 0;
      }

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

    .navigation {
      display: grid;
      gap: var(--space-3);
    }

    .primaryLink,
    .secondaryLink {
      min-block-size: 3.5rem;
      padding: var(--space-3) var(--space-6);
      border-radius: var(--radius-md);
      font-weight: 700;
      text-align: center;
      text-decoration: none;
    }

    .primaryLink {
      border: 0;
      background: var(--color-accent-fill);
      color: var(--color-on-accent);
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
