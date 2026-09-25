<template>
  <ImportPageShell title="Import history" description="Imports from all catalog operators, with their results and source records.">
    <p :class="$style.announcement" aria-live="polite" role="status">{{ announcement }}</p>
    <AppMessage v-if="loadError" role="alert" tone="danger">{{ loadError }}</AppMessage>
    <AppButton v-if="showRetry" :disabled="loading" variant="secondary" @click="loadPage(null)">Try again</AppButton>
    <section v-if="isInitialLoading" :class="$style.loading" aria-label="Loading import history" aria-busy="true"><span /><span /><span /></section>
    <section v-else-if="isEmpty" :class="$style.empty">
      <Icon :class="$style.emptyIcon" aria-hidden="true" mode="svg" name="hugeicons:clock-01" />
      <h2>No imports yet</h2>
      <p>Once an operator confirms a preview, its outcome appears here.</p>
      <NuxtLink :class="$style.link" to="/manage/imports">Find a title</NuxtLink>
    </section>
    <ol v-if="hasItems" :class="$style.component" aria-label="Import operations">
      <li v-for="item in items" :key="item.id" :class="$style.row">
        <span :class="$style.typeIcon" aria-hidden="true"><Icon mode="svg" :name="typeIcon(item)" /></span>
        <div :class="$style.information">
          <div :class="$style.headingRow"><h2 :class="$style.title">{{ item.title }}</h2><span :class="$style.status" :data-status="item.status"><Icon aria-hidden="true" mode="svg" :name="statusIcon(item)" />{{ statusLabel(item) }}</span></div>
          <p :class="$style.meta">{{ operationMetadata(item) }}</p>
          <p v-if="item.issue" :class="$style.issue">{{ item.issue.message }}</p>
          <p v-if="item.result" :class="$style.meta">{{ resultSummary(item.result) }}</p>
          <div :class="$style.actions">
            <NuxtLink v-if="item.result" :class="$style.link" :to="catalogLocation(item.result)">Open catalog card <Icon aria-hidden="true" mode="svg" name="hugeicons:arrow-up-right-01" /></NuxtLink>
            <NuxtLink v-if="isOwnOperation(item)" :class="$style.previewLink" :to="previewLocation(item)">View preview</NuxtLink>
            <NuxtLink v-if="item.canRetry" :class="$style.link" :to="retryLocation(item)">Review and retry</NuxtLink>
            <AppButton v-if="isPending(item)" :class="$style.refresh" :disabled="isRefreshing(item)" variant="secondary" @click="refreshItem(item.id)">Refresh status</AppButton>
          </div>
        </div>
        <div :class="$style.actor"><p>{{ item.actor }}</p><time :datetime="item.startedAt">{{ displayDate(item.startedAt) }}</time></div>
      </li>
    </ol>
    <AppButton v-if="nextCursor" :disabled="loading" variant="secondary" @click="loadPage(nextCursor)">{{ loadMoreLabel }}</AppButton>
  </ImportPageShell>
</template>

<script lang="ts" setup>
  import { Icon } from '#components'
  import { definePageMeta } from '#app/composables/pages'
  import { navigateTo, useHead, useRequestFetch, useResponseHeader } from '#app'
  import type { ImportOperationView } from '@tv/shared/catalog-import'
  import { computed, ref, watch } from 'vue'
  import * as v from 'valibot'
  import ImportPageShell from '~/components/import/ImportPageShell.vue'
  import AppButton from '~/components/ui/AppButton.vue'
  import AppMessage from '~/components/ui/AppMessage.vue'
  import { useCatalogImportAccess } from '~/composables/use-catalog-import-access.ts'
  import { importRequestMessage, importRequestStatus } from '~/utils/catalog-import-error.ts'
  import { importHistoryResponseSchema, importOperationResponseSchema } from '~/utils/catalog-import-response.ts'

  definePageMeta({ middleware: ['authenticated', 'catalog-import'] })
  useHead({ title: 'Import history · TV' })

  useResponseHeader('Cache-Control').value = 'private, no-store'

  const requestFetch = useRequestFetch()
  const { accountId, canManage, deny, unauthorize } = useCatalogImportAccess()
  const items = ref<ImportOperationView[]>([])
  const nextCursor = ref<string | null>(null)
  const loading = ref(false)
  const refreshing = ref<string | null>(null)
  const loadError = ref('')
  const announcement = ref('')
  const hasItems = computed(() => items.value.length > 0)
  const showRetry = computed(() => loadError.value !== '' && !hasItems.value)
  const isInitialLoading = computed(() => loading.value && !hasItems.value)
  const isEmpty = computed(() => !loadError.value && !hasItems.value)
  const loadMoreLabel = computed(() => loading.value ? 'Loading…' : 'Load older imports')

  function displayDate(value: string): string {
    const formatter = new Intl.DateTimeFormat('en', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC'
    })

    const date = new Date(value)
    const formatted = formatter.format(date)
    const timestamp = `${formatted} UTC`

    return timestamp
  }

  function typeIcon(item: ImportOperationView): string {
    const icon = item.selection.type === 'movie' ? 'hugeicons:film-01' : 'hugeicons:tv-01'

    return icon
  }

  function statusIcon(item: ImportOperationView): string {
    return {
      succeeded: 'hugeicons:tick-02',
      failed: 'hugeicons:alert-circle',
      pending: 'hugeicons:clock-01'
    }[item.status]
  }

  function statusLabel(item: ImportOperationView): string {
    return {
      succeeded: 'Complete',
      failed: 'Failed',
      pending: 'Pending'
    }[item.status]
  }

  function operationMetadata(item: ImportOperationView): string {
    const type = item.selection.type === 'movie' ? 'Movie' : 'Series'
    const source = `${type} · TMDB #${item.selection.tmdbId}`

    return item.selection.type === 'series' && item.selection.tvmaze.status === 'selected'
      ? `${source} · TVMaze #${item.selection.tvmaze.id}`
      : source
  }

  function resultSummary(result: NonNullable<ImportOperationView['result']>): string {
    const action = result.createdItem ? 'Created' : 'Updated'
    const episodes = result.createdEpisodes === 1 ? 'episode' : 'episodes'
    const fields = result.changedFields === 1 ? 'field' : 'fields'
    const formatted = `${action} catalog card · ${result.createdEpisodes} new ${episodes} · ${result.changedFields} changed ${fields}.`

    return formatted
  }

  function catalogLocation(result: NonNullable<ImportOperationView['result']>): string {
    const formatted = `/titles/${result.catalogItemId}`

    return formatted
  }

  function previewLocation(item: ImportOperationView): string {
    const formatted = `/manage/imports/previews/${item.previewId}`

    return formatted
  }

  function retryLocation(item: ImportOperationView): string {
    const formatted = `/manage/imports/previews/${item.previewId}?retry=1`

    return formatted
  }

  function isOwnOperation(item: ImportOperationView): boolean {
    return item.operatorId === accountId.value
  }

  function isPending(item: ImportOperationView): boolean {
    return item.status === 'pending'
  }

  function isRefreshing(item: ImportOperationView): boolean {
    return refreshing.value === item.id
  }

  function handleFailure(failure: unknown, fallback: string): string {
    const status = importRequestStatus(failure)

    if (status === 401) {
      unauthorize()

      void navigateTo('/sign-in')

      return ''
    }

    if (status === 403) {
      deny()

      return ''
    }

    return importRequestMessage(failure, fallback)
  }

  async function loadPage(cursor: string | null): Promise<void> {
    if (!canManage.value || loading.value) {return}

    loading.value = true
    loadError.value = ''

    try {
      const query = cursor === null ? undefined : { cursor }

      const body = await requestFetch('/api/catalog/imports/operations', {
        query,
        retry: 0
      })

      if (!canManage.value) {return}

      const page = v.parse(importHistoryResponseSchema, body)

      items.value = cursor === null ? page.items : [...items.value, ...page.items]
      nextCursor.value = page.nextCursor
      announcement.value = `${page.items.length} import${page.items.length === 1 ? '' : 's'} loaded.`
    } catch (error) {
      loadError.value = handleFailure(error, 'We couldn’t load import history. Try again.')
    } finally {
      loading.value = false
    }
  }

  async function refreshItem(id: string): Promise<void> {
    if (!canManage.value || refreshing.value !== null) {return}

    refreshing.value = id
    loadError.value = ''

    try {
      const operationUrl = `/api/catalog/imports/operations/${id}`
      const body = await requestFetch(operationUrl, { retry: 0 })

      if (!canManage.value) {return}

      const response = v.parse(importOperationResponseSchema, body)
      const updated = response.operation

      items.value = items.value.map(item => item.id === id ? updated : item)
      announcement.value = `${updated.title}: ${updated.status}.`
    } catch (error) {
      loadError.value = handleFailure(error, 'We couldn’t refresh this import. Try again.')
    } finally {
      refreshing.value = null
    }
  }

  watch(canManage, (allowed) => {
    if (allowed && items.value.length === 0 && !loading.value) {
      void loadPage(null)
    } else if (!allowed) {
      items.value = []
      nextCursor.value = null
    }
  })

  if (canManage.value) { await loadPage(null) }
</script>

<style module>
  @layer reset, vendor, tokens, base, components, utilities;
  @layer components {
    .announcement { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    .component { padding: 0; margin-block-end: var(--space-6); border-block-start: 1px solid var(--color-border); list-style: none; }
    .row { display: grid; grid-template-columns: 2.75rem minmax(0, 1fr); column-gap: var(--space-3); row-gap: var(--space-2); padding-block: var(--space-5); border-block-end: 1px solid var(--color-border); }
    .typeIcon { display: grid; place-items: center; inline-size: 2.75rem; block-size: 2.75rem; border-radius: var(--radius-sm); background: var(--color-surface-muted); color: var(--color-text-secondary); }
    .typeIcon :global(svg) { inline-size: 1.5rem; block-size: 1.5rem; }
    .information { display: grid; gap: var(--space-2); min-inline-size: 0; }
    .headingRow { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-3); }
    .title { font-size: 1.125rem; font-weight: 600; }
    .meta { color: var(--color-text-secondary); font-size: .875rem; }
    .status { display: inline-flex; align-items: center; gap: var(--space-1); color: var(--color-text-secondary); font-size: .75rem; font-weight: 600; }
    .status :global(svg) { inline-size: 1rem; block-size: 1rem; }
    .status[data-status='succeeded'] { color: var(--color-text-primary); }
    .status[data-status='succeeded'] :global(svg) { color: var(--color-accent); }
    .status[data-status='failed'], .issue { color: var(--color-danger); }
    .issue { font-size: .875rem; }
    .actor { grid-column: 2; color: var(--color-text-secondary); font-size: .75rem; }
    .actor time { display: block; margin-block-start: var(--space-1); font-variant-numeric: tabular-nums; }
    .actions { display: flex; align-items: center; flex-wrap: wrap; column-gap: var(--space-5); row-gap: var(--space-1); }
    .link, .previewLink { color: var(--color-text-primary); display: inline-flex; align-items: center; gap: var(--space-1); min-block-size: 2.75rem; font-size: .875rem; font-weight: 600; text-underline-offset: .2em; }
    .link :global(svg) { inline-size: 1rem; block-size: 1rem; }
    .previewLink { color: var(--color-text-secondary); }
    .refresh { min-block-size: 2.75rem; padding: var(--space-2) var(--space-3); font-size: .875rem; font-weight: 600; }
    .empty { display: grid; justify-items: start; gap: var(--space-3); max-inline-size: 36rem; padding-block: var(--space-8); }
    .empty h2 { font-size: 1.375rem; font-weight: 600; }
    .empty p { color: var(--color-text-secondary); }
    .emptyIcon { inline-size: 2rem; block-size: 2rem; color: var(--color-text-secondary); }
    .loading { display: grid; gap: var(--space-4); }
    .loading span { block-size: 8rem; border-radius: var(--radius-md); background: var(--color-surface-muted); }
    @media (width >= 64rem) { .row { grid-template-columns: 2.75rem minmax(0, 1fr) 13rem; column-gap: var(--space-4); } .actor { grid-column: 3; padding-block-start: var(--space-1); text-align: end; } }
  }
</style>
