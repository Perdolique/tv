<template>
  <section ref="root" :class="$style.component" aria-label="Viewing status action">
    <Popover.Root v-model="isOpen" position-area="block-end span-inline-end" position-try="flip-inline, flip-block">
      <Popover.Activator v-slot="{ attrs }" renderless>
        <AppButton ref="trigger" v-bind="attrs" :size="size" variant="secondary" :disabled="isTriggerDisabled" aria-haspopup="dialog" @click.prevent="toggle">Viewing status</AppButton>
      </Popover.Activator>
      <Popover.Content as="section" :class="$style.panel" role="dialog" :aria-labelledby="headingId">
        <header :class="$style.header">
          <h2 :id="headingId" :class="$style.heading">Viewing status</h2>
          <AppButton size="small" variant="secondary" aria-label="Close viewing status" :disabled="isSubmitting" autofocus @click="close">Close</AppButton>
        </header>
        <p :class="$style.supporting">Current status: {{ currentLabel }}</p>
        <div :class="$style.choices" role="group" aria-label="Choose viewing status">
          <AppButton v-for="choice in choices" :key="choice.value" :class="$style.choice" size="small" variant="secondary" :aria-pressed="choice.isSelected" :disabled="areChoicesDisabled" @click="choose(choice.value)">{{ choice.label }}</AppButton>
        </div>
        <form v-if="isCompleting" :class="$style.form" @submit.prevent="save('completed')">
          <label :for="dateId">Completed on</label>
          <input :id="dateId" ref="dateField" v-model="completedOn" type="date" required :min="minimumDate" :class="$style.input" :disabled="areChoicesDisabled">
          <AppButton size="small" type="submit" :disabled="areChoicesDisabled">Complete viewing</AppButton>
        </form>
        <p v-if="isSaving" role="status" :class="$style.supporting">Saving viewing status…</p>
        <AppMessage v-if="error" role="alert" tone="danger">{{ error }}</AppMessage>
        <p v-if="statusError" :class="$style.supporting">{{ statusError }}</p>
        <AppButton v-if="hasUnconfirmed" size="small" variant="secondary" :disabled="isSaving" @click="retry">Retry status change</AppButton>
        <AppButton v-else-if="error" size="small" variant="secondary" :disabled="isSaving" @click="refresh">Refresh viewings</AppButton>
      </Popover.Content>
    </Popover.Root>
    <p :class="$style.accessible" role="status">{{ announcement }}</p>
  </section>
</template>

<script setup lang="ts">
  import { Popover } from '@vuetify/v0/components'
  import { computed, nextTick, shallowRef, toRef, useId, useTemplateRef, watch } from 'vue'
  import type { CatalogViewing, CatalogViewingStatus } from '@tv/shared/catalog-viewings'
  import type { CatalogViewingsState } from '~/composables/use-catalog-viewings.ts'
  import AppButton from '~/components/ui/AppButton.vue'
  import AppMessage from '~/components/ui/AppMessage.vue'
  import { getLocalCalendarDate } from '~/utils/calendar-date.ts'
  import { viewingStatusPresentation } from '~/utils/catalog-viewing-status.ts'

  interface Props {
    state: CatalogViewingsState;
    viewing: CatalogViewing;
    accountId: string | null;
    size?: 'small' | 'medium';
  }
  interface Emits {
    opened: [];
  }

  const { state, viewing, accountId, size = 'small' } = defineProps<Props>()
  const emit = defineEmits<Emits>()
  const { isSaving } = state
  const trigger = useTemplateRef('trigger')
  const root = useTemplateRef('root')
  const dateField = useTemplateRef('dateField')
  const headingId = useId()
  const dateId = useId()
  const isOpen = shallowRef(false)
  const isSubmitting = shallowRef(false)
  const isCompleting = shallowRef(false)
  const completedOn = shallowRef('')
  const announcement = shallowRef('')
  const key = toRef(() => `status:${viewing.id}`)
  const currentLabel = toRef(() => viewingStatusPresentation[viewing.status].label)
  const minimumDate = toRef(() => viewing.startedOn ?? undefined)
  const hasUnconfirmed = toRef(() => state.unconfirmedMutation.value?.key === key.value)
  const areChoicesDisabled = toRef(() => isSubmitting.value || isSaving.value || state.pendingMutation.value !== null)

  const isTriggerDisabled = toRef(() => {
    const isMutationBlocked = state.isMutationBlocked(key.value)

    return isSubmitting.value || state.status.value !== 'loaded' || isSaving.value || isMutationBlocked
  })

  const error = toRef(() => state.saveKey.value === key.value ? state.saveError.value : '')
  const statusError = toRef(() => error.value ? state.fields.value.status : '')

  const choices = computed(() => {
    const entries = Object.entries(viewingStatusPresentation)

    return entries.map(([value, presentation]) => {
      const isSelected = viewing.status === value

      return {
        value: value as CatalogViewingStatus,
        label: presentation.label,
        isSelected
      }
    })
  })

  function close(): void { isOpen.value = false }

  function toggle(): void {
    if (isOpen.value) {
      close()

      return
    }

    isCompleting.value = false
    completedOn.value = getLocalCalendarDate()
    announcement.value = ''

    emit('opened')

    isOpen.value = true
  }
  async function restoreFocus(): Promise<void> {
    const owner = globalThis.document.activeElement
    const rootHadFocus = root.value?.contains(owner) === true
    const ownedFocus = owner === globalThis.document.body || rootHadFocus

    await nextTick()

    const active = globalThis.document.activeElement
    const rootHasFocus = root.value?.contains(active) === true
    const stillOwnsFocus = active === owner || active === globalThis.document.body || rootHasFocus
    const shouldRestoreFocus = !isOpen.value && ownedFocus && stillOwnsFocus

    if (shouldRestoreFocus) { trigger.value?.focus() }
  }
  async function save(status: CatalogViewingStatus): Promise<void> {
    const savedAccount = accountId
    const savedId = viewing.id
    const date = status === 'completed' ? completedOn.value : null

    isSubmitting.value = true

    const saved = await state.update(viewing, {
      status,
      startedOn: viewing.startedOn,
      completedOn: date
    }, key.value)

    isSubmitting.value = false

    const isSameOwner = accountId === savedAccount && viewing.id === savedId

    if (!isSameOwner || !saved) { return }

    const isCurrent = state.summary.value.currentViewingId === savedId
    const { label } = viewingStatusPresentation[status]
    const message = `Viewing status saved: ${label}.`

    announcement.value = isCurrent ? '' : message

    close()
  }
  async function choose(status: CatalogViewingStatus): Promise<void> {
    if (status === viewing.status) {
      close()

      return
    }

    isCompleting.value = status === 'completed'

    if (isCompleting.value) {
      await nextTick()
      dateField.value?.focus()

      return
    }

    await save(status)
  }
  async function retry(): Promise<void> {
    const savedAccount = accountId
    const savedId = viewing.id

    isSubmitting.value = true

    const saved = await state.retryMutation()

    isSubmitting.value = false

    const isSameOwner = accountId === savedAccount && viewing.id === savedId
    const shouldClose = saved && isSameOwner

    if (shouldClose) {
      announcement.value = state.summary.value.currentViewingId === savedId ? '' : 'Viewing status saved.'

      close()
    }
  }
  async function refresh(): Promise<void> {
    const loaded = await state.load()

    if (loaded) { state.saveError.value = ''; state.fields.value = {} }
  }

  watch([() => accountId, () => viewing.id, () => state.selectedViewingId.value], () => {
    isOpen.value = false
    isCompleting.value = false
    announcement.value = ''
  })

  watch(() => state.summary.value.currentViewingId, () => {
    const ownsSave = isSaving.value && state.saveKey.value === key.value

    if (!ownsSave) { isOpen.value = false; isCompleting.value = false }
  })

  watch([isOpen, isSubmitting], async ([open, submitting], [wasOpen, wasSubmitting]) => {
    const wasActive = wasOpen || wasSubmitting
    const shouldRestoreFocus = !open && !submitting && wasActive

    if (shouldRestoreFocus) { await restoreFocus() }
  })

</script>

<style module>
  @layer reset, vendor, tokens, base, components, utilities;
  @layer components {
    .component { display: grid; }
    .panel { inset: auto; inline-size: min(22rem, calc(100vw - var(--space-8))); max-block-size: calc(100dvh - var(--space-8)); overflow: auto; padding: var(--space-4); border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface); color: var(--color-text-primary); box-shadow: var(--shadow-float); }
    .header { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); margin-block-end: var(--space-3); }
    .heading { font-size: 1rem; font-weight: 600; }
    .choices { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-2); margin-block: var(--space-3); }
    .choices > .choice[aria-pressed='true'] { border-color: var(--color-accent); background: var(--color-surface-selected); }
    @media (forced-colors: active) {
      .choices > .choice[aria-pressed='true'] { border-color: Highlight; outline: 1px solid Highlight; }
    }
    .form { display: grid; gap: var(--space-2); margin-block: var(--space-3); }
    .input { min-inline-size: 0; inline-size: 100%; min-block-size: 2.75rem; padding: var(--space-2); border: 1px solid var(--color-border-strong); border-radius: var(--radius-sm); background: var(--color-surface); }
    .supporting { margin-block: var(--space-2); color: var(--color-text-secondary); font-size: .875rem; }
    .accessible { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  }
</style>
