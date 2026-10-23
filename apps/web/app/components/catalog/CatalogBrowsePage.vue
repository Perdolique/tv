<template>
  <AppShell active-destination="catalog" @signed-out="focusHeading" @session-restored="focusHeading">
    <main :class="$style.component">
      <NuxtLink :class="$style.back" to="/">Back to catalog</NuxtLink>
      <h1 ref="heading" :class="$style.heading" tabindex="-1">{{ headingText }}</h1>
      <p v-if="description" :class="$style.description">{{ description }}</p>
      <div v-if="showError" :class="$style.message">
        <AppMessage role="alert" tone="danger">{{ errorMessage }}</AppMessage>
        <AppButton size="small" variant="secondary" :disabled="busy" @click="retry">Try again</AppButton>
      </div>
      <p v-if="isInitialLoading" role="status">Loading titles…</p>
      <p v-else-if="isNotFound">This collection could not be found.</p>
      <template v-else-if="data">
        <CatalogCardList ref="cardList" :items="items" :label="headingText" presentation="grid" />
        <p v-if="isEmpty" :class="$style.description">No titles in this collection yet.</p>
        <AppButton v-if="hasMore" :class="$style.more" size="small" variant="secondary" :aria-disabled="busy" :aria-busy="busy" @click="loadMore">Load more</AppButton>
        <p :class="$style.status" role="status">{{ announcement }}</p>
      </template>
    </main>
  </AppShell>
</template>

<script setup lang="ts">
  import { useHead, useRequestFetch, useRequestEvent } from '#app'
  import { setResponseStatus } from 'h3'
  import { computed, nextTick, onScopeDispose, ref, shallowRef, useTemplateRef, watch } from 'vue'
  import * as v from 'valibot'

  import {
    collectionPageSchema,
    discoveryPageSchema,
    type CatalogDiscoveryItem,
    type CatalogDiscoveryKind
  } from '@tv/shared/catalog-discovery'

  import { useAuthSession } from '~/composables/use-auth-session.ts'
  import { useCatalogRead } from '~/composables/use-catalog-read.ts'
  import { useRecoveryFocus } from '~/composables/use-recovery-focus.ts'
  import AppShell from '~/components/app/AppShell.vue'
  import CatalogCardList from '~/components/catalog/CatalogCardList.vue'
  import AppButton from '~/components/ui/AppButton.vue'
  import AppMessage from '~/components/ui/AppMessage.vue'

  interface Props {
    collectionId?: string;
    kind?: CatalogDiscoveryKind;
  }

  const { collectionId, kind } = defineProps<Props>()
  const requestEvent = useRequestEvent()
  const { restoreSession } = useAuthSession()
  const sessionReady = restoreSession()
  const endpoint = collectionId === undefined ? `/api/catalog/discovery/${kind}` : `/api/catalog/collections/${collectionId}`
  const schema = collectionId === undefined ? discoveryPageSchema : collectionPageSchema
  const key = `browse:${endpoint}`
  const { data, ready, hasError, isNotFound, isLoading } = useCatalogRead(key, endpoint, { schema })
  const { capture } = useRecoveryFocus()
  const requestFetch = useRequestFetch()
  const heading = useTemplateRef('heading')
  const cardList = useTemplateRef('cardList')
  const items = ref<CatalogDiscoveryItem[]>([])
  const nextPage = shallowRef<number | null>(null)
  const isLoadingMore = shallowRef(false)
  const pageError = shallowRef('')
  let controller: AbortController | null = null
  let generation = 0
  const collection = computed(() => data.value && 'collection' in data.value ? data.value.collection : undefined)

  const headingText = computed(() => {
    if (isNotFound.value) { return 'Collection not found' }

    if (collection.value) { return collection.value.title }

    if (kind === 'recent') { return 'Recently added' }

    return kind === 'top-rated' ? 'Top rated on TV' : 'Collection'
  })

  const description = computed(() => {
    if (collection.value) { return collection.value.description ?? '' }

    if (kind === 'recent') { return 'New to the TV catalog, most recent first.' }

    return kind === 'top-rated' ? 'Highest average scores from at least one viewer vote.' : ''
  })

  const isInitialLoading = computed(() => isLoading.value && data.value === undefined)
  const isEmpty = computed(() => items.value.length === 0)
  const busy = computed(() => isLoading.value || isLoadingMore.value)
  const hasMore = computed(() => nextPage.value !== null)
  const errorMessage = computed(() => pageError.value || 'We couldn’t load this collection. Try again.')
  const showError = computed(() => hasError.value || pageError.value !== '')
  const announcement = computed(() => isLoadingMore.value ? 'Loading more titles…' : `${items.value.length} titles shown.`)
  const pageTitle = computed(() => `${headingText.value} · TV`)

  useHead(() => { return { title: pageTitle.value } })

  watch(data, (value) => {
    if (value === undefined) {
      items.value = []
      nextPage.value = null

      return
    }

    items.value = value.items
    nextPage.value = value.nextPage
  }, {
    immediate: true,
    flush: 'sync'
  })

  async function loadMore(event: MouseEvent): Promise<void> {
    if (nextPage.value === null || busy.value) { return }

    const trigger = event.currentTarget
    const requestGeneration = generation

    controller = new globalThis.AbortController()

    const active = controller

    isLoadingMore.value = true
    pageError.value = ''

    try {
      const response = await requestFetch(endpoint, {
        query: { page: nextPage.value },
        retry: 0,
        signal: active.signal
      })

      const parsed = v.parse(schema, response)

      if (requestGeneration !== generation) { return }

      const hasChangedRevision = 'collection' in parsed && parsed.collection.revision !== collection.value?.revision

      if (hasChangedRevision) {
        pageError.value = 'This collection changed. Reload it to see the new order.'

        return
      }

      const knownIds = items.value.map(item => item.id)
      const known = new Set(knownIds)
      const additions = parsed.items.filter(item => !known.has(item.id))
      const shouldFocusNewTitle = trigger === globalThis.document.activeElement
      const [firstAddition] = additions

      items.value.push(...additions)

      nextPage.value = parsed.nextPage

      if (shouldFocusNewTitle && firstAddition !== undefined) {
        await nextTick()
        cardList.value?.focusItem(firstAddition.id)
      }
    } catch {
      if (!active.signal.aborted) { pageError.value = 'We couldn’t load more titles. Try again.' }
    } finally {
      if (requestGeneration === generation) { isLoadingMore.value = false }
    }
  }

  async function focusHeading(): Promise<void> {
    await nextTick()
    heading.value?.focus()
  }

  async function retry(event: MouseEvent): Promise<void> {
    if (busy.value) { return }

    const restoreFocus = capture(event)

    generation += 1

    controller?.abort()

    isLoadingMore.value = false
    pageError.value = ''

    await ready.execute()

    if (!hasError.value) { await restoreFocus(() => heading.value) }
  }

  onScopeDispose(() => {
    generation += 1

    controller?.abort()
  })

  await ready

  if (import.meta.server) { await sessionReady }

  if (requestEvent !== undefined && isNotFound.value) { setResponseStatus(requestEvent, 404) }
</script>

<style module>
  @layer reset, vendor, tokens, base, components, utilities;

  @layer components {
    .component { display: grid; gap: var(--space-6); padding: var(--space-8) var(--layout-page-mobile); }
    .heading { font-size: 2rem; font-weight: 600; }
    .description { color: var(--color-text-secondary); white-space: pre-line; }
    .back { justify-self: start; }
    .message { display: grid; justify-items: start; gap: var(--space-3); }
    .more { justify-self: start; }
    .status { color: var(--color-text-secondary); font-size: 0.875rem; }
    @media (width >= 40rem) { .component { padding-inline: var(--layout-page-compact); } }
    @media (width >= 64rem) { .component { padding-inline: var(--layout-page-wide); } }
  }
</style>
