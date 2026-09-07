<template>
  <CatalogShell>
    <main :class="$style.component">
      <NuxtLink :class="$style.backLink" :to="backLocation">{{ backLabel }}</NuxtLink>
      <section v-if="isLoading" :class="$style.loading" aria-label="Loading title" aria-busy="true">
        <div :class="$style.posterSkeleton" aria-hidden="true" />
        <div :class="$style.loadingCopy"><h1 :class="$style.heading">Loading title…</h1></div>
      </section>
      <section v-else-if="isNotFound" :class="$style.message">
        <h1 ref="heading" :class="$style.heading" tabindex="-1">Title not found</h1>
        <p :class="$style.supportingText">This title isn’t in our catalog. Check the link or return to the catalog.</p>
      </section>
      <section v-else-if="hasError" :class="$style.message">
        <h1 ref="heading" :class="$style.heading" tabindex="-1">We couldn’t load this title.</h1>
        <AppMessage role="alert" tone="danger">The title is temporarily unavailable. Try again.</AppMessage>
        <AppButton ref="retryButton" @click="retry">Try again</AppButton>
      </section>
      <article v-else-if="item" :class="$style.details">
        <CatalogPoster :key="posterKey" :poster-url="item.posterUrl" :title="item.title" />
        <div :class="$style.information">
          <p :class="$style.metadata">{{ metadata }}</p>
          <h1 ref="heading" :class="$style.heading" :lang="item.titleLocale" tabindex="-1">{{ item.title }}</h1>
          <p v-if="showOriginalTitle" :class="$style.originalTitle" :lang="item.originalTitleLocale">{{ item.originalTitle }}</p>
          <section :class="$style.overview" :aria-labelledby="overviewId">
            <h2 :id="overviewId" :class="$style.subheading">Overview</h2>
            <p v-if="hasDescription" :class="$style.description" :lang="descriptionLocale">{{ item.description }}</p>
            <p v-else :class="$style.supportingText">No description available yet.</p>
          </section>
        </div>
      </article>
    </main>
  </CatalogShell>
</template>

<script lang="ts" setup>
  import { definePageMeta } from '#app/composables/pages'
  import { useHead, useNuxtApp, useRequestEvent, useResponseHeader, useRoute } from '#app'
  import { setResponseStatus } from 'h3'
  import { computed, nextTick, useId, useTemplateRef } from 'vue'
  import AppButton from '~/components/ui/AppButton.vue'
  import AppMessage from '~/components/ui/AppMessage.vue'
  import CatalogShell from '~/components/catalog/CatalogShell.vue'
  import CatalogPoster from '~/components/catalog/CatalogPoster.vue'
  import { useAuthSession } from '~/composables/use-auth-session.ts'
  import { useCatalogDetails } from '~/composables/use-catalog-details.ts'
  import { normalizeSearchQuery } from '~/utils/catalog-response.ts'

  definePageMeta({
    key: route => `${route.path}:${String(route.query.titleLocale ?? 'en')}`
  })

  const route = useRoute()
  const nuxtApp = useNuxtApp()
  const event = useRequestEvent()
  const cacheControl = useResponseHeader('Cache-Control')

  cacheControl.value = 'private, no-store'

  const id = typeof route.params.id === 'string' ? route.params.id : ''
  const titleLocale = typeof route.query.titleLocale === 'string' ? route.query.titleLocale : 'en'
  const { restoreSession } = useAuthSession()
  const shouldRevalidateSession = import.meta.client && !nuxtApp.isHydrating
  const sessionReady = restoreSession({ force: shouldRevalidateSession })
  const { hasError, isLoading, isNotFound, item, ready } = useCatalogDetails(id, titleLocale)
  const heading = useTemplateRef('heading')
  const retryButton = useTemplateRef('retryButton')
  const overviewId = useId()
  const posterKey = computed(() => item.value?.posterUrl ?? 'missing-poster')
  const searchQuery = computed(() => normalizeSearchQuery(route.query.query))
  const backLabel = computed(() => searchQuery.value === '' ? 'Back to catalog' : 'Back to results')

  const backLocation = computed(() => {
    const query = searchQuery.value === '' ? {} : { query: searchQuery.value }

    return {
      path: '/',
      query
    }
  })

  const showOriginalTitle = computed(() => item.value !== undefined && item.value.originalTitle !== item.value.title)
  const hasDescription = computed(() => item.value?.description !== null && item.value?.description !== undefined)
  const descriptionLocale = computed(() => item.value?.descriptionLocale ?? undefined)

  const metadata = computed(() => {
    if (item.value === undefined) {
      return ''
    }

    const type = item.value.type === 'movie' ? 'Movie' : 'Series'

    return item.value.releaseYear === null ? type : `${type} · ${item.value.releaseYear}`
  })

  useHead(() => {
    const title = item.value === undefined ? 'Title details · TV' : `${item.value.title} · TV`

    return { title }
  })

  await Promise.all([ready, sessionReady])

  if (event !== undefined) {
    let status = 200

    if (isNotFound.value) {
      status = 404
    } else if (hasError.value) {
      status = 503
    }

    setResponseStatus(event, status)
  }

  async function retry(): Promise<void> {
    await ready.execute({ dedupe: 'cancel' })
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
    .component {
      max-inline-size: 76rem;
      margin-inline: auto;
      padding: var(--space-6) var(--layout-page-mobile) var(--space-12);
    }
    .backLink {
      display: inline-flex;
      align-items: center;
      min-block-size: 2.75rem;
      margin-block-end: var(--space-6);
      color: var(--color-text-secondary);
      text-underline-offset: 0.25em;
    }
    .details, .loading {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: var(--space-8);
      > :first-child { max-inline-size: 16rem; }
    }
    .information { padding-block: var(--space-2); }
    .heading {
      margin-block: var(--space-2) var(--space-3);
      font-size: 1.75rem;
      font-weight: 600;
      line-height: 1.15;
    }
    .metadata, .originalTitle, .supportingText { color: var(--color-text-secondary); }
    .metadata { font-size: 0.875rem; }
    .overview {
      margin-block-start: var(--space-8);
      padding-block-start: var(--space-6);
      border-block-start: 1px solid var(--color-border);
    }
    .subheading {
      margin-block-end: var(--space-4);
      font-size: 1.375rem;
      font-weight: 600;
    }
    .description { max-inline-size: 65ch; line-height: 1.65; }
    .message { display: grid; justify-items: start; gap: var(--space-4); }
    .posterSkeleton { inline-size: 100%; aspect-ratio: 2 / 3; border-radius: var(--radius-lg); background: var(--color-surface-muted); }
    .loadingCopy { color: var(--color-text-secondary); }
    @media (width >= 40rem) {
      .component { padding-inline: var(--layout-page-compact); }
      .details, .loading { grid-template-columns: minmax(10rem, 14rem) minmax(0, 1fr); }
      .heading { font-size: 2.25rem; line-height: 1.17; }
    }
    @media (width >= 64rem) {
      .component { padding: var(--space-8) var(--layout-page-wide) var(--space-16); }
      .details, .loading { grid-template-columns: 17rem minmax(0, 1fr); gap: var(--space-10); > :first-child { max-inline-size: none; } }
    }
  }
</style>
