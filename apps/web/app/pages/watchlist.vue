<template>
  <div :class="$style.component">
    <main v-if="hasSessionError" :class="$style.sessionPanel">
      <p :class="$style.wordmark">TV</p>
      <h1 :class="$style.heading">We couldn’t verify your session.</h1>
      <p :class="$style.supportingText">Try again to open your watchlist.</p>
      <AppButton ref="sessionRetryButton" :disabled="isRetryingSession" @click="retrySession">Try again</AppButton>
    </main>

    <AppShell v-else-if="isAuthenticated" active-destination="watchlist">
      <main :class="$style.content">
        <header :class="$style.pageHeader">
          <h1 ref="heading" :class="$style.heading" tabindex="-1">Watchlist</h1>
          <p :class="$style.supportingText">Titles you follow, newest first.</p>
        </header>

        <p role="status" aria-live="polite" :class="$style.status">{{ announcement }}</p>

        <section v-if="isLoading" :class="$style.loadingList" aria-label="Loading watchlist" aria-busy="true">
          <div v-for="row in 3" :key="row" :class="$style.skeletonRow" aria-hidden="true">
            <div :class="$style.skeletonPoster" />
            <div :class="$style.skeletonCopy">
              <div :class="$style.skeletonTitle" />
              <div :class="$style.skeletonMetadata" />
            </div>
          </div>
        </section>

        <section v-else-if="hasError" :class="$style.message">
          <AppMessage role="alert" tone="danger">We couldn’t load your watchlist. Try again.</AppMessage>
          <AppButton ref="retryButton" variant="secondary" @click="retryWatchlist">Try again</AppButton>
        </section>

        <section v-else-if="isEmpty" :class="$style.message">
          <h2 :class="$style.subheading">Your watchlist is empty</h2>
          <p :class="$style.supportingText">Browse the catalog and follow a movie or series to see it here.</p>
          <NuxtLink :class="$style.catalogLink" to="/">Browse catalog</NuxtLink>
        </section>

        <ul v-else :class="$style.list" aria-label="Followed titles">
          <li v-for="item in rows" :key="item.id" :class="$style.item">
            <NuxtLink :class="$style.itemLink" :to="item.location">
              <CatalogPoster compact :poster-url="item.posterUrl" :title="item.title" />
              <div :class="$style.itemCopy">
                <h2 :class="$style.itemTitle" :lang="item.titleLocale">{{ item.title }}</h2>
                <p :class="$style.metadata">{{ item.metadata }}</p>
              </div>
            </NuxtLink>
          </li>
        </ul>
      </main>
    </AppShell>
  </div>
</template>

<script lang="ts" setup>
  import { definePageMeta } from '#app/composables/pages'
  import { navigateTo, useHead, useResponseHeader, useRoute } from '#app'
  import { sanitizeRedirectTo } from '@tv/shared/redirect'
  import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
  import AppShell from '~/components/app/AppShell.vue'
  import CatalogPoster from '~/components/catalog/CatalogPoster.vue'
  import AppButton from '~/components/ui/AppButton.vue'
  import AppMessage from '~/components/ui/AppMessage.vue'
  import { useAuthSession } from '~/composables/use-auth-session.ts'
  import { useCatalogWatchlist } from '~/composables/use-catalog-watchlist.ts'

  definePageMeta({ middleware: 'authenticated' })
  useHead({ title: 'Watchlist · TV' })

  const cacheControlHeader = useResponseHeader('Cache-Control')

  cacheControlHeader.value = 'private, no-store'

  const route = useRoute()
  const { restoreSession, setAnonymous, state } = useAuthSession()
  const isRetryingSession = ref(false)
  const heading = useTemplateRef('heading')
  const retryButton = useTemplateRef('retryButton')
  const sessionRetryButton = useTemplateRef('sessionRetryButton')
  const isAuthenticated = computed(() => state.value.status === 'authenticated')
  const isAnonymous = computed(() => state.value.status === 'anonymous')
  const hasSessionError = computed(() => state.value.status === 'error')
  const accountId = computed(() => state.value.status === 'authenticated' ? state.value.user.id : null)
  const { hasError, isLoading, items, ready, reload, unauthorized } = useCatalogWatchlist(accountId)
  const isEmpty = computed(() => items.value.length === 0)
  const shouldSignIn = computed(() => isAnonymous.value || unauthorized.value)
  const redirectTo = computed(() => sanitizeRedirectTo(route.fullPath))

  const signInLocation = computed(() => {
    return {
      path: '/sign-in',
      query: { redirectTo: redirectTo.value }
    }
  })

  const rows = computed(() => items.value.map((item) => {
    const type = item.type === 'movie' ? 'Movie' : 'Series'
    const metadata = item.releaseYear === null ? type : `${type} · ${item.releaseYear}`

    return {
      id: item.id,
      metadata,
      posterUrl: item.posterUrl,
      title: item.title,
      titleLocale: item.titleLocale,

      location: {
        path: `/titles/${item.id}`
      }
    }
  }))

  const announcement = computed(() => {
    if (isLoading.value) {
      return 'Loading your watchlist…'
    }

    if (hasError.value) {
      return ''
    }

    const count = items.value.length
    const label = count === 1 ? 'title' : 'titles'

    return count === 0
      ? 'Your watchlist is empty.'
      : `${count} ${label} in your watchlist.`
  })

  watch(shouldSignIn, async (redirect) => {
    if (!redirect) {
      return
    }

    if (unauthorized.value) {
      setAnonymous()
    }

    await navigateTo(signInLocation.value, { replace: true })
  }, {
    flush: 'sync',
    immediate: true
  })

  if (import.meta.server) {
    await ready
  }

  async function retrySession(): Promise<void> {
    isRetryingSession.value = true

    await restoreSession({ force: true })

    isRetryingSession.value = false

    await nextTick()

    if (state.value.status === 'error') {
      sessionRetryButton.value?.focus()
    } else if (state.value.status === 'authenticated') {
      heading.value?.focus()
    }
  }

  async function retryWatchlist(): Promise<void> {
    await reload()
    await nextTick()

    if (hasError.value) {
      retryButton.value?.focus()
    } else {
      heading.value?.focus()
    }
  }
</script>

<style module>
  @layer reset, vendor, tokens, base, components, utilities;

  @layer components {
    .component { min-block-size: 100svh; }
    .content {
      display: grid;
      gap: var(--space-6);
      max-inline-size: 56rem;
      margin-inline: auto;
      padding: var(--space-8) var(--layout-page-mobile) var(--space-12);
    }
    .pageHeader { display: grid; gap: var(--space-2); }
    .heading {
      font-size: 1.75rem;
      font-weight: 600;
      line-height: 1.15;
    }
    .subheading {
      font-size: 1.375rem;
      font-weight: 600;
    }
    .supportingText, .status, .metadata { color: var(--color-text-secondary); }
    .status { min-block-size: 1.5rem; }
    .list, .loadingList {
      display: grid;
      gap: var(--space-4);
    }
    .list {
      padding: 0;
      list-style: none;
    }
    .item, .skeletonRow {
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      background: var(--color-surface);
      box-shadow: var(--shadow-card);
    }
    .itemLink, .skeletonRow {
      display: grid;
      grid-template-columns: 5rem minmax(0, 1fr);
      gap: var(--space-4);
      align-items: center;
      min-block-size: 7.5rem;
      padding: var(--space-3);
    }
    .itemLink {
      color: var(--color-text-primary);
      text-decoration: none;
    }
    .skeletonPoster {
      aspect-ratio: 2 / 3;
      border-radius: var(--radius-lg);
      background: var(--color-surface-muted);
    }
    .itemCopy, .skeletonCopy {
      /* Let long titles shrink inside the poster grid instead of widening the page. */
      min-inline-size: 0;
    }
    .itemCopy { display: grid; gap: var(--space-2); }
    .itemTitle {
      max-block-size: 2.6em;
      overflow: hidden;
      font-size: 1.125rem;
      font-weight: 600;
      line-height: 1.3;

      .itemLink:hover & { text-decoration: underline; text-underline-offset: 0.2em; }
    }
    .metadata { font-size: 0.875rem; }
    .skeletonCopy { display: grid; gap: var(--space-3); }
    .skeletonTitle, .skeletonMetadata {
      block-size: 1rem;
      border-radius: var(--radius-round);
      background: var(--color-surface-muted);
    }
    .skeletonTitle { inline-size: min(100%, 18rem); }
    .skeletonMetadata { inline-size: min(65%, 10rem); }
    .message {
      display: grid;
      justify-items: start;
      gap: var(--space-4);
      padding: var(--space-8);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      background: var(--color-surface);
    }
    .catalogLink {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-block-size: 3.25rem;
      padding: var(--space-3) var(--space-5);
      border-radius: var(--radius-md);
      background: var(--color-accent-fill);
      color: var(--color-on-accent);
      font-weight: 700;
      text-decoration: none;
    }
    .sessionPanel {
      display: grid;
      justify-items: start;
      gap: var(--space-5);
      inline-size: min(calc(100% - 2 * var(--layout-page-mobile)), 34rem);
      margin: var(--space-12) auto;
      padding: var(--space-8);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-xl);
      background: var(--color-surface);
      box-shadow: var(--shadow-card);
    }
    .wordmark {
      color: var(--color-accent);
      font-size: 1.5rem;
      font-weight: 700;
      letter-spacing: -0.08em;
      line-height: 1;
    }
    @media (width >= 40rem) {
      .content { padding-inline: var(--layout-page-compact); }
      .heading {
        font-size: 2.25rem;
        line-height: 1.17;
      }
      .itemLink, .skeletonRow {
        grid-template-columns: 7rem minmax(0, 1fr);
        min-block-size: 12.5rem;
        padding: var(--space-4);
      }
      .itemTitle { font-size: 1.25rem; }
    }
    @media (width >= 64rem) {
      .content { padding: var(--space-10) var(--layout-page-wide) var(--space-16); }
    }
  }
</style>
