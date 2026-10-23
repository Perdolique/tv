<template>
  <AppShell active-destination="catalog" @signed-out="focusHeading" @session-restored="focusHeading">
    <main :class="$style.component">
      <h1 ref="heading" :class="$style.heading" tabindex="-1">Your catalog starts here.</h1>
      <p :class="$style.supportingText">Find your next movie or series.</p>
      <CatalogSearchField :model-value="input" @update:model-value="changeInput" @submit="submitSearch" @clear="clear" />
      <CatalogDiscovery v-if="showDiscovery" :data="discovery" :has-error="hasDiscoveryError" :is-loading="isDiscoveryLoading" :reload="discoveryReady.execute" />
      <CatalogResults v-else ref="catalogResults" :failure="failure" :is-loading="isLoading" :items="lastResult?.items" :result-query="lastResult?.query" @retry="retrySearch" />
    </main>
  </AppShell>
</template>

<script lang="ts" setup>
  import { useHead, useResponseHeader } from '#app'
  import { definePageMeta } from '#app/composables/pages'
  import { computed, nextTick, onMounted, useTemplateRef, watch } from 'vue'
  import { discoveryResponseSchema } from '@tv/shared/catalog-discovery'
  import AppShell from '~/components/app/AppShell.vue'
  import CatalogSearchField from '~/components/catalog/CatalogSearchField.vue'
  import CatalogDiscovery from '~/components/catalog/CatalogDiscovery.vue'
  import CatalogResults from '~/components/catalog/CatalogResults.vue'
  import { useCatalogSearch } from '~/composables/use-catalog-search.ts'
  import { useAuthSession } from '~/composables/use-auth-session.ts'
  import { useCatalogRead } from '~/composables/use-catalog-read.ts'

  definePageMeta({ middleware: 'public-session' })

  useResponseHeader('Cache-Control').value = 'private, no-store'

  useHead({ title: 'Catalog · TV' })

  const heading = useTemplateRef('heading')
  const catalogResults = useTemplateRef('catalogResults')
  const { restoreSession } = useAuthSession()
  const sessionReady = restoreSession()
  const { changeInput, clear, failure, input, isLoading, lastResult, ready, search } = useCatalogSearch()

  const showDiscovery = computed(() => {
    const query = input.value.trim()

    return query === ''
  })

  const {
    data: discovery,
    ready: discoveryReady,
    hasError: hasDiscoveryError,
    isLoading: isDiscoveryLoading
  } = useCatalogRead('catalog-discovery', '/api/catalog/discovery', {
    schema: discoveryResponseSchema,
    immediate: showDiscovery.value
  })

  watch(showDiscovery, (visible) => {
    if (visible && discoveryReady.status.value === 'idle') { void discoveryReady.execute() }
  })

  onMounted(() => {
    if (globalThis.location.hash.startsWith('#token=')) {
      const location = `${globalThis.location.pathname}${globalThis.location.search}`

      globalThis.history.replaceState(globalThis.history.state, '', location)
    }
  })

  function submitSearch(): void {
    const shouldRetry = failure.value !== ''

    void search(shouldRetry)
  }

  async function retrySearch(): Promise<void> {
    await search(true)

    if (isLoading.value) {
      const settled = Promise.withResolvers<boolean>()

      const stop = watch(isLoading, (loading) => {
        if (!loading) {
          stop()
          settled.resolve(true)
        }
      }, { flush: 'sync' })

      await settled.promise
    }

    await nextTick()
    catalogResults.value?.focusAfterRetry()
  }

  async function focusHeading(): Promise<void> {
    await nextTick()
    heading.value?.focus()
  }

  await ready
  await discoveryReady

  if (import.meta.server) { await sessionReady }
</script>

<style module>
  @layer reset, vendor, tokens, base, components, utilities;

  @layer components {
    .component { display: grid; gap: var(--space-6); padding: var(--space-8) var(--layout-page-mobile); }
    .heading { font-size: 1.75rem; line-height: 1.15; font-weight: 600; }
    .supportingText { color: var(--color-text-secondary); }
    @media (width >= 40rem) {
      .component { padding-inline: var(--layout-page-compact); }
      .heading { font-size: 2.25rem; }
    }
    @media (width >= 64rem) { .component { padding: var(--space-10) var(--layout-page-wide); } }
  }
</style>
