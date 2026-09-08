<template>
  <div :class="$style.component" :data-authenticated="isAuthenticated">
    <main v-if="hasSessionError" :class="$style.panel">
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
    </main>

    <CatalogShell v-else-if="isAuthenticated" active-catalog @signed-out="focusAnonymousHeading">
      <main :class="$style.catalogContent">
        <h1 ref="authenticatedHeading" :class="$style.catalogHeading" tabindex="-1">Your catalog starts here.</h1>
        <p :class="$style.supportingText">Find your next movie or series.</p>
        <CatalogSearchField :model-value="input" @update:model-value="changeInput" @submit="submitSearch" @clear="clear" />
        <CatalogResults ref="catalogResults" :failure="failure" :is-loading="isLoading" :items="lastResult?.items" :result-query="lastResult?.query" @retry="retrySearch" />
      </main>
    </CatalogShell>

    <main v-else-if="isAnonymous" :class="$style.panel">
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
    </main>
  </div>
</template>

<script lang="ts" setup>
  import { definePageMeta } from '#app/composables/pages'
  import { navigateTo, useHead, useResponseHeader, useRoute } from '#app'
  import { sanitizeRedirectTo } from '@tv/shared/redirect'
  import { computed, nextTick, onMounted, ref, useTemplateRef, watch } from 'vue'
  import CatalogShell from '~/components/catalog/CatalogShell.vue'
  import CatalogSearchField from '~/components/catalog/CatalogSearchField.vue'
  import CatalogResults from '~/components/catalog/CatalogResults.vue'
  import { useCatalogSearch } from '~/composables/use-catalog-search.ts'
  import AppButton from '~/components/ui/AppButton.vue'
  import { useAuthSession } from '~/composables/use-auth-session.ts'

  definePageMeta({ middleware: 'session' })

  const cacheControlHeader = useResponseHeader('Cache-Control')

  cacheControlHeader.value = 'private, no-store'

  const route = useRoute()
  const { restoreSession, setAnonymous, state } = useAuthSession()
  const isRetrying = ref(false)
  const retryButton = useTemplateRef('retryButton')
  const authenticatedHeading = useTemplateRef('authenticatedHeading')
  const anonymousHeading = useTemplateRef('anonymousHeading')
  const catalogResults = useTemplateRef('catalogResults')
  const isAuthenticated = computed(() => state.value.status === 'authenticated')
  const { changeInput, clear, failure, input, isLoading, lastResult, ready, search, unauthorized } = useCatalogSearch(isAuthenticated)
  const isAnonymous = computed(() => state.value.status === 'anonymous')
  const hasSessionError = computed(() => state.value.status === 'error')
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
      }, { replace: true })
    }
  }, {
    immediate: true,
    flush: 'sync'
  })

  function submitSearch(): void {
    void search(failure.value !== '')
  }

  async function waitForSearchToSettle(): Promise<void> {
    if (!isLoading.value) {
      return
    }

    const settled = Promise.withResolvers<boolean>()

    const stop = watch(isLoading, (loading) => {
      if (!loading) {
        stop()
        settled.resolve(true)
      }
    }, { flush: 'sync' })

    await settled.promise
  }

  async function retrySearch(): Promise<void> {
    await search(true)
    await waitForSearchToSettle()
    await nextTick()
    catalogResults.value?.focusAfterRetry()
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

  async function focusAnonymousHeading(): Promise<void> {
    await nextTick()
    anonymousHeading.value?.focus()
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
      background: var(--color-canvas);
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
      .catalogContent {
        padding-inline: var(--layout-page-compact);
      }
    }

    @media (width >= 64rem) {
      .catalogContent {
        padding: var(--space-10) var(--layout-page-wide);
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
