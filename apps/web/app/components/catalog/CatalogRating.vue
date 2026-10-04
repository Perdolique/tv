<template>
  <section :class="$style.component" :style="{ '--rating-anchor': anchorName }" aria-label="Your rating">
    <div ref="anchor" :class="$style.anchor">
      <NuxtLink v-if="isAnonymous" :class="$style.link" :to="signInLocation">
        <Icon :class="$style.star" aria-hidden="true" mode="svg" name="hugeicons:star" />
        Rate
      </NuxtLink>
      <AppButton
        v-else
        ref="trigger"
        :class="$style.trigger"
        :disabled="isTriggerDisabled"
        :aria-busy="isBusy || undefined"
        :aria-label="accessibleTriggerLabel"
        :aria-controls="controlledPanelId"
        :aria-expanded="isEditing"
        aria-haspopup="dialog"
        type="button"
        @click="activate"
      >
        <Icon :class="$style.star" aria-hidden="true" mode="svg" name="hugeicons:star" />
        {{ triggerLabel }}
      </AppButton>
    </div>
    <AppMessage v-if="hasLoadError" :class="$style.loadError" role="alert" tone="danger">We couldn’t load your rating. Try again.</AppMessage>
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
        <h2 :id="headingId" :class="$style.heading">Your rating</h2>
        <AppButton :class="$style.close" :disabled="isSaving" aria-label="Close rating" variant="secondary" @click="dismiss">
          <Icon aria-hidden="true" mode="svg" name="hugeicons:cancel-01" />
        </AppButton>
      </div>
      <fieldset :class="$style.fieldset" :disabled="isSaving">
        <legend :class="$style.accessible">Choose a score</legend>
        <div :class="$style.choices">
          <AppButton
            v-for="option in choices"
            :key="option.score"
            :class="$style.choice"
            :aria-label="option.label"
            :aria-pressed="option.isSelected"
            :disabled="isSaving"
            variant="secondary"
            @click="persist(option.score)"
          >
            <span aria-hidden="true">{{ option.score }}</span>
          </AppButton>
        </div>
        <AppButton v-if="hasScore" :class="$style.remove" :disabled="isSaving" aria-label="Remove rating" variant="secondary" @click="persist(null)">
          <Icon aria-hidden="true" mode="svg" name="hugeicons:delete-02" />
          Remove rating
        </AppButton>
      </fieldset>
      <p v-if="isSaving" :class="$style.pending" role="status">Updating rating…</p>
      <AppMessage v-if="saveError" :class="$style.saveError" role="alert" tone="danger">{{ saveError }}</AppMessage>
    </component>
  </section>
</template>

<script lang="ts" setup>
  import type { RouteLocationRaw } from 'vue-router'
  import { onClickOutside, useEventListener, useMediaQuery, useScrollLock } from '@vueuse/core'
  import { computed, nextTick, onBeforeUnmount, ref, useId, useTemplateRef, watch } from 'vue'
  import AppButton from '~/components/ui/AppButton.vue'
  import AppMessage from '~/components/ui/AppMessage.vue'
  import type { RatingStatus } from '~/composables/use-catalog-rating.ts'

  interface Props {
    accountId: string | null;
    catalogItemId: string | null;
    hasSessionError: boolean;
    isAnonymous: boolean;
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
    saved: [catalogItemId: string];
  }

  const { accountId, catalogItemId, hasSessionError, isAnonymous, isSaving, load, save, saveError, score, status } = defineProps<Props>()
  const emit = defineEmits<Emits>()
  const currentAccountId = computed(() => accountId)
  const itemId = computed(() => catalogItemId)
  const isEditing = ref(false)
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
  const hasScore = computed(() => score !== null)
  const canEdit = computed(() => accountId !== null && !hasSessionError && isLoaded.value && !isSaving)
  const isBusy = computed(() => isLoading.value || isSaving)
  const isTriggerDisabled = computed(() => !canEdit.value && !hasLoadError.value)
  const controlledPanelId = computed(() => isEditing.value ? panelId : undefined)
  const panelTag = computed(() => isMobile.value ? 'dialog' : 'div')
  const presentation = computed(() => isMobile.value ? 'sheet' : 'popover')
  const popoverMode = computed(() => isMobile.value ? undefined : 'manual')

  const choices = computed(() => options.map(option => {
    const label = `${option} out of 10`

    return {
      score: option,
      label,
      isSelected: option === score
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

    return 'Rate'
  })

  const accessibleTriggerLabel = computed(() => {
    if (isLoading.value) {
      return 'Rate, loading rating…'
    }

    if (!isLoaded.value || hasSessionError || score === null) {
      return triggerLabel.value
    }

    return `Rate, your rating: ${score} out of 10`
  })

  function focusChoice(): void {
    const selected = panel.value?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')
    const first = panel.value?.querySelector<HTMLButtonElement>('button[aria-pressed]')
    const target = selected ?? first

    target?.focus()
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

    return ownsFocus
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

  async function persist(nextScore: number | null): Promise<void> {
    const savedCatalogItemId = catalogItemId
    const mutationLabel = nextScore === null ? 'Remove rating' : `${nextScore} out of 10`
    const mutationSelector = `button[aria-label="${mutationLabel}"]`
    const focusOwner = globalThis.document.activeElement
    const version = contextVersion

    notice.value = ''

    const saved = await save(nextScore)

    await nextTick()

    if (version !== contextVersion) {
      return
    }

    const restoreFocus = canRestoreFocus(focusOwner)

    if (!saved) {
      const restoreEditorFocus = isEditing.value && saveError !== '' && restoreFocus && focusOwner instanceof globalThis.HTMLElement

      if (restoreEditorFocus) {
        const target = focusOwner.isConnected ? focusOwner : panel.value?.querySelector<HTMLButtonElement>(mutationSelector)

        target?.focus()
      }

      return
    }

    hidePanel()

    isEditing.value = false
    notice.value = nextScore === null ? 'Rating removed.' : 'Rating saved.'

    if (savedCatalogItemId !== null) {
      emit('saved', savedCatalogItemId)
    }

    if (restoreFocus) {
      trigger.value?.focus()
    }
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

  watch([currentAccountId, itemId], () => {
    contextVersion += 1

    hidePanel()

    isEditing.value = false
    notice.value = ''
  }, { flush: 'sync' })

  watch([isEditing, isMobile], () => {
    scrollLocked.value = isEditing.value && isMobile.value

    if (!isEditing.value || panel.value === null) {
      return
    }

    const element = panel.value

    if (element instanceof globalThis.HTMLDialogElement) {
      if (!element.open) {
        element.showModal()
      }
    } else if (!element.matches(':popover-open')) {
      element.showPopover()
    }

    focusChoice()
  }, { flush: 'post' })

  onClickOutside(panel, () => {
    if (!isMobile.value) {
      dismiss()
    }
  }, { ignore: [anchor] })

  useEventListener('keydown', handleKeydown)
  onBeforeUnmount(hidePanel)
</script>

<style module>
  @layer reset, vendor, tokens, base, components, utilities;

  @layer components {
    .component { display: grid; align-content: start; gap: var(--space-2); min-inline-size: 0; }
    .anchor { inline-size: 100%; }
    .trigger, .link {
      min-block-size: 3rem;
      inline-size: 100%;
      padding: var(--space-3) var(--space-5);
      font-size: 1rem;
      font-weight: 600;
      text-decoration: none;
    }
    .trigger { anchor-name: var(--rating-anchor); }
    .link {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--space-2);
      border: 0;
      border-radius: var(--radius-md);
      background: var(--color-accent-fill);
      color: var(--color-on-accent);
      cursor: pointer;
    }
    .link:hover { filter: brightness(0.96); }
    .star { flex: 0 0 auto; inline-size: 1.5rem; block-size: 1.5rem; }
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
    .pending, .saveError { margin-block-start: var(--space-3); font-size: 0.875rem; }
    .pending { color: var(--color-text-secondary); }
    @media (forced-colors: active) {
      .choices > .choice[aria-pressed='true'] { border-color: Highlight; outline: 1px solid Highlight; }
    }
  }
</style>
