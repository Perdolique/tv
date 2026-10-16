<template>
  <section :class="[$style.component, { 'is-compact': compact, 'is-rated': hasScore }]" :style="{ '--rating-anchor': anchorName }" :aria-label="label">
    <div ref="anchor" :class="$style.anchor">
      <NuxtLink v-if="isAnonymous" :class="$style.link" :to="signInLocation" :aria-label="showScore ? accessibleTriggerLabel : undefined">
        <Icon :class="$style.star" aria-hidden="true" mode="svg" name="hugeicons:star" />
        {{ visibleActionLabel }}
      </NuxtLink>
      <AppButton
        v-else
        ref="trigger"
        :class="$style.trigger"
        :size="triggerSize"
        :variant="triggerVariant"
        icon="hugeicons:star"
        :disabled="isTriggerDisabled"
        :aria-busy="isBusy || undefined"
        :aria-label="accessibleTriggerLabel"
        :aria-controls="controlledPanelId"
        :aria-expanded="isEditing"
        aria-haspopup="dialog"
        type="button"
        @click="activate"
      >
        {{ triggerLabel }}
      </AppButton>
    </div>
    <AppMessage v-if="showRatingLoadError" :class="$style.loadError" role="alert" tone="danger">We couldn’t load your rating. Try again.</AppMessage>
    <p :class="$style.accessible" role="status">{{ notice }}</p>
    <component
      :is="panelTag"
      v-if="isEditing"
      :id="panelId"
      ref="panel"
      :class="$style.panel"
      :data-presentation="presentation"
      :popover="popoverMode"
      :aria-labelledby="headingId"
      :aria-busy="isSaving"
      role="dialog"
      @cancel.prevent="dismiss"
      @click="onBackdropClick"
    >
      <div :class="$style.header">
        <h2 :id="headingId" :class="$style.heading">{{ label }}</h2>
        <AppButton :class="$style.close" :disabled="isSaving" aria-label="Close rating" variant="secondary" @click="dismiss">
          <Icon aria-hidden="true" mode="svg" name="hugeicons:cancel-01" />
        </AppButton>
      </div>
      <div v-if="hasUnconfirmedCreation" :class="$style.recovery">
        <p>A viewing may already have been saved. Retry to check the same viewing before recording another.</p>
        <AppButton data-rating-retry :disabled="isSaving" variant="secondary" @click="retryUnconfirmed">Retry viewing</AppButton>
      </div>
      <fieldset :class="$style.fieldset" :disabled="areChoicesDisabled">
        <label v-if="canCreateViewing" :class="$style.createViewing">
          <input v-model="recordNewViewing" type="checkbox" :disabled="areChoicesDisabled" :aria-describedby="creationDescriptionId">
          Record a new viewing
        </label>
        <p v-if="canCreateViewing" :id="creationDescriptionId" :class="$style.supporting">Create a completed viewing with this score.</p>
        <legend :class="$style.accessible">Choose a score</legend>
        <div :class="$style.choices">
          <AppButton
            v-for="option in choices"
            :key="option.score"
            :class="$style.choice"
            :aria-label="option.label"
            :aria-pressed="option.isSelected"
            :disabled="areChoicesDisabled"
            variant="secondary"
            @click="persist(option.score)"
          >
            <span aria-hidden="true">{{ option.score }}</span>
          </AppButton>
        </div>
        <AppButton v-if="showRemove" :class="$style.remove" :disabled="areChoicesDisabled" :aria-label="removeLabel" variant="secondary" @click="persist(null)">
          <Icon aria-hidden="true" mode="svg" name="hugeicons:delete-02" />
          {{ removeLabel }}
        </AppButton>
        <p v-if="showRemoveDescription" :class="$style.supporting">{{ removeDescription }}</p>
      </fieldset>
      <p v-if="isSaving" :class="$style.pending" role="status">Updating rating…</p>
      <AppMessage v-if="saveError" :class="$style.saveError" role="alert" tone="danger">{{ saveError }}</AppMessage>
      <AppButton v-if="showSaveRecovery" :disabled="isSaving" variant="secondary" @click="refreshAfterError">Refresh rating</AppButton>
    </component>
  </section>
</template>

<script lang="ts" setup>
  /* oxlint-disable eslint/max-lines -- One editor coordinates responsive overlays, score writes, combined creation recovery and focus. */
  import type { RouteLocationRaw } from 'vue-router'
  import { onClickOutside, useEventListener, useMediaQuery, useScrollLock } from '@vueuse/core'
  import { computed, nextTick, onBeforeUnmount, ref, useId, useTemplateRef, watch } from 'vue'
  import AppButton from '~/components/ui/AppButton.vue'
  import AppMessage from '~/components/ui/AppMessage.vue'
  import type { RatingStatus } from '~/composables/use-catalog-rating.ts'

  interface Props {
    accountId: string | null;

    // Stable title identity while a combined save changes the current viewing.
    contextKey?: string | null;
    createViewing?: (score: number) => Promise<boolean>;
    canRemove?: boolean;
    removeLabel?: string;
    removeDescription?: string;
    hasUnconfirmedCreation?: boolean;
    retryCreation?: () => Promise<boolean>;
    label?: string;
    actionLabel?: string;
    showScore?: boolean;
    compact?: boolean;
    showLoadError?: boolean;
    targetKey: string | null;
    hasSessionError: boolean;
    isAnonymous: boolean;
    isActive?: boolean;
    isSaving: boolean;
    load: () => Promise<void>;
    save: (nextScore: number | null) => Promise<boolean>;
    saveError: string;
    score: number | null;
    signInLocation: RouteLocationRaw;
    status: RatingStatus;
  }

  interface Emits {
    clearError: [];
    saved: [targetKey: string];
  }

  const { contextKey, createViewing, canRemove, removeLabel = 'Remove rating', removeDescription, hasUnconfirmedCreation, retryCreation, label = 'Your rating', actionLabel = 'Rate', showScore, compact, showLoadError = true, isActive = true, accountId, targetKey, hasSessionError, isAnonymous, isSaving, load, save, saveError, score, status } = defineProps<Props>()
  const emit = defineEmits<Emits>()
  const currentAccountId = computed(() => accountId)
  const currentTargetKey = computed(() => targetKey)
  const isEditing = ref(false)
  const recordNewViewing = ref(false)
  const creationDescriptionId = useId()
  const currentIdentity = computed(() => contextKey ?? targetKey)
  const showSaveRecovery = computed(() => saveError !== '' && !hasUnconfirmedCreation)
  const canCreateViewing = computed(() => createViewing !== undefined)
  const areChoicesDisabled = computed(() => isSaving || hasUnconfirmedCreation)
  const isMobile = useMediaQuery('(width < 40rem)')
  const notice = ref('')
  const panelId = useId()
  const anchorName = `--catalog-rating-${panelId}`
  const headingId = useId()
  const anchor = useTemplateRef('anchor')
  const trigger = useTemplateRef('trigger')
  const panel = useTemplateRef<HTMLElement>('panel')
  const documentRoot = computed(() => anchor.value?.ownerDocument.documentElement)
  const scrollLocked = useScrollLock(documentRoot)
  const options = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  const isLoaded = computed(() => status === 'loaded')
  const isLoading = computed(() => !isAnonymous && !hasSessionError && (status === 'loading' || status === 'idle'))
  const hasLoadError = computed(() => !isAnonymous && !hasSessionError && status === 'error')
  const showRatingLoadError = computed(() => hasLoadError.value && showLoadError)
  const hasScore = computed(() => score !== null)
  const showRemove = computed(() => !recordNewViewing.value && (hasScore.value || canRemove))
  const showRemoveDescription = computed(() => showRemove.value && Boolean(removeDescription))
  const canEdit = computed(() => isActive && accountId !== null && !hasSessionError && isLoaded.value && !isSaving)
  const isBusy = computed(() => isLoading.value || isSaving)
  const isTriggerDisabled = computed(() => !canEdit.value && !hasLoadError.value)
  const controlledPanelId = computed(() => isEditing.value ? panelId : undefined)
  const panelTag = computed(() => isMobile.value ? 'dialog' : 'div')
  const presentation = computed(() => isMobile.value ? 'sheet' : 'popover')
  const popoverMode = computed(() => isMobile.value ? undefined : 'manual')
  const visibleActionLabel = computed(() => compact ? 'Rate' : actionLabel)
  const triggerVariant = computed(() => compact ? 'secondary' : 'primary')
  const triggerSize = computed(() => compact ? 'small' : 'medium')

  const choices = computed(() => options.map(option => {
    const choiceLabel = `${option} out of 10`

    return {
      score: option,
      label: choiceLabel,
      isSelected: !recordNewViewing.value && option === score
    }
  }))

  let contextVersion = 0

  const triggerLabel = computed(() => {
    if (hasSessionError) {
      return 'Rating unavailable'
    }

    if (hasLoadError.value) {
      return 'Retry rating'
    }

    if (showScore && isLoaded.value && score !== null) {
      const scoreLabel = compact ? `${score}/10` : `Your rating: ${score}/10`

      return scoreLabel
    }

    return visibleActionLabel.value
  })

  const accessibleTriggerLabel = computed(() => {
    if (isLoading.value) {
      const loadingLabel = `${actionLabel}, loading rating…`

      return loadingLabel
    }

    if (!isLoaded.value || hasSessionError || score === null) {
      const action = hasSessionError || hasLoadError.value ? triggerLabel.value : actionLabel

      return showScore ? `${action}, ${label}` : triggerLabel.value
    }

    return showScore ? `${label}: ${score} out of 10` : `${actionLabel}, your rating: ${score} out of 10`
  })

  function focusChoice(): void {
    if (hasUnconfirmedCreation) {
      panel.value?.querySelector<HTMLButtonElement>('[data-rating-retry]')?.focus()

      return
    }

    const selected = panel.value?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')
    const first = panel.value?.querySelector<HTMLButtonElement>('button[aria-pressed]')
    const target = selected ?? first

    target?.focus()
  }

  function presentPanel(restoreFocus = true): void {
    const element = panel.value

    if (!isEditing.value || element === null) { return }

    if (element instanceof globalThis.HTMLDialogElement) {
      if (!element.open) { element.showModal() }
    } else if (!element.matches(':popover-open')) { element.showPopover() }

    if (restoreFocus) { focusChoice() }
  }

  function hidePanel(): void {
    scrollLocked.value = false

    const element = panel.value

    if (element === null) {
      return
    }

    if (element instanceof globalThis.HTMLDialogElement) {
      if (element.open) {
        element.close()
      }
    } else if (element.matches(':popover-open')) {
      element.hidePopover()
    }
  }

  function dismiss(): void {
    if (!isEditing.value || isSaving) {
      return
    }

    hidePanel()

    isEditing.value = false

    emit('clearError')
    trigger.value?.focus()
  }

  function onBackdropClick(event: MouseEvent): void {
    const element = panel.value

    if (!isMobile.value || element === null || event.target !== element) {
      return
    }

    const rectangle = element.getBoundingClientRect()
    const isOutsideHorizontally = event.clientX < rectangle.left || event.clientX > rectangle.right
    const isOutsideVertically = event.clientY < rectangle.top || event.clientY > rectangle.bottom
    const isOutside = isOutsideHorizontally || isOutsideVertically

    if (isOutside) {
      dismiss()
    }
  }

  function canRestoreFocus(owner: Element | null): boolean {
    const { activeElement, body: documentBody } = globalThis.document
    const ownsFocus = activeElement === owner || activeElement === documentBody || activeElement === panel.value

    return isActive && ownsFocus
  }

  async function activate(): Promise<void> {
    if (hasLoadError.value) {
      const focusOwner = globalThis.document.activeElement
      const version = contextVersion

      await load()
      await nextTick()

      const restoreFocus = version === contextVersion && canRestoreFocus(focusOwner)

      if (restoreFocus) {
        trigger.value?.focus()
      }

      return
    }

    if (!canEdit.value) {
      return
    }

    if (isEditing.value) {
      dismiss()

      return
    }

    emit('clearError')

    notice.value = ''
    isEditing.value = true
  }

  async function saveRequestedScore(nextScore: number | null, creating: boolean): Promise<boolean> {
    if (creating && createViewing !== undefined && nextScore !== null) { return createViewing(nextScore) }

    return save(nextScore)
  }
  function restoreFailedMutationFocus(owner: Element | null, selector: string, allowed: boolean): void {
    if (!isEditing.value || saveError === '' || !allowed) { return }

    if (hasUnconfirmedCreation) {
      focusChoice()

      return
    }

    if (!(owner instanceof globalThis.HTMLElement)) { return }

    const target = owner.isConnected ? owner : panel.value?.querySelector<HTMLButtonElement>(selector)

    target?.focus()
  }
  async function refreshAfterError(): Promise<void> {
    const owner = globalThis.document.activeElement

    await load()
    await nextTick()

    const restoreFocus = canRestoreFocus(owner)

    // A paged record can move its anchor outside the viewport during refresh.
    if (restoreFocus && !isMobile.value) { anchor.value?.scrollIntoView({ block: 'nearest' }) }

    presentPanel(restoreFocus)
  }

  async function persist(nextScore: number | null): Promise<void> {
    const savedTargetKey = targetKey
    const savedAccountId = accountId
    const savedIdentity = currentIdentity.value
    const creating = recordNewViewing.value && createViewing !== undefined && nextScore !== null
    const mutationLabel = nextScore === null ? removeLabel : `${nextScore} out of 10`
    const mutationSelector = `button[aria-label="${mutationLabel}"]`
    const focusOwner = globalThis.document.activeElement
    const version = contextVersion

    notice.value = ''

    const saved = await saveRequestedScore(nextScore, creating)

    await nextTick()

    const sameCreationIdentity = creating && saved && savedAccountId === accountId && savedIdentity === currentIdentity.value

    if (version !== contextVersion && !sameCreationIdentity) { return }

    const restoreFocus = canRestoreFocus(focusOwner)

    if (!saved) {
      restoreFailedMutationFocus(focusOwner, mutationSelector, restoreFocus)

      return
    }

    hidePanel()

    isEditing.value = false
    notice.value = nextScore === null ? 'Rating removed.' : 'Rating saved.'

    if (creating) { notice.value = 'Viewing and rating saved.' }

    const completedTargetKey = creating ? targetKey : savedTargetKey

    if (completedTargetKey !== null) { emit('saved', completedTargetKey) }

    if (restoreFocus) {
      trigger.value?.focus()
    }
  }

  async function retryUnconfirmed(): Promise<void> {
    if (retryCreation === undefined) { return }

    const savedAccountId = accountId
    const savedIdentity = currentIdentity.value
    const focusOwner = globalThis.document.activeElement
    const saved = await retryCreation()

    if (!saved || accountId !== savedAccountId || currentIdentity.value !== savedIdentity) { return }

    hidePanel()

    isEditing.value = false
    notice.value = 'Viewing and rating saved.'

    if (canRestoreFocus(focusOwner)) { trigger.value?.focus() }
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (!isEditing.value) {
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      dismiss()

      return
    }

    if (!isMobile.value || event.key !== 'Tab') {
      return
    }

    const buttons = panel.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
    const first = buttons?.item(0)
    const lastIndex = (buttons?.length ?? 0) - 1
    const last = buttons?.item(lastIndex)
    const { activeElement } = globalThis.document
    const wrapBackward = event.shiftKey && activeElement === first
    const wrapForward = !event.shiftKey && activeElement === last

    if (first === null || first === undefined || last === null || last === undefined) {
      event.preventDefault()

      return
    }

    if (wrapBackward || wrapForward) {
      event.preventDefault()

      const target = event.shiftKey ? last : first

      target.focus()
    }
  }

  watch([currentAccountId, currentTargetKey], () => {
    contextVersion += 1

    hidePanel()

    isEditing.value = false
    notice.value = ''
  }, { flush: 'sync' })

  watch(() => isActive, active => {
    if (!active) {
      hidePanel()

      isEditing.value = false
      notice.value = ''
    }
  }, { flush: 'sync' })

  watch([isEditing, isMobile], () => {
    scrollLocked.value = isEditing.value && isMobile.value

    presentPanel()
  }, { flush: 'post' })

  watch(isEditing, (editing, _previousEditing, onCleanup) => {
    if (!editing) {
      recordNewViewing.value = false

      return
    }

    const stopClickOutside = onClickOutside(panel, () => {
      if (!isMobile.value) {
        dismiss()
      }
    }, { ignore: [anchor] })

    const stopKeydown = useEventListener('keydown', handleKeydown)

    onCleanup(() => {
      stopClickOutside()
      stopKeydown()
    })
  }, { flush: 'post' })

  onBeforeUnmount(hidePanel)
</script>

<style module>
  @layer reset, vendor, tokens, base, components, utilities;

  @layer components {
    .component { display: grid; align-content: start; gap: var(--space-2); min-inline-size: 0; }
    .anchor { inline-size: 100%; }
    .trigger, .link {
      inline-size: 100%;
      text-decoration: none;
    }
    .trigger { anchor-name: var(--rating-anchor); }
    .link {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--space-2);
      min-block-size: 3rem;
      padding: var(--space-2) var(--space-3);
      border: 1px solid transparent;
      border-radius: var(--radius-md);
      background: var(--color-accent-fill);
      color: var(--color-on-accent);
      font-weight: 600;
      cursor: pointer;
    }
    .link:hover { filter: brightness(0.96); }
    .star { flex: 0 0 auto; inline-size: 1.25rem; block-size: 1.25rem; }
    .component:global(.is-compact) {
      .link { min-block-size: 2.75rem; border-radius: var(--radius-sm); font-size: 0.875rem; }
      .trigger { font-variant-numeric: tabular-nums; }
      .link { border: 1px solid var(--color-border-strong); background: var(--color-surface); color: var(--color-text-primary); }
      &:global(.is-rated) .trigger { border-color: var(--color-accent); background: var(--color-surface-selected); color: var(--color-text-primary); }
      &:global(.is-rated) .trigger :global(svg) { color: var(--color-accent); }
    }
    .loadError { max-inline-size: 18rem; margin-block-start: var(--space-3); }
    .accessible { position: absolute; inline-size: 1px; block-size: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    .panel { position: fixed; padding: min(var(--space-4), 16px); margin: 0; overflow: auto; border: 1px solid var(--color-border); background: var(--color-surface); color: var(--color-text-primary); }
    /* Leave the 8px anchor gap and 16px viewport gutter inside the chosen position area. */
    .panel[data-presentation='popover'] { position-anchor: var(--rating-anchor); position-area: block-end span-inline-end; position-try-fallbacks: flip-block, flip-inline, flip-block flip-inline; position-try-order: most-block-size; inset: auto; inline-size: min(20rem, calc(100vw - 2rem)); max-block-size: min(calc(100% - 24px), calc(100dvh - 2rem)); margin: 8px 16px; border-radius: var(--radius-lg); box-shadow: var(--shadow-float); }
    .panel[data-presentation='sheet'] { inset-block: auto 0; inset-inline: 0; inline-size: 100%; max-inline-size: none; max-block-size: calc(100dvh - 2rem); padding-block-end: max(var(--space-4), env(safe-area-inset-bottom)); border-radius: var(--radius-lg) var(--radius-lg) 0 0; }
    .panel[data-presentation='sheet']::backdrop { background: var(--color-backdrop); }
    .header { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); margin-block-end: var(--space-3); }
    .heading { font-size: 1.125rem; font-weight: 600; }
    .header > .close { flex: 0 0 auto; min-inline-size: 2.75rem; min-block-size: 2.75rem; padding: var(--space-2); border: 0; background: transparent; }
    .fieldset { min-inline-size: 0; padding: 0; border: 0; }
    .choices { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: min(var(--space-2), 8px); }
    .choices > .choice { min-inline-size: 44px; min-block-size: 2.75rem; padding: var(--space-2) 4px; border-radius: var(--radius-sm); font-weight: 400; font-variant-numeric: tabular-nums; }
    .choices > .choice[aria-pressed='true'] { border-color: var(--color-accent); background: var(--color-accent-fill); color: var(--color-on-accent); font-weight: 700; }
    .fieldset > .remove { justify-content: start; inline-size: 100%; min-block-size: 2.75rem; padding: var(--space-3) 0 0; margin-block-start: var(--space-4); border: 0; border-block-start: 1px solid var(--color-border); border-radius: 0; background: transparent; color: var(--color-danger); font-size: 0.875rem; }
    .createViewing { display: flex; align-items: center; gap: var(--space-2); min-block-size: 2.75rem; cursor: pointer; }
    .createViewing input { inline-size: 1.25rem; block-size: 1.25rem; accent-color: var(--color-accent); }
    .supporting { margin-block: var(--space-2); color: var(--color-text-secondary); font-size: 0.875rem; }
    .recovery { display: grid; gap: var(--space-3); margin-block-end: var(--space-3); }
    .pending, .saveError { margin-block-start: var(--space-3); font-size: 0.875rem; }
    .pending { color: var(--color-text-secondary); }
    @media (forced-colors: active) {
      .choices > .choice[aria-pressed='true'] { border-color: Highlight; outline: 1px solid Highlight; }
    }
  }
</style>
