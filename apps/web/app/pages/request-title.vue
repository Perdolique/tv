<template>
  <AppShell @signed-out="navigateTo('/')">
    <main :class="$style.component">
      <header :class="$style.header"><h1>Request a title</h1><NuxtLink to="/requests">Your requests</NuxtLink></header>
      <p>Search TV first. Request only when missing.</p>
      <ol :class="$style.steps" aria-label="Request progress"><li :aria-current="searchCurrent">1 Search</li><li :aria-current="reviewCurrent">2 Review</li><li :aria-current="submitCurrent">3 Submit</li></ol>
      <AppMessage v-if="!accountId" role="alert">Your account is unavailable. Sign in again to request a title.</AppMessage>
      <template v-else>
        <form :class="$style.form" @submit.prevent="searchCatalog">
          <fieldset :class="$style.types"><legend>Title type</legend><label><input v-model="type" type="radio" name="type" value="movie"> Movie</label><label><input v-model="type" type="radio" name="type" value="series"> Series</label></fieldset>
          <label :class="$style.field">Title name<input v-model.trim="query" type="search" required minlength="2" maxlength="100" autocomplete="off"></label>
          <AppButton :disabled="busy" type="submit">Search TV</AppButton>
        </form>
        <AppMessage v-if="errorMessage" role="alert" tone="danger">{{ errorMessage }}</AppMessage>
        <p v-if="busy" role="status">Working…</p>
        <section v-if="searched" :class="$style.section" aria-label="TV search results">
          <h2>In TV</h2><p v-if="catalogEmpty">No matching titles in TV.</p>
          <ul><li v-for="item in catalog" :key="item.id"><NuxtLink :to="item.location">{{ item.label }}</NuxtLink></li></ul>
          <AppButton :disabled="busy" variant="secondary" @click="searchSource(1)">Search TMDB for a missing title</AppButton>
        </section>
        <section v-if="sourceSearched" :class="$style.section" aria-label="TMDB search results">
          <h2>From TMDB</h2><p v-if="sourceEmpty">No matching titles. Try another name or title type.</p>
          <ul :class="$style.results">
            <li v-for="item in sourceRows" :key="item.id" :class="$style.result">
              <CatalogPoster :class="$style.resultPoster" :poster-url="item.posterUrl" :title="item.title" compact loading="lazy" />
              <div :class="$style.resultInformation"><h3>{{ item.title }}</h3><p>{{ item.yearLabel }}</p></div>
              <AppButton :class="$style.resultAction" :disabled="busy" size="small" variant="secondary" @click="select(item.id, $event)">Review {{ item.title }}</AppButton>
            </li>
          </ul>
          <AppButton v-if="nextPage" :disabled="busy" variant="secondary" @click="searchSource(nextPage)">Load more</AppButton>
        </section>
        <section v-if="preview" ref="review" :class="$style.section" tabindex="-1" aria-label="Review title request">
          <h2>Review your request</h2>
          <RequestCard :card="preview.card">
            <NuxtLink v-if="existingLocation" :to="existingLocation">Open title in TV</NuxtLink>
            <template v-else-if="submitted"><p role="status">Request submitted. {{ submittedStatus }}</p><NuxtLink to="/requests">View your requests</NuxtLink></template>
            <AppButton v-else :disabled="busy" @click="submit">Submit request</AppButton>
          </RequestCard>
          <template v-if="hasSimilar"><h3>Similar titles in TV</h3><p>These may be different titles. You can still submit your request.</p><ul><li v-for="item in similar" :key="item.id"><NuxtLink :to="item.location">{{ item.label }}</NuxtLink></li></ul></template>
        </section>
        <p :class="$style.attribution"><img src="/tmdb-logo.svg" alt="TMDB" width="80" height="20"> This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
      </template>
    </main>
  </AppShell>
</template>
<script setup lang="ts">
  import { useHead, useRequestFetch, useResponseHeader, useRoute, navigateTo } from '#app'
  import { definePageMeta } from '#app/composables/pages'
  import { ref, shallowRef, toRef, useTemplateRef, watch } from 'vue'
  import * as v from 'valibot'
  import { titleRequestPreviewSchema, titleRequestSchema, type TitleRequestPreview } from '@tv/shared/catalog-requests'
  import type { ImportSearchItem } from '@tv/shared/catalog-import'
  import { catalogSearchResponseSchema } from '~/utils/catalog-response.ts'
  import { importSearchResponseSchema } from '~/utils/catalog-import-response.ts'
  import AppShell from '~/components/app/AppShell.vue'
  import CatalogPoster from '~/components/catalog/CatalogPoster.vue'
  import AppButton from '~/components/ui/AppButton.vue'
  import AppMessage from '~/components/ui/AppMessage.vue'
  import RequestCard from '~/components/requests/RequestCard.vue'
  import { useAuthSession } from '~/composables/use-auth-session.ts'
  import { useRequestCancellation } from '~/composables/use-request-cancellation.ts'
  import { useRecoveryFocus } from '~/composables/use-recovery-focus.ts'

  interface CatalogRow {
    id: string;
    label: string;
    location: string;
  }

  definePageMeta({ middleware: ['authenticated'] })
  useHead({ title: 'Request a title · TV' })

  const cacheControlHeader = useResponseHeader('Cache-Control')

  cacheControlHeader.value = 'private, no-store'

  const route = useRoute()
  const requestFetch = useRequestFetch()
  const { state, setAnonymous } = useAuthSession()
  const { capture } = useRecoveryFocus()
  const cancellation = useRequestCancellation()
  const initialQuery = typeof route.query.query === 'string' ? route.query.query.slice(0, 100) : ''
  const type = shallowRef<'movie' | 'series'>('movie')
  const query = shallowRef(initialQuery)
  const searched = shallowRef(false)
  const sourceSearched = shallowRef(false)
  const catalog = ref<CatalogRow[]>([])
  const sourceItems = ref<ImportSearchItem[]>([])
  const nextPage = shallowRef<number | null>(null)
  const preview = ref<TitleRequestPreview | null>(null)
  const submitted = shallowRef(false)
  const submittedStatus = shallowRef('Pending')
  const busy = shallowRef(false)
  const errorMessage = shallowRef('')
  const review = useTemplateRef('review')
  const accountId = toRef(() => state.value.status === 'authenticated' ? state.value.user.id : null)
  const catalogEmpty = toRef(() => catalog.value.length === 0)
  const sourceEmpty = toRef(() => sourceItems.value.length === 0)
  const existingLocation = toRef(() => preview.value?.catalogItemId ? `/titles/${preview.value.catalogItemId}` : null)

  const sourceRows = toRef(() => sourceItems.value.map(item => {
    const yearLabel = item.year === null ? 'Year unknown' : String(item.year)

    return {
      id: item.id,
      title: item.title,
      posterUrl: item.posterUrl,
      yearLabel
    }
  }))

  const similar = toRef(() => preview.value?.similar.map(item => {
    const label = `${item.title} · ${item.year ?? 'Year unknown'}`
    const location = `/titles/${item.id}`

    return {
      id: item.id,
      label,
      location
    }
  }) ?? [])

  const hasSimilar = toRef(() => similar.value.length > 0)
  const searchCurrent = toRef(() => !submitted.value && preview.value === null ? 'step' : undefined)
  const reviewCurrent = toRef(() => !submitted.value && preview.value !== null ? 'step' : undefined)
  const submitCurrent = toRef(() => submitted.value ? 'step' : undefined)

  const submitSchema = v.object({
    request: v.nullable(titleRequestSchema),
    catalogItemId: v.nullable(v.string())
  })

  function reset(): void {
    cancellation.cancel()

    busy.value = false
    errorMessage.value = ''
    searched.value = false
    sourceSearched.value = false
    catalog.value = []
    sourceItems.value = []
    nextPage.value = null
    preview.value = null
    submitted.value = false
  }
  async function perform(operation: (signal: AbortSignal) => Promise<void>): Promise<void> {
    if (accountId.value === null) { return }

    const controller = cancellation.start()

    busy.value = true
    errorMessage.value = ''

    try { await operation(controller.signal) }
    catch (error) {
      if (cancellation.isCurrent(controller)) {
        errorMessage.value = 'We couldn’t complete this request. Try the action again. Your selection is still here.'

        const response = v.safeParse(v.object({
          statusCode: v.optional(v.number()),
          status: v.optional(v.number())
        }), error)

        const status = response.success ? response.output.statusCode ?? response.output.status : null

        if (status === 429) { errorMessage.value = 'Too many requests. Wait a minute, then try again.' }

        if (status === 401) { setAnonymous() }
      }
    } finally { if (cancellation.finish(controller)) { busy.value = false } }
  }
  async function searchCatalog(): Promise<void> {
    await perform(async signal => {
      const raw = await requestFetch('/api/catalog/search', {
        query: { query: query.value },
        signal,
        retry: 0
      })

      const response = v.parse(catalogSearchResponseSchema, raw)

      if (signal.aborted) { return }

      const matchingItems = response.items.filter(item => item.type === type.value)

      catalog.value = matchingItems.map(item => {
        const label = `${item.title} · ${item.releaseYear ?? 'Year unknown'}`
        const location = `/titles/${item.id}`

        return {
          id: item.id,
          label,
          location
        }
      })
      searched.value = true
    })
  }
  async function searchSource(page: number): Promise<void> {
    if (!searched.value) { return }

    await perform(async signal => {
      const raw = await requestFetch('/api/catalog/requests/search', {
        query: {
          type: type.value,
          query: query.value,
          page
        },

        signal,
        retry: 0
      })

      const response = v.parse(importSearchResponseSchema, raw)

      if (signal.aborted) { return }

      sourceItems.value = page === 1 ? response.items : [...sourceItems.value, ...response.items]
      sourceSearched.value = true
      nextPage.value = response.nextPage
    })
  }
  async function select(tmdbId: number, event: Event): Promise<void> {
    const restoreFocus = capture(event)

    preview.value = null
    submitted.value = false

    await perform(async signal => {
      const raw = await requestFetch('/api/catalog/requests/preview', {
        query: {
          type: type.value,
          tmdbId
        },

        signal,
        retry: 0
      })

      const response = v.parse(titleRequestPreviewSchema, raw)

      if (signal.aborted) { return }

      preview.value = response

      await restoreFocus(() => {
        if (signal.aborted) { return }

        return review.value
      })
    })
  }
  async function submit(event: Event): Promise<void> {
    const selection = preview.value

    if (selection === null) { return }

    const restoreFocus = capture(event)

    await perform(async signal => {
      const raw = await requestFetch('/api/catalog/requests', {
        method: 'POST',

        body: {
          type: selection.card.type,
          tmdbId: selection.card.tmdbId
        },

        signal,
        retry: 0
      })

      const response = v.parse(submitSchema, raw)

      if (signal.aborted) { return }

      if (response.catalogItemId !== null) { selection.catalogItemId = response.catalogItemId }

      submitted.value = true
      submittedStatus.value = response.request?.status === 'available' ? 'Added to catalog' : 'Pending'

      await restoreFocus(() => {
        if (signal.aborted) { return }

        const resultLink = review.value?.querySelector('a')

        return resultLink
      })
    })
  }

  watch([type, query, accountId], reset, { flush: 'sync' })
</script>
<style module>
  @layer reset, vendor, tokens, base, components, utilities;

  @layer components {
    .component { display: grid; gap: var(--space-5); max-inline-size: var(--layout-content-max); padding: var(--space-6) var(--layout-page-mobile); }
    .header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-4); }
    .header h1 { font-size: 2rem; }
    .types { inline-size: 100%; padding: var(--space-1); border: 1px solid var(--color-border); border-radius: var(--radius-round); background: var(--color-surface-muted); }
    .types legend { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip-path: inset(50%); }
    .types label { position: relative; flex: 1; display: flex; align-items: center; justify-content: center; gap: var(--space-2); padding: var(--space-3); border-radius: var(--radius-round); }
    .types label:has(:checked) { background: var(--color-accent-fill); color: var(--color-on-accent); }
    .types input { position: absolute; inline-size: 1px; block-size: 1px; opacity: 0; }
    .types label:has(:focus-visible) { outline: .1875rem solid var(--color-focus); outline-offset: .1875rem; }
    .steps [aria-current='step'] { color: var(--color-accent); font-weight: 600; }
    .steps, .types { display: flex; flex-wrap: wrap; gap: var(--space-5); }
    .steps { list-style: none; padding: 0; color: var(--color-text-secondary); }
    .form, .field, .section { display: grid; gap: var(--space-4); justify-items: start; min-inline-size: 0; }
    .form, .field { inline-size: 100%; }
    .field input { inline-size: 100%; min-block-size: 3.25rem; padding: var(--space-3); background: var(--color-surface); border: 1px solid var(--color-border-strong); border-radius: var(--radius-md); }
    .section > article { inline-size: 100%; }
    .results { display: grid; gap: var(--space-4); padding: 0; list-style: none; inline-size: 100%; }
    .result { display: grid; grid-template-columns: 4.5rem minmax(0, 1fr); gap: var(--space-3) var(--space-4); padding: var(--space-3); border: 1px solid var(--color-border); background: var(--color-surface); border-radius: var(--radius-md); box-shadow: var(--shadow-card); }
    .resultPoster { grid-column: 1; grid-row: 1 / 3; border-radius: var(--radius-sm); }
    .resultInformation { min-inline-size: 0; }
    .resultInformation h3 { font-size: 1.125rem; font-weight: 600; }
    .resultInformation p { color: var(--color-text-secondary); font-size: .875rem; }
    .resultAction { grid-column: 2; justify-self: end; }
    .attribution { display: flex; flex-wrap: wrap; gap: var(--space-3); font-size: .75rem; color: var(--color-text-secondary); }
    @media (width >= 40rem) { .component { padding: var(--space-8) var(--layout-page-compact); } .result { grid-template-columns: 5.5rem minmax(0, 1fr); gap: var(--space-3) var(--space-5); } .resultInformation h3 { font-size: 1.375rem; } }
    @media (width >= 64rem) { .component { padding-inline: var(--layout-page-wide); } .result { grid-template-columns: 7rem minmax(0, 1fr); } }
  }
</style>
