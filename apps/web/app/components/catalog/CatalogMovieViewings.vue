<template>
  <section :class="$style.component" :aria-labelledby="headingId" @keydown.esc="cancelDelete">
    <header :class="$style.header">
      <h2 :id="headingId" ref="heading" :class="$style.heading" tabindex="-1">Your viewings</h2>
      <AppButton ref="addButton" v-if="showAdd" :disabled="isSaving" variant="secondary" @click="open('add')">Add past viewing</AppButton>
    </header>
    <p v-if="isAnonymous"><NuxtLink :to="signInLocation">Sign in to view your history</NuxtLink> to record viewings and open your personal history.</p>
    <p v-else-if="hasSessionError">Your history is unavailable while we check your session.</p>
    <p v-else-if="isLoadingHistory" role="status">Loading your viewings…</p>
    <template v-else>
      <p v-if="announcement" role="status" :class="$style.supporting">{{ announcement }}</p>
      <div v-if="readError" :class="$style.message">
        <AppMessage role="alert" tone="danger">{{ readError }}</AppMessage>
        <AppButton variant="secondary" :disabled="isSaving" @click="refresh">Refresh viewings</AppButton>
      </div>
      <AppMessage v-if="pointError" role="alert" tone="danger">{{ pointError }}</AppMessage>
      <AppButton v-if="canRetryLinked" variant="secondary" @click="state.loadPoint()">Retry linked viewing</AppButton>
      <AppMessage v-if="saveError" role="alert" tone="danger">{{ saveError }}</AppMessage>
      <AppButton v-if="showSaveRefresh" variant="secondary" :disabled="isSaving" @click="refresh">Refresh viewings</AppButton>
      <div v-if="isAdding" :class="$style.form">
        <h3>Add past viewing</h3>
        <CatalogViewingDatesForm :initial="unknownDates" :fields="fields" :is-saving="isSaving" @save="add" @cancel="close" />
      </div>
      <p v-if="isEmpty">No viewings recorded yet.</p>
      <ul :class="$style.list" aria-label="Movie viewings">
        <li v-for="viewing in rows" :id="viewing.elementId" :key="viewing.id" :class="[$style.row, { 'is-linked': viewing.isLinked }]" :data-current="viewing.isCurrent || undefined" :data-linked="viewing.isLinked || undefined" tabindex="-1">
          <div :class="$style.rowHeader">
            <h3 :class="$style.rowHeading">Completed viewing <span v-if="viewing.isCurrent" :class="$style.badge">Current</span></h3>
            <NuxtLink :to="viewing.location">Link to viewing</NuxtLink>
          </div>
          <dl :class="$style.dates">
            <div><dt :class="$style.dateLabel">Started on</dt><dd :class="$style.dateValue">{{ viewing.startedLabel }}</dd></div>
            <div><dt :class="$style.dateLabel">Completed on</dt><dd :class="$style.dateValue">{{ viewing.completedLabel }}</dd></div>
          </dl>
          <p :class="$style.supporting">Recorded <NuxtTime :datetime="viewing.record.recordedAt" date-style="medium" time-style="short" /></p>
          <template v-if="viewing.isEditing">
            <CatalogViewingDatesForm :initial="viewing.record" :fields="fields" :is-saving="isSaving" @save="dates => edit(viewing.record, dates)" @cancel="close" />
          </template>
          <div v-else-if="viewing.isDeleting" :class="$style.confirmation">
            <p>Delete this viewing? This cannot be undone.</p>
            <div :class="$style.actions">
              <AppButton variant="secondary" :class="$style.danger" :disabled="isSaving" @click="remove(viewing.record)">{{ deleteLabel }}</AppButton>
              <AppButton variant="secondary" :disabled="isSaving" @click="close">Cancel</AppButton>
            </div>
          </div>
          <div v-else :class="$style.actions">
            <AppButton variant="secondary" :disabled="isSaving" @click="open(viewing.id)">Edit dates</AppButton>
            <AppButton variant="secondary" :class="$style.danger" :disabled="isSaving" @click="confirmDelete(viewing.id)">Delete</AppButton>
          </div>
        </li>
      </ul>
      <AppButton v-if="nextCursor" variant="secondary" :disabled="isMoreBusy" :aria-busy="isLoadingMore" @click="more">{{ moreLabel }}</AppButton>
    </template>
  </section>
</template>

<script lang="ts" setup>
  import { NuxtLink, NuxtTime } from '#components'
  import { computed, nextTick, ref, useId, useTemplateRef, watch } from 'vue'
  import type { RouteLocationRaw } from 'vue-router'
  import type { CatalogViewing, CatalogViewingDates } from '@tv/shared/catalog-viewings'
  import type { MovieViewingsState } from '~/composables/use-movie-viewings.ts'
  import AppButton from '~/components/ui/AppButton.vue'
  import AppMessage from '~/components/ui/AppMessage.vue'
  import CatalogViewingDatesForm from '~/components/catalog/CatalogViewingDatesForm.vue'
  import { formatCalendarDateForDisplay } from '~/utils/calendar-date.ts'

  interface Props {
    state: MovieViewingsState;
    isAnonymous: boolean;
    hasSessionError: boolean;
    selectedId: string | null;
    signInLocation: RouteLocationRaw;
  }

  const { state, selectedId, isAnonymous } = defineProps<Props>()
  const { fields, items, isLoadingMore, isSaving, nextCursor, pointError, readError, saveError, selectedViewing, status, summary } = state
  const headingId = useId()
  const heading = useTemplateRef('heading')
  const addButton = useTemplateRef('addButton')
  const form = ref<string | null>(null)
  const deletingId = ref<string | null>(null)
  const announcement = ref('')
  const activeViewing = ref<CatalogViewing | null>(null)

  const unknownDates = {
    startedOn: null,
    completedOn: null
  }

  let focusOwner: HTMLElement | null = null

  function dateLabel(value: string | null): string {
    return value === null ? 'Unknown' : formatCalendarDateForDisplay(value, { dateStyle: 'medium' })
  }
  function viewingLink(viewing: CatalogViewing): string {
    return `/titles/${viewing.catalogItemId}?viewingId=${viewing.id}#viewing-${viewing.id}`
  }

  const isAdding = computed(() => form.value === 'add')
  const showAdd = computed(() => !isAnonymous && status.value === 'loaded' && form.value === null)
  const isLoadingHistory = computed(() => status.value === 'idle' || status.value === 'loading')
  const canRetryLinked = computed(() => Boolean(pointError.value) && selectedId !== null)
  const showSaveRefresh = computed(() => Boolean(saveError.value) && !readError.value)
  const isMoreBusy = computed(() => isLoadingMore.value || isSaving.value)
  const deleteLabel = computed(() => isSaving.value ? 'Deleting…' : 'Delete viewing')
  const moreLabel = computed(() => isLoadingMore.value ? 'Loading…' : 'Load more viewings')

  const records = computed(() => {
    const extra: CatalogViewing[] = []
    const ids = items.value.map(item => item.id)
    const known = new Set(ids)

    if (selectedViewing.value !== null && !known.has(selectedViewing.value.id)) {
      extra.push(selectedViewing.value)
      known.add(selectedViewing.value.id)
    }

    if (activeViewing.value !== null && !known.has(activeViewing.value.id)) {
      extra.push(activeViewing.value)
    }

    return [...extra, ...items.value]
  })

  const rows = computed(() => records.value.map(record => {
    const isEditing = form.value === record.id
    const displayed = isEditing && activeViewing.value?.id === record.id ? activeViewing.value : record
    const location = viewingLink(record)
    const startedLabel = dateLabel(record.startedOn)
    const completedLabel = dateLabel(record.completedOn)

    return {
      id: record.id,
      record: displayed,
      elementId: `viewing-${record.id}`,
      isCurrent: record.id === summary.value.currentViewingId,
      isLinked: record.id === selectedId,
      isEditing,
      isDeleting: deletingId.value === record.id,
      location,
      startedLabel,
      completedLabel
    }
  }))

  const isEmpty = computed(() => status.value === 'loaded' && rows.value.length === 0)

  function open(id: string): void {
    focusOwner = globalThis.document.activeElement instanceof globalThis.HTMLElement ? globalThis.document.activeElement : null
    announcement.value = ''
    activeViewing.value = records.value.find(record => record.id === id) ?? null
    form.value = id
    deletingId.value = null
    saveError.value = ''
    fields.value = {}
  }
  async function close(): Promise<void> {
    const wasAdding = form.value === 'add'

    form.value = null
    deletingId.value = null
    activeViewing.value = null

    await nextTick()

    if (wasAdding) {
      addButton.value?.focus()
    } else if (focusOwner?.isConnected) {
      focusOwner.focus()
    } else {
      heading.value?.focus()
    }
  }
  async function confirmDelete(id: string): Promise<void> {
    open(id)

    form.value = null
    deletingId.value = id

    await nextTick()

    const escapedId = globalThis.CSS.escape(id)
    const selector = `[id="viewing-${escapedId}"]`
    const row = globalThis.document.querySelector(selector)

    row?.querySelector<HTMLButtonElement>('button')?.focus()
  }
  function cancelDelete(): void {
    if (deletingId.value !== null && !isSaving.value) { void close() }
  }
  async function add(dates: CatalogViewingDates): Promise<void> {
    announcement.value = ''

    const saved = await state.create('history', dates)

    if (saved) {
      announcement.value = 'Past viewing saved.'

      await close()
    }
  }
  async function edit(viewing: CatalogViewing, dates: CatalogViewingDates): Promise<void> {
    announcement.value = ''

    const saved = await state.update(viewing, dates)

    if (saved) {
      announcement.value = 'Viewing dates saved.'

      await close()
    }
  }
  async function remove(viewing: CatalogViewing): Promise<void> {
    announcement.value = ''

    const saved = await state.remove(viewing)

    if (saved) {
      announcement.value = 'Viewing deleted.'

      await close()
    }
  }
  async function more(): Promise<void> {
    const count = items.value.length

    announcement.value = ''

    const loaded = await state.load(true)

    if (!loaded) { return }

    announcement.value = `${items.value.length - count} more viewings loaded.`

    await nextTick()

    if (!nextCursor.value && !readError.value) {
      heading.value?.focus()
    }
  }
  async function refresh(): Promise<void> {
    const activeId = activeViewing.value?.id ?? selectedId

    await state.load()

    if (activeId !== null) {
      const refreshed = await state.loadPoint(activeId)

      if (refreshed !== null && activeViewing.value?.id === activeId) {
        activeViewing.value = refreshed
      }
    }

    await nextTick()

    if (activeViewing.value === null) { heading.value?.focus() }
  }

  watch([() => selectedId, records], async () => {
    if (selectedId === null || !records.value.some(record => record.id === selectedId)) {
      return
    }

    await nextTick()

    const escapedId = globalThis.CSS.escape(selectedId)
    const selector = `[id="viewing-${escapedId}"]`
    const target = globalThis.document.querySelector(selector)

    target?.scrollIntoView({ block: 'nearest' })
  }, { immediate: true })
</script>

<style module>
  @layer reset, vendor, tokens, base, components, utilities;
  @layer components {
    .component { display: grid; align-content: start; gap: var(--space-6); min-inline-size: 0; }
    .header, .rowHeader, .actions { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-3); }
    .header, .rowHeader { justify-content: space-between; }
    .heading { font-size: 1.5rem; line-height: 1.25; font-weight: 600; }
    .list { display: grid; gap: var(--space-4); padding: 0; list-style: none; }
    .row, .form { display: grid; gap: var(--space-4); padding: var(--space-5); border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface); scroll-margin-block: var(--space-8); }
    .row { &:global(.is-linked) { border-color: var(--color-accent); } }
    .rowHeading { font-size: 1rem; font-weight: 600; }
    .badge { display: inline-block; margin-inline-start: var(--space-2); padding: var(--space-1) var(--space-2); border-radius: var(--radius-sm); background: var(--color-accent-fill); color: var(--color-on-accent); font-size: 0.75rem; }
    .dates { display: flex; flex-wrap: wrap; gap: var(--space-4) var(--space-8); }
    .dateLabel, .supporting { color: var(--color-text-secondary); font-size: 0.875rem; }
    .dateValue { font-variant-numeric: tabular-nums; }
    .message, .confirmation { display: grid; gap: var(--space-3); }
    .danger[data-variant]:not(:disabled) { color: var(--color-danger); }
  }
</style>
