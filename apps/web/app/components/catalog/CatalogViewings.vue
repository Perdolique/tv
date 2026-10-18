<template>
  <section :class="$style.component" :aria-labelledby="headingId" @keydown.esc="cancelDelete">
    <header :class="$style.header">
      <h2 :id="headingId" ref="heading" :class="$style.heading" tabindex="-1">Your viewings</h2>
      <AppButton size="small" ref="addButton" v-if="showAdd" :disabled="areMutationsDisabled" variant="secondary" @click="open('add')">Add past viewing</AppButton>
    </header>
    <p v-if="isAnonymous"><NuxtLink :to="signInLocation">Sign in to view your history</NuxtLink> to record viewings and see your personal history.</p>
    <p v-else-if="hasSessionError">Your history is unavailable while we check your session.</p>
    <p v-else-if="isLoadingHistory" role="status">Loading your viewings…</p>
    <template v-else>
      <p v-if="announcement" role="status" :class="$style.supporting">{{ announcement }}</p>
      <div v-if="readError" :class="$style.message">
        <AppMessage role="alert" tone="danger">{{ readError }}</AppMessage>
        <AppButton :class="$style.historyAction" size="small" variant="secondary" :disabled="isSaving" @click="refresh">Refresh viewings</AppButton>
      </div>
      <AppMessage v-if="pointError" role="alert" tone="danger">{{ pointError }}</AppMessage>
      <AppMessage v-if="viewingSaveError" role="alert" tone="danger">{{ viewingSaveError }}</AppMessage>
      <AppButton :class="$style.historyAction" size="small" ref="historyRetry" v-if="hasUnconfirmedHistory" :disabled="isSaving" variant="secondary" @click="retryHistoryCreation">{{ retryLabel }}</AppButton>
      <AppButton :class="$style.historyAction" size="small" ref="saveRefresh" v-if="showSaveRefresh" variant="secondary" :disabled="isSaving" @click="refresh">Refresh viewings</AppButton>
      <div v-if="isAdding" :class="$style.form">
        <h3>Add past viewing</h3>
        <CatalogViewingDatesForm :initial="newViewingDates" :type="type" completed-only :fields="fields" :is-saving="areDatesDisabled" @save="add" @cancel="close()" />
      </div>
      <p v-if="isEmpty">No viewings recorded yet.</p>
      <ul :class="$style.list" :aria-label="listLabel">
        <li v-for="viewing in rows" :id="viewing.elementId" :key="viewing.id" :class="$style.row" :data-current="viewing.isCurrent || undefined" tabindex="-1">
          <div :class="$style.rowHeader">
            <h3 :class="$style.rowHeading">{{ viewing.statusLabel }} <span v-if="viewing.isCurrent" :class="$style.badge">Current</span></h3>
          </div>
          <dl v-if="viewing.showDates" :class="$style.dates">
            <div v-if="isSeries"><dt :class="$style.dateLabel">Started on</dt><dd :class="$style.dateValue">{{ viewing.startedLabel }}</dd></div>
            <div v-if="viewing.watchedLabel"><dt :class="$style.dateLabel">{{ completionLabel }}</dt><dd :class="$style.dateValue">{{ viewing.watchedLabel }}</dd></div>
          </dl>
          <template v-if="viewing.isEditing">
            <CatalogViewingDatesForm :initial="viewing.record" :type="type" :fields="fields" :is-saving="areDatesDisabled" @save="dates => edit(viewing.record, dates)" @cancel="close()" />
          </template>
          <div v-else-if="viewing.isDeleting" :class="$style.confirmation">
            <p>Delete this viewing? This cannot be undone.</p>
            <div :class="$style.actions">
              <AppButton size="small" variant="secondary" :class="$style.danger" :disabled="isSaving" @click="remove(viewing.record)">{{ deleteLabel }}</AppButton>
              <AppButton size="small" variant="secondary" :disabled="isSaving" @click="close()">Cancel</AppButton>
            </div>
          </div>
          <div v-else :class="$style.actions">
            <CatalogRating
              compact
              show-score
              :show-load-error="false"
              :account-id="accountId"
              :target-key="viewing.ratingKey"
              :label="viewing.ratingLabel"
              :has-session-error="hasSessionError"
              :is-anonymous="isAnonymous"
              :is-saving="isSaving"
              :has-unconfirmed-mutation="viewing.hasUnconfirmedRating"
              :is-unavailable="viewing.isRatingBlocked"
              :retry-mutation="state.retryMutation"
              :load="refresh"
              :save="score => rate(viewing.record, score)"
              :save-error="viewing.ratingSaveError"
              :score="viewing.record.score"
              :sign-in-location="signInLocation"
              :status="status"
              @clear-error="clearRatingError(viewing.id)"
            />
            <AppButton size="small" variant="secondary" :disabled="areMutationsDisabled" @click="open(viewing.id)">{{ editLabel }}</AppButton>
            <AppButton v-if="isSeries" size="small" variant="secondary" :disabled="areMutationsDisabled" :aria-pressed="viewing.isSelected" @click="select(viewing.record)">View season and episode ratings</AppButton>
            <AppButton v-if="isSeries" size="small" variant="secondary" :disabled="areMutationsDisabled" @click="changeStatus(viewing.record)">{{ viewing.statusAction }}</AppButton>
            <AppButton size="small" variant="secondary" :class="$style.danger" :disabled="areMutationsDisabled" @click="confirmDelete(viewing.id)">Delete</AppButton>
          </div>
        </li>
      </ul>
      <AppButton :class="$style.historyAction" size="small" v-if="nextCursor" variant="secondary" :disabled="isMoreBusy" :aria-busy="isLoadingMore" @click="more">{{ moreLabel }}</AppButton>
    </template>
  </section>
</template>

<script lang="ts" setup>
  import { NuxtLink } from '#components'
  import { computed, nextTick, ref, shallowRef, toRef, useId, useTemplateRef, watch } from 'vue'
  import type { RouteLocationRaw } from 'vue-router'
  import type { CatalogViewing, CatalogViewingDraft } from '@tv/shared/catalog-viewings'
  import type { CatalogViewingsState } from '~/composables/use-catalog-viewings.ts'
  import CatalogRating from '~/components/catalog/CatalogRating.vue'
  import AppButton from '~/components/ui/AppButton.vue'
  import AppMessage from '~/components/ui/AppMessage.vue'
  import CatalogViewingDatesForm from '~/components/catalog/CatalogViewingDatesForm.vue'
  import { formatCalendarDateForDisplay, getLocalCalendarDate } from '~/utils/calendar-date.ts'

  interface Props {
    state: CatalogViewingsState;
    type: 'movie' | 'series';
    accountId: string | null;
    isAnonymous: boolean;
    hasSessionError: boolean;
    signInLocation: RouteLocationRaw;
  }

  interface Emits {
    selected: [];
  }

  const { state, accountId, isAnonymous, type } = defineProps<Props>()
  const emit = defineEmits<Emits>()
  const { fields, items, isLoadingMore, isSaving, nextCursor, pointError, readError, saveError, status, summary } = state
  const headingId = useId()
  const heading = useTemplateRef('heading')
  const addButton = useTemplateRef('addButton')
  const historyRetry = useTemplateRef('historyRetry')
  const saveRefresh = useTemplateRef('saveRefresh')
  const form = shallowRef<string | null>(null)
  const deletingId = shallowRef<string | null>(null)
  const ratingOwnerId = shallowRef<string | null>(null)

  const viewingSaveError = toRef(() => {
    const isRewatch = state.saveKey.value.startsWith('rewatch:')
    const belongsToRewatch = isRewatch || (type === 'series' && state.saveKey.value === 'create:current')
    const isHistoryError = state.saveOperation.value === 'viewing' && !belongsToRewatch

    return isHistoryError ? saveError.value : ''
  })

  const announcement = shallowRef('')
  const activeViewing = ref<CatalogViewing | null>(null)
  const today = getLocalCalendarDate()
  const isSeries = toRef(() => type === 'series')
  const listLabel = toRef(() => isSeries.value ? 'Series viewings' : 'Movie viewings')
  const editLabel = toRef(() => isSeries.value ? 'Edit dates' : 'Edit date')
  const completionLabel = toRef(() => isSeries.value ? 'Completed on' : 'Watched on')
  const initialStartedOn = type === 'series' ? today : null

  const newViewingDates = ref<CatalogViewingDraft>({
    status: 'completed',
    startedOn: initialStartedOn,
    completedOn: today
  })

  let focusOwner: HTMLElement | null = null

  const hasUnconfirmedHistory = toRef(() => {
    const mutation = state.unconfirmedMutation.value
    const isRewatch = mutation?.key.startsWith('rewatch:')
    const belongsToRewatch = isRewatch || (type === 'series' && mutation?.key === 'create:current')

    return mutation?.operation === 'viewing' && !belongsToRewatch
  })

  const retryLabel = toRef(() => {
    const isCreation = state.unconfirmedMutation.value?.key.startsWith('create:')

    return isCreation ? 'Retry viewing' : 'Retry change'
  })

  const isAdding = toRef(() => form.value === 'add')
  const showAdd = toRef(() => !isAnonymous && status.value === 'loaded' && form.value === null)
  const isLoadingHistory = toRef(() => status.value === 'idle' || status.value === 'loading')
  const showSaveRefresh = toRef(() => (viewingSaveError.value !== '' || pointError.value !== '') && readError.value === '')
  const areDatesDisabled = toRef(() => isSaving.value || hasUnconfirmedHistory.value)
  const isMoreBusy = toRef(() => isLoadingMore.value || isSaving.value)
  const areMutationsDisabled = toRef(() => isSaving.value || state.pendingMutation.value !== null || status.value !== 'loaded')
  const deleteLabel = toRef(() => isSaving.value ? 'Deleting…' : 'Delete viewing')
  const moreLabel = toRef(() => isLoadingMore.value ? 'Loading…' : 'Load more viewings')

  const records = computed(() => {
    const extra: CatalogViewing[] = []
    const ids = items.value.map(item => item.id)
    const known = new Set(ids)
    const activeRecord = activeViewing.value

    if (activeRecord !== null) {
      const isKnown = known.has(activeRecord.id)

      if (!isKnown) { extra.push(activeRecord) }
    }

    return [...extra, ...items.value]
  })

  const rows = computed(() => records.value.map(record => {
    const isEditing = form.value === record.id
    const displayed = isEditing && activeViewing.value?.id === record.id ? activeViewing.value : record
    const watchedLabel = record.completedOn === null ? null : formatCalendarDateForDisplay(record.completedOn, { dateStyle: 'medium' })
    const startedLabel = record.startedOn === null ? null : formatCalendarDateForDisplay(record.startedOn, { dateStyle: 'medium' })
    const statusLabel = record.status === 'watching' ? 'Watching viewing' : 'Completed viewing'
    const statusAction = record.status === 'watching' ? 'Complete viewing' : 'Reopen viewing'
    const selectedId = state.selectedViewingId.value ?? summary.value.currentViewingId
    const isSelected = record.id === selectedId
    const mutationKey = record.id === summary.value.currentViewingId ? 'rating:item:current' : `rating:item:${record.id}`
    const hasUnconfirmedRating = state.unconfirmedMutation.value?.key === mutationKey
    const isRatingBlocked = state.isMutationBlocked(mutationKey)
    const elementId = `viewing-${record.id}`
    const isCurrent = record.id === summary.value.currentViewingId
    const ratingKind = isCurrent ? 'current' : 'history'
    const ratingKey = `${record.id}:${ratingKind}`
    const ratingLabel = isCurrent ? 'Current viewing rating' : 'Past viewing rating'
    const ratingSaveError = ratingOwnerId.value === record.id ? saveError.value : ''
    const isDeleting = deletingId.value === record.id
    const showDates = !isEditing

    return {
      id: record.id,
      record: displayed,
      elementId,
      isCurrent,
      ratingKey,
      ratingLabel,
      ratingSaveError,
      isEditing,
      isDeleting,
      showDates,
      watchedLabel,
      startedLabel,
      statusLabel,
      statusAction,
      isSelected,
      hasUnconfirmedRating,
      isRatingBlocked
    }
  }))

  const isEmpty = toRef(() => status.value === 'loaded' && rows.value.length === 0)

  function open(id: string): void {
    if (id === 'add') {
      const newDate = getLocalCalendarDate()
      const startedOn = isSeries.value ? newDate : null

      newViewingDates.value = {
        status: 'completed',
        startedOn,
        completedOn: newDate
      }
    }

    focusOwner = globalThis.document.activeElement instanceof globalThis.HTMLElement ? globalThis.document.activeElement : null
    announcement.value = ''
    ratingOwnerId.value = null
    activeViewing.value = records.value.find(record => record.id === id) ?? null
    form.value = id
    deletingId.value = null
    saveError.value = ''
    pointError.value = ''
    fields.value = {}
  }
  async function close(owner: Element | null = globalThis.document.activeElement): Promise<void> {
    const wasAdding = form.value === 'add'

    form.value = null
    deletingId.value = null
    activeViewing.value = null
    pointError.value = ''

    await nextTick()

    const { activeElement, body } = globalThis.document
    const ownsFocus = activeElement === owner || activeElement === body

    if (!ownsFocus) { return }

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
  async function add(dates: CatalogViewingDraft): Promise<void> {
    const owner = globalThis.document.activeElement

    announcement.value = ''

    const saved = await state.create('history', dates)

    if (saved) {
      announcement.value = 'Past viewing saved.'

      await close(owner)
    }
  }
  async function retryHistoryCreation(): Promise<void> {
    const owner = globalThis.document.activeElement
    const savedAccountId = accountId
    const savedForm = form.value
    const savedDeletingId = deletingId.value
    const pendingKey = state.pendingMutation.value?.key
    const saved = await state.retryMutation()

    if (saved) {
      const deletedViewing = pendingKey?.startsWith('delete:')

      announcement.value = deletedViewing ? 'Viewing deleted.' : 'Viewing saved.'

      await close(owner)

      return
    }

    await nextTick()

    const sameForm = form.value === savedForm && deletingId.value === savedDeletingId
    const { activeElement, body } = globalThis.document
    const ownsFocus = activeElement === owner || activeElement === body

    if (accountId !== savedAccountId || !sameForm || !ownsFocus) { return }

    if (hasUnconfirmedHistory.value) { historyRetry.value?.focus() }
    else if (showSaveRefresh.value) { saveRefresh.value?.focus() }
    else { heading.value?.focus() }
  }
  function clearRatingError(id: string): void {
    ratingOwnerId.value = id

    const matchingRecord = records.value.find(record => record.id === id) ?? null

    activeViewing.value = matchingRecord
    saveError.value = ''
  }
  function select(viewing: CatalogViewing): void {
    state.select(viewing)
    emit('selected')
  }
  function changeStatus(viewing: CatalogViewing): void {
    open(viewing.id)

    const nextStatus = viewing.status === 'watching' ? 'completed' : 'watching'
    const completedOn = nextStatus === 'completed' ? getLocalCalendarDate() : null

    activeViewing.value = {
      ...viewing,
      status: nextStatus,
      completedOn
    }
  }
  async function rate(viewing: CatalogViewing, score: number | null): Promise<boolean> {
    ratingOwnerId.value = viewing.id

    return state.saveViewingScore(viewing, score)
  }
  async function edit(viewing: CatalogViewing, dates: CatalogViewingDraft): Promise<void> {
    const owner = globalThis.document.activeElement

    announcement.value = ''

    const saved = await state.update(viewing, dates)

    if (saved) {
      announcement.value = 'Viewing date saved.'

      await close(owner)
    }
  }
  async function remove(viewing: CatalogViewing): Promise<void> {
    const owner = globalThis.document.activeElement

    announcement.value = ''

    const saved = await state.remove(viewing)

    if (saved) {
      announcement.value = 'Viewing deleted.'

      await close(owner)
    }
  }
  async function more(): Promise<void> {
    const count = items.value.length

    announcement.value = ''

    const loaded = await state.load(true)

    if (!loaded) { return }

    const addedCount = items.value.length - count
    const loadedAnnouncement = `${addedCount} more viewings loaded.`

    announcement.value = state.didRecoverCursor.value ? 'Viewing history refreshed.' : loadedAnnouncement

    await nextTick()

    if (!nextCursor.value && !readError.value) {
      heading.value?.focus()
    }
  }
  async function refresh(): Promise<void> {
    const activeId = activeViewing.value?.id ?? ratingOwnerId.value
    const loaded = await state.load()

    if (!loaded) { return }

    if (activeId !== null) {
      const refreshed = await state.loadPoint(activeId)
      const isActiveViewing = refreshed !== null && activeViewing.value?.id === activeId

      if (isActiveViewing) {
        activeViewing.value = refreshed
      }
    }

    await nextTick()

    if (activeViewing.value === null) { heading.value?.focus() }
  }

  watch(state.confirmedViewing, viewing => {
    const isActiveViewing = viewing !== null && activeViewing.value?.id === viewing.id

    if (isActiveViewing) { activeViewing.value = viewing }
  }, { flush: 'sync' })

  watch(state.deletedViewingId, id => {
    if (id !== null && activeViewing.value?.id === id) { void close() }
  }, { flush: 'sync' })


</script>

<style module>
  @layer reset, vendor, tokens, base, components, utilities;
  @layer components {
    .component { display: grid; align-content: start; gap: var(--space-6); min-inline-size: 0; }
    .historyAction { justify-self: start; }
    .header, .rowHeader, .actions { display: flex; align-items: center; flex-wrap: wrap; }
    .header, .actions { gap: var(--space-3); }
    .header { justify-content: space-between; }
    .heading { font-size: 1.5rem; line-height: 1.25; font-weight: 600; }
    .list { display: grid; gap: var(--space-4); padding: 0; list-style: none; }
    .row, .form { display: grid; gap: var(--space-4); padding: var(--space-5); border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface); scroll-margin-block: var(--space-8); }
    .rowHeading { font-size: 1rem; font-weight: 600; }
    .badge { display: inline-block; margin-inline-start: var(--space-2); padding: var(--space-1) var(--space-2); border-radius: var(--radius-sm); background: var(--color-accent-fill); color: var(--color-on-accent); font-size: 0.75rem; }
    .dates { display: flex; flex-wrap: wrap; gap: var(--space-5); }
    .dateLabel, .supporting { color: var(--color-text-secondary); font-size: 0.875rem; }
    .dateValue { font-variant-numeric: tabular-nums; }
    .message, .confirmation { display: grid; gap: var(--space-3); }
    .danger[data-variant]:not(:disabled) { color: var(--color-danger); }
  }
</style>
