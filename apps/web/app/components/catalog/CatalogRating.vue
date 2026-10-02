<template>
  <section :class="$style.component" :aria-labelledby="headingId">
    <div :class="$style.summary">
      <Icon :class="$style.icon" aria-hidden="true" mode="svg" name="hugeicons:star" />
      <div>
        <h2 :id="headingId" :class="$style.heading">Your rating</h2>
        <p v-if="isAnonymous" :class="$style.supporting">Sign in to rate this title.</p>
        <p v-else-if="hasSessionError" :class="$style.supporting">Rating unavailable.</p>
        <p v-else-if="isLoading" :class="$style.supporting" aria-busy="true">Loading rating…</p>
        <p v-else-if="isLoaded" :class="$style.score">{{ scoreLabel }}</p>
      </div>
    </div>
    <template v-if="hasLoadError">
      <AppMessage role="alert" tone="danger">We couldn’t load your rating. Try again.</AppMessage>
      <AppButton variant="secondary" @click="retry">Retry rating</AppButton>
    </template>
    <p :class="$style.notice" role="status">{{ notice }}</p>
    <form v-if="isEditing" ref="form" :class="$style.form" @submit.prevent="submit">
      <fieldset :class="$style.fieldset" :disabled="isSaving">
        <legend :class="$style.legend">Choose a score</legend>
        <div :class="$style.choices">
          <label v-for="option in options" :key="option" :class="$style.choice">
            <input v-model="draft" :class="$style.input" :name="inputName" :value="option" type="radio" required>
            <span aria-hidden="true">{{ option }}</span>
            <span :class="$style.accessibleLabel">{{ option }} out of 10</span>
          </label>
        </div>
        <div :class="$style.actions">
          <AppButton type="submit" :disabled="cannotSave" :aria-busy="isSaving || undefined">Save rating</AppButton>
          <AppButton :disabled="isSaving" variant="secondary" @click="cancel">Cancel</AppButton>
          <button v-if="hasScore" :class="$style.remove" :disabled="isSaving" type="button" @click="remove">Remove rating</button>
        </div>
      </fieldset>
      <AppMessage v-if="saveError" role="alert" tone="danger">{{ saveError }}</AppMessage>
    </form>
  </section>
</template>

<script lang="ts" setup>
  import { computed, nextTick, ref, useId, useTemplateRef, watch } from 'vue'
  import AppButton from '~/components/ui/AppButton.vue'
  import AppMessage from '~/components/ui/AppMessage.vue'
  import { useCatalogRating } from '~/composables/use-catalog-rating.ts'

  interface Props {
    accountId: string | null;
    catalogItemId: string | null;
    hasSessionError: boolean;
    isAnonymous: boolean;
  }

  interface Emits {
    focusAction: [];
    unauthorized: [reason: 'load' | 'mutation'];
  }

  const { accountId, catalogItemId, hasSessionError, isAnonymous } = defineProps<Props>()
  const emit = defineEmits<Emits>()
  const currentAccountId = computed(() => accountId)
  const itemId = computed(() => catalogItemId)
  const { isSaving, load, save, saveError, score, status, unauthorized } = useCatalogRating(itemId, currentAccountId)
  const isEditing = ref(false)
  const draft = ref<number | null>(null)
  const notice = ref('')
  const headingId = useId()
  const inputName = useId()
  const form = useTemplateRef('form')
  const options = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  const isLoaded = computed(() => status.value === 'loaded')
  const isLoading = computed(() => status.value === 'loading' || status.value === 'idle')
  const hasLoadError = computed(() => !isAnonymous && !hasSessionError && status.value === 'error')
  const hasScore = computed(() => score.value !== null)
  const canEdit = computed(() => accountId !== null && isLoaded.value && !isSaving.value)
  const cannotSave = computed(() => isSaving.value || draft.value === null || draft.value === score.value)
  const scoreLabel = computed(() => score.value === null ? 'Not rated' : `${score.value} / 10`)

  watch([currentAccountId, itemId], () => {
    isEditing.value = false
    draft.value = null
    notice.value = ''
  }, { flush: 'sync' })

  watch(unauthorized, reason => {
    if (reason !== null) {
      emit('unauthorized', reason)
    }
  }, { flush: 'sync' })

  function canRestoreFocus(owner: Element | null): boolean {
    const { activeElement } = globalThis.document

    return activeElement === owner || activeElement === globalThis.document.body
  }

  async function open(): Promise<void> {
    if (!canEdit.value) {
      return
    }

    draft.value = score.value
    saveError.value = ''
    notice.value = ''
    isEditing.value = true

    await nextTick()

    const selected = form.value?.querySelector<HTMLInputElement>('input:checked')
    const first = form.value?.querySelector<HTMLInputElement>('input')
    const focusTarget = selected ?? first

    focusTarget?.focus()
  }

  function cancel(): void {
    if (isSaving.value) {
      return
    }

    draft.value = score.value
    saveError.value = ''
    isEditing.value = false

    emit('focusAction')
  }

  async function persist(nextScore: number | null): Promise<void> {
    const focusOwner = globalThis.document.activeElement

    notice.value = ''

    const saved = await save(nextScore)

    if (!saved) {
      return
    }

    const restoreFocus = canRestoreFocus(focusOwner)

    isEditing.value = false
    notice.value = nextScore === null ? 'Rating removed.' : 'Rating saved.'

    if (restoreFocus) {
      emit('focusAction')
    }
  }

  async function submit(): Promise<void> {
    if (!cannotSave.value) {
      await persist(draft.value)
    }
  }

  async function remove(): Promise<void> {
    if (hasScore.value && !isSaving.value) {
      await persist(null)
    }
  }

  async function retry(): Promise<void> {
    const focusOwner = globalThis.document.activeElement

    await load()

    if (status.value !== 'error' && canRestoreFocus(focusOwner)) {
      emit('focusAction')
    }
  }

  defineExpose({
    canEdit,
    isEditing,
    open
  })
</script>

<style module>
  @layer reset, vendor, tokens, base, components, utilities;

  @layer components {
    .component {
      align-self: start;
      min-inline-size: 0;
      padding: var(--space-4);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      background: var(--color-surface);
    }
    .summary { display: flex; align-items: center; gap: var(--space-4); }
    .icon { flex: 0 0 auto; inline-size: 2rem; block-size: 2rem; color: var(--color-accent); }
    .heading { color: var(--color-text-secondary); font-size: 0.875rem; font-weight: 500; }
    .supporting { min-block-size: 1.875rem; margin-block-start: var(--space-1); color: var(--color-text-secondary); }
    .score { margin-block-start: var(--space-1); font-size: 1.25rem; font-weight: 600; font-variant-numeric: tabular-nums; }
    .notice { color: var(--color-success); font-size: 0.875rem; }
    .notice:not(:empty) { margin-block-start: var(--space-3); }
    .form { margin-block-start: var(--space-4); }
    .fieldset { min-inline-size: 0; margin: 0; padding: 0; border: 0; }
    .legend { padding: 0; margin-block-end: var(--space-3); font-size: 0.875rem; }
    .choices { display: grid; grid-template-columns: repeat(auto-fit, minmax(2.75rem, 1fr)); gap: var(--space-2); }
    .choice {
      position: relative;
      display: grid;
      place-items: center;
      min-block-size: 2.75rem;
      border: 1px solid var(--color-border-strong);
      border-radius: var(--radius-sm);
      font-variant-numeric: tabular-nums;
      cursor: pointer;
      &:has(:checked) { border-color: var(--color-accent); background: var(--color-surface-selected); font-weight: 700; }
      &:has(:focus-visible) { outline: 2px solid var(--color-focus); outline-offset: 3px; }
      &:has(:disabled) { cursor: not-allowed; }
    }
    .input { position: absolute; inset: 0; inline-size: 100%; block-size: 100%; margin: 0; opacity: 0; cursor: inherit; }
    .accessibleLabel { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    .actions { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-block-start: var(--space-4); }
    .remove { min-block-size: 2.75rem; padding: var(--space-2); border: 0; background: transparent; color: var(--color-danger); text-decoration: underline; text-underline-offset: 0.25em; cursor: pointer; }
    .remove:disabled { color: var(--color-text-secondary); cursor: not-allowed; }
    @media (forced-colors: active) {
      .choice:has(:checked) { border-color: Highlight; outline: 1px solid Highlight; }
    }
  }
</style>
