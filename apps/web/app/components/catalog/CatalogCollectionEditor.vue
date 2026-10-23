<template>
  <section :class="$style.component" aria-label="Collection editor">
    <p v-if="loading" role="status">Loading collection…</p>
    <div v-else-if="loadError" :class="$style.message">
      <AppMessage role="alert" tone="danger">{{ loadError }}</AppMessage>
      <AppButton ref="loadRetryButton" size="small" variant="secondary" @click="load">Try again</AppButton>
    </div>
    <template v-else>
      <form :class="$style.form" @submit.prevent="save">
        <label :class="$style.field">Collection name<input ref="nameInput" v-model="title" maxlength="160" required :disabled="saving"></label>
        <label :class="$style.field">Description (optional)<textarea v-model="description" maxlength="2000" rows="3" :disabled="saving" /></label>
        <label :class="$style.choice"><input v-model="isFeatured" type="checkbox" :disabled="saving"> Show on home</label>
        <section :class="$style.members" :aria-labelledby="membersHeadingId">
          <h2 :id="membersHeadingId">Titles in order</h2>
          <p v-if="empty" :class="$style.hint">Find titles below to add them to this collection.</p>
          <ol :class="$style.list">
            <li v-for="row in rows" :key="row.item.id" :class="$style.row" tabindex="-1">
              <div :class="$style.itemCopy"><strong>{{ row.item.title }}</strong><p>{{ row.metadata }}</p></div>
              <div :class="$style.actions">
                <AppButton size="small" variant="secondary" :disabled="row.upDisabled" :aria-label="row.upLabel" @click="move(row.item.id, -1, $event)">Move up</AppButton>
                <AppButton size="small" variant="secondary" :disabled="row.downDisabled" :aria-label="row.downLabel" @click="move(row.item.id, 1, $event)">Move down</AppButton>
                <AppButton size="small" variant="text" :disabled="saving" :aria-label="row.removeLabel" @click="remove(row.item.id)">Remove</AppButton>
              </div>
            </li>
          </ol>
        </section>
        <AppMessage v-if="saveError" role="alert" tone="danger">{{ saveError }}</AppMessage>
        <div :class="$style.actions">
          <AppButton size="small" type="submit" :disabled="saving">Save and publish</AppButton>
          <NuxtLink v-if="publicLocation" :to="publicLocation">View collection</NuxtLink>
          <AppButton v-if="canDelete" ref="deleteButton" size="small" variant="text" :disabled="saving" @click="requestDelete">Delete collection</AppButton>
        </div>
        <div v-if="confirmDelete" :class="$style.message">
          <p>Delete this collection? Its catalog titles will be kept.</p>
          <AppButton size="small" :disabled="saving" @click="deleteSaved">Confirm deletion</AppButton>
          <AppButton size="small" variant="secondary" :disabled="saving" @click="cancelDelete">Cancel</AppButton>
        </div>
        <p role="status" :class="$style.hint">{{ announcement }}</p>
      </form>
      <section :class="$style.search" :aria-labelledby="searchHeadingId">
        <h2 :id="searchHeadingId">Add titles</h2>
        <form :class="$style.searchForm" @submit.prevent="searchTitles">
          <label :class="$style.field">Search catalog<input v-model="query" type="search" :disabled="saving"></label>
          <AppButton size="small" type="submit" :disabled="searchDisabled">Search</AppButton>
        </form>
        <AppMessage v-if="searchError" role="alert" tone="danger">{{ searchError }}</AppMessage>
        <p v-if="noResults" :class="$style.hint">No matching titles in the catalog.</p>
        <ul :class="$style.list">
          <li v-for="row in results" :key="row.item.id" :class="$style.row">
            <div :class="$style.itemCopy"><strong>{{ row.item.title }}</strong><p>{{ row.metadata }}</p></div>
            <AppButton size="small" variant="secondary" :disabled="row.disabled" :aria-label="row.addLabel" @click="add(row.item)">{{ row.label }}</AppButton>
          </li>
        </ul>
      </section>
    </template>
  </section>
</template>

<script setup lang="ts">
  import { navigateTo, useRequestFetch } from '#app'
  import type { CatalogSearchItem } from '@tv/shared/catalog'
  import { collectionEditorSchema, collectionSchema } from '@tv/shared/catalog-discovery'
  import { isRecord } from '@tv/shared/type-guards'
  import { createSortable, type SortableTicketInput } from '@vuetify/v0'
  import { computed, nextTick, onScopeDispose, ref, shallowRef, useId, useTemplateRef, watch } from 'vue'
  import * as v from 'valibot'
  import { useCatalogRead } from '~/composables/use-catalog-read.ts'
  import { catalogSearchResponseSchema } from '~/utils/catalog-response.ts'
  import AppButton from '~/components/ui/AppButton.vue'
  import AppMessage from '~/components/ui/AppMessage.vue'

  interface ItemTicket extends SortableTicketInput<CatalogSearchItem> {
    value: CatalogSearchItem;
  }
  interface Props {
    collectionId?: string;
  }

  const { collectionId } = defineProps<Props>()
  const requestFetch = useRequestFetch()
  const title = shallowRef('')
  const description = shallowRef('')
  const isFeatured = shallowRef(false)
  const revision = shallowRef(0)
  const saving = shallowRef(false)
  const saveError = shallowRef('')
  const confirmDelete = shallowRef(false)
  const announcement = shallowRef('')
  const query = shallowRef('')
  const searching = shallowRef(false)
  const searched = shallowRef(false)
  const searchError = shallowRef('')
  const found = ref<CatalogSearchItem[]>([])
  const membersHeadingId = useId()
  const searchHeadingId = useId()
  const nameInput = useTemplateRef('nameInput')
  const deleteButton = useTemplateRef('deleteButton')
  const loadRetryButton = useTemplateRef('loadRetryButton')

  const members = createSortable<ItemTicket>({
    reactive: true,
    disabled: saving
  })

  const readKey = `collection-editor:${collectionId}`
  const readUrl = `/api/catalog/manage/collections/${collectionId}`
  const reader = collectionId === undefined ? undefined : useCatalogRead(readKey, readUrl, { schema: collectionEditorSchema })
  const saveResponseSchema = v.object({ collection: collectionSchema })
  let searchController: AbortController | null = null
  let disposed = false
  const empty = computed(() => members.size === 0)
  const noResults = computed(() => searched.value && !searching.value && !searchError.value && found.value.length === 0)
  const publicLocation = computed(() => collectionId === undefined ? null : `/collections/${collectionId}`)
  const canDelete = computed(() => collectionId !== undefined)
  const searchDisabled = computed(() => searching.value || saving.value)
  const loading = computed(() => reader?.isLoading.value ?? false)

  const loadError = computed(() => {
    if (reader?.isNotFound.value) { return 'Collection not found.' }

    if (reader?.hasError.value) { return 'We couldn’t load this collection. Check your access and try again.' }

    return ''
  })

  const rows = computed(() => {
    const tickets = members.values()
    const lastIndex = members.size - 1

    const memberRows = tickets.map(ticket => {
      const itemType = ticket.value.type === 'movie' ? 'Movie' : 'Series'
      const itemMetadata = ticket.value.releaseYear === null ? itemType : `${itemType} · ${ticket.value.releaseYear}`
      const upDisabled = saving.value || ticket.index === 0
      const downDisabled = saving.value || ticket.index === lastIndex
      const upLabel = `Move ${ticket.value.title} up`
      const downLabel = `Move ${ticket.value.title} down`
      const removeLabel = `Remove ${ticket.value.title}`

      return {
        item: ticket.value,
        metadata: itemMetadata,
        upDisabled,
        downDisabled,
        upLabel,
        downLabel,
        removeLabel
      }
    })

    return memberRows
  })

  const results = computed(() => {
    const searchRows = found.value.map(item => {
      const itemType = item.type === 'movie' ? 'Movie' : 'Series'
      const itemMetadata = item.releaseYear === null ? itemType : `${itemType} · ${item.releaseYear}`
      const added = members.has(item.id)
      const disabled = saving.value || added
      const label = added ? 'Added' : 'Add'
      const addLabel = `Add ${item.title}`

      return {
        item,
        metadata: itemMetadata,
        disabled,
        label,
        addLabel
      }
    })

    return searchRows
  })

  function applyLoaded(parsed: v.InferOutput<typeof collectionEditorSchema>): void {
    title.value = parsed.collection.title
    description.value = parsed.collection.description ?? ''
    isFeatured.value = parsed.collection.isFeatured
    revision.value = parsed.collection.revision

    members.clear()

    for (const item of parsed.items) {
      members.register({
        id: item.id,
        value: item
      })
    }
  }
  async function load(event: MouseEvent): Promise<void> {
    if (reader === undefined) { return }

    const owner = globalThis.document.activeElement
    const ownedFocus = owner === event.currentTarget

    await reader.ready.execute()

    if (disposed || !ownedFocus) { return }

    await nextTick()

    const { activeElement, body } = globalThis.document
    const shouldRestoreFocus = activeElement === owner || activeElement === body

    if (!shouldRestoreFocus) { return }

    if (loadError.value) { loadRetryButton.value?.focus() }
    else { nameInput.value?.focus() }
  }
  async function searchTitles(): Promise<void> {
    searchController?.abort()

    searchController = new globalThis.AbortController()

    const active = searchController
    const term = query.value.trim()

    if (!term) {
      found.value = []
      searched.value = false
      searching.value = false

      return
    }

    searching.value = true
    searchError.value = ''

    try {
      const response = await requestFetch('/api/catalog/search', {
        query: { query: term },
        retry: 0,
        signal: active.signal
      })

      if (active.signal.aborted) { return }

      const parsed = v.parse(catalogSearchResponseSchema, response)

      found.value = parsed.items
      searched.value = true
    } catch {
      if (!active.signal.aborted) { searchError.value = 'We couldn’t search the catalog. Try again.' }
    } finally { if (!active.signal.aborted) { searching.value = false } }
  }
  function add(item: CatalogSearchItem): void {
    if (saving.value || members.has(item.id)) { return }

    members.register({
      id: item.id,
      value: item
    })

    announcement.value = `${item.title} added.`
  }
  async function remove(id: string): Promise<void> {
    if (saving.value) { return }

    const ticket = members.get(id)

    members.unregister(id)

    announcement.value = `${ticket?.value.title ?? 'Title'} removed.`

    await nextTick()
    nameInput.value?.focus()
  }
  async function move(id: string, direction: number, event: MouseEvent): Promise<void> {
    if (saving.value) { return }

    const ticket = members.get(id)
    const trigger = event.currentTarget

    if (ticket === undefined || !(trigger instanceof globalThis.HTMLButtonElement)) { return }

    const row = trigger.closest('li')
    const owner = globalThis.document.activeElement
    const ownedFocus = owner === trigger
    const targetIndex = ticket.index + direction

    members.move(id, targetIndex)

    announcement.value = `${ticket.value.title} moved to position ${ticket.index + 1}.`

    await nextTick()

    if (disposed || !ownedFocus) { return }

    const { activeElement, body } = globalThis.document
    const shouldRestoreFocus = activeElement === owner || activeElement === body

    if (!shouldRestoreFocus) { return }

    if (trigger.disabled) { row?.focus() }
    else { trigger.focus() }
  }
  async function save(): Promise<void> {
    if (saving.value) { return }

    saving.value = true
    saveError.value = ''
    announcement.value = 'Saving collection…'

    const collectionTitle = title.value.trim()
    const trimmedDescription = description.value.trim()
    const collectionDescription = trimmedDescription || null
    const tickets = members.values()
    const itemIds = tickets.map(ticket => ticket.value.id)

    const input = {
      title: collectionTitle,
      description: collectionDescription,
      isFeatured: isFeatured.value,
      itemIds
    }

    const endpoint = collectionId === undefined ? '/api/catalog/manage/collections' : `/api/catalog/manage/collections/${collectionId}`
    const method = collectionId === undefined ? 'POST' : 'PUT'

    const body = collectionId === undefined ? input : {
      ...input,
      revision: revision.value
    }

    try {
      const response = await requestFetch(endpoint, {
        method,
        body,
        retry: 0
      })

      const parsed = v.parse(saveResponseSchema, response)

      if (disposed) { return }

      revision.value = parsed.collection.revision
      title.value = parsed.collection.title
      description.value = parsed.collection.description ?? ''
      announcement.value = 'Collection published.'

      if (collectionId === undefined) {
        const savedLocation = `/manage/collections/${parsed.collection.id}`

        await navigateTo(savedLocation)
      }
    } catch (error) {
      if (disposed) { return }

      const conflict = isRecord(error) && error.statusCode === 409

      saveError.value = conflict ? 'This collection changed elsewhere. Your edits are still here. Reload the collection before saving again.' : 'We couldn’t confirm the save. Your edits are still here. Check the collection before trying again.'
      announcement.value = ''
    } finally { saving.value = false }
  }
  function requestDelete(): void { confirmDelete.value = true }
  async function cancelDelete(): Promise<void> {
    confirmDelete.value = false

    await nextTick()
    deleteButton.value?.focus()
  }
  async function deleteSaved(): Promise<void> {
    if (saving.value || collectionId === undefined) { return }

    saving.value = true
    saveError.value = ''

    try {
      const endpoint = `/api/catalog/manage/collections/${collectionId}`

      await requestFetch(endpoint, {
        method: 'DELETE',
        body: { revision: revision.value },
        retry: 0
      })

      if (!disposed) { await navigateTo('/manage/collections') }
    } catch { if (!disposed) { saveError.value = 'We couldn’t confirm deletion. Reload the collection to check its current state.' } }
    finally { saving.value = false }
  }

  onScopeDispose(() => {
    disposed = true

    searchController?.abort()
  })

  if (reader !== undefined) {
    watch(reader.data, value => {
      if (value !== undefined) { applyLoaded(value) }
    }, {
      immediate: true,
      flush: 'sync'
    })

    await reader.ready
  }

</script>

<style module>
  @layer reset, vendor, tokens, base, components, utilities;

  @layer components {
    .component, .form, .members, .search { display: grid; min-inline-size: 0; }
    .component { gap: var(--space-8); }
    .form, .members, .search { gap: var(--space-5); }
    .form, .search { max-inline-size: 60rem; }
    .field { display: grid; gap: var(--space-2); font-weight: 600; }
    .field input, .field textarea { inline-size: 100%; padding: var(--space-3); border: 1px solid var(--color-border-strong); border-radius: var(--radius-md); background: var(--color-surface); color: var(--color-text-primary); font: inherit; font-weight: 400; }
    .field textarea { resize: vertical; }
    .choice { display: flex; align-items: center; gap: var(--space-3); }
    .list { padding: 0; list-style: none; }
    .row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-4); padding-block: var(--space-4); border-bottom: 1px solid var(--color-border); }
    .itemCopy { flex: 1 1 12rem; }
    .itemCopy p, .hint { color: var(--color-text-secondary); font-size: 0.875rem; }
    .actions, .message { display: flex; gap: var(--space-3); align-items: center; flex-wrap: wrap; }
    .searchForm { display: flex; gap: var(--space-3); align-items: end; }
    .searchForm .field { flex: 1; min-inline-size: 0; }
    .members h2, .search h2 { font-size: 1.375rem; font-weight: 600; }
  }
</style>
