<template>
  <section
    :class="$style.component"
    :data-presentation="presentation"
    :style="{ '--rating-anchor': anchorName }"
    aria-label="TV viewer rating"
  >
    <p :class="$style.label">TV viewer rating</p>
    <div v-if="summary">
      <button
        ref="trigger"
        :aria-describedby="descriptionId"
        :aria-label="triggerLabel"
        :class="$style.trigger"
        type="button"
        @blur="onBlur"
        @click="activate"
        @focus="onFocus"
        @pointerenter="onTriggerEnter"
        @pointerleave="onTriggerLeave"
      >
        <Icon aria-hidden="true" mode="svg" name="hugeicons:star" />
        {{ scoreLabel }}
      </button>
      <div
        :id="tooltipId"
        ref="tooltip"
        :class="$style.tooltip"
        :hidden="!isOpen"
        popover="manual"
        role="tooltip"
        @pointerenter="onTooltipEnter"
        @pointerleave="onTooltipLeave"
      >{{ countLabel }}</div>
    </div>
    <p v-else-if="!hasError" :class="$style.placeholder" aria-busy="true">Loading viewer rating…</p>
    <div v-if="hasError" :class="$style.error">
      <AppMessage role="alert" tone="danger">{{ errorLabel }}</AppMessage>
      <AppButton ref="retryButton" :disabled="isLoading" aria-label="Retry viewer rating" variant="secondary" @click="retry">Retry</AppButton>
    </div>
  </section>
</template>

<script lang="ts" setup>
  import type { CatalogRatingSummaryResponse } from '@tv/shared/catalog'
  import { onClickOutside, useEventListener, useMediaQuery, useTimeoutFn } from '@vueuse/core'
  import { computed, nextTick, onBeforeUnmount, ref, useId, useTemplateRef, watch } from 'vue'
  import AppButton from '~/components/ui/AppButton.vue'
  import AppMessage from '~/components/ui/AppMessage.vue'

  interface Props {
    hasError: boolean;
    isLoading: boolean;
    presentation?: 'inline' | 'card';
    summary?: CatalogRatingSummaryResponse;
  }

  interface Emits {
    retry: [];
  }

  const { summary, hasError, isLoading, presentation = 'inline' } = defineProps<Props>()
  const emit = defineEmits<Emits>()
  const tooltipId = useId()
  const anchorName = `--rating-summary-${tooltipId}`
  const trigger = useTemplateRef('trigger')
  const tooltip = useTemplateRef('tooltip')
  const retryButton = useTemplateRef('retryButton')
  const isOpen = ref(false)
  const isPinned = ref(false)
  const isHovered = ref(false)
  const isTooltipHovered = ref(false)
  const isFocused = ref(false)
  const isDismissed = ref(false)
  const isDesktop = useMediaQuery('(width >= 64rem)')
  const isPresented = computed(() => presentation === 'card' ? isDesktop.value : !isDesktop.value)
  const descriptionId = computed(() => isOpen.value ? tooltipId : undefined)
  const errorLabel = computed(() => summary === undefined ? 'Viewer rating unavailable' : 'Viewer rating update failed. Try again.')
  const scoreFormatter = new Intl.NumberFormat('en', { maximumFractionDigits: 1 })

  const scoreLabel = computed(() => {
    const averageScore = summary?.averageScore

    if (averageScore === null || averageScore === undefined) {
      return 'Not rated'
    }

    return scoreFormatter.format(averageScore)
  })

  const triggerLabel = computed(() => {
    const hasScore = summary?.averageScore !== null && summary?.averageScore !== undefined
    const description = hasScore ? `${scoreLabel.value} out of 10` : scoreLabel.value

    return `TV viewer rating: ${description}`
  })

  const countFormatter = new Intl.NumberFormat('en')
  let retryFocusOwner: Element | null = null

  const countLabel = computed(() => {
    const count = summary?.ratingCount ?? 0
    const formattedCount = countFormatter.format(count)
    const unit = count === 1 ? 'rating' : 'ratings'

    return `${formattedCount} ${unit}`
  })

  const { start: scheduleClose, stop: cancelClose } = useTimeoutFn(() => {
    if (!isPinned.value && !isHovered.value && !isTooltipHovered.value && !isFocused.value) {
      isOpen.value = false
      isDismissed.value = false
    }
  }, 120, { immediate: false })

  function show(): void {
    cancelClose()

    if (!isDismissed.value) {
      isOpen.value = true
    }
  }

  function dismiss(): void {
    cancelClose()

    isPinned.value = false
    isOpen.value = false
    isTooltipHovered.value = false
    isDismissed.value = isHovered.value || isFocused.value
  }

  function hidePopover(): void {
    const element = tooltip.value

    if (element?.matches(':popover-open')) {
      element.hidePopover()
    }
  }

  function activate(): void {
    if (isPinned.value) {
      dismiss()

      return
    }

    cancelClose()

    // Focus may already have opened the tooltip before the first tap or key activation.
    isDismissed.value = false
    isPinned.value = true
    isOpen.value = true
  }

  function retry(): void {
    retryFocusOwner = globalThis.document.activeElement

    emit('retry')
  }

  function onFocus(): void {
    isFocused.value = true

    show()
  }

  function onBlur(): void {
    isFocused.value = false

    scheduleClose()
  }

  function onTriggerEnter(event: PointerEvent): void {
    if (event.pointerType !== 'mouse') {
      return
    }

    isHovered.value = true

    show()
  }

  function onTriggerLeave(): void {
    isHovered.value = false

    scheduleClose()
  }

  function onTooltipEnter(event: PointerEvent): void {
    if (event.pointerType === 'mouse') {
      isTooltipHovered.value = true

      show()
    }
  }

  function onTooltipLeave(): void {
    isTooltipHovered.value = false

    scheduleClose()
  }

  watch([isHovered, isTooltipHovered, isFocused], () => {
    if (!isHovered.value && !isTooltipHovered.value && !isFocused.value) {
      isDismissed.value = false
    }
  }, { flush: 'sync' })

  watch(() => isLoading, async loading => {
    if (loading || retryFocusOwner === null) {
      return
    }

    const focusOwner = retryFocusOwner

    retryFocusOwner = null

    await nextTick()

    const { activeElement, body } = globalThis.document

    if (!isPresented.value || (activeElement !== focusOwner && activeElement !== body)) {
      return
    }

    if (hasError) {
      retryButton.value?.focus()
    } else {
      trigger.value?.focus()
    }
  })

  watch(isOpen, open => {
    if (open && tooltip.value !== null) {
      tooltip.value.showPopover()
    } else {
      hidePopover()
    }
  }, { flush: 'post' })

  watch(isPresented, visible => {
    if (!visible) {
      dismiss()
    }
  })

  onClickOutside(tooltip, dismiss, { ignore: [trigger] })

  useEventListener('keydown', event => {
    if (isOpen.value && event.key === 'Escape') {
      event.preventDefault()
      dismiss()
    }
  })

  onBeforeUnmount(() => {
    cancelClose()
    hidePopover()
  })
</script>

<style module>
  @layer reset, vendor, tokens, base, components, utilities;

  @layer components {
    .component { display: grid; align-content: start; justify-items: start; gap: var(--space-1); }
    .label { color: var(--color-text-secondary); font-size: 0.875rem; }
    .component[data-presentation='inline'] .label { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    .trigger { anchor-name: var(--rating-anchor); display: inline-flex; align-items: center; gap: var(--space-3); min-block-size: 2.75rem; max-inline-size: 100%; padding: 0; border: 0; background: transparent; color: var(--color-text-primary); font-size: 1.5rem; font-weight: 600; font-variant-numeric: tabular-nums; cursor: pointer; }
    .trigger :global(svg) { flex: 0 0 auto; inline-size: 2rem; block-size: 2rem; color: var(--color-accent); }
    .placeholder { display: flex; align-items: center; min-block-size: 2.75rem; color: var(--color-text-secondary); font-size: 0.875rem; }
    .tooltip { position: fixed; position-anchor: var(--rating-anchor); position-area: block-end span-inline-end; position-try-fallbacks: flip-block, flip-inline, flip-block flip-inline; inset: auto; max-inline-size: calc(100vw - 2rem); max-block-size: calc(100dvh - 2rem); padding: var(--space-2) var(--space-3); margin: 8px 16px; overflow: auto; border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: var(--color-surface); color: var(--color-text-primary); font-size: 0.875rem; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
    .error { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); }
    .component[data-presentation='card'] {
      display: none;
      padding: var(--space-5);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      background: var(--color-surface);
    }
    .component[data-presentation='card'] .trigger { font-size: 2rem; }
    .component[data-presentation='card'] .trigger :global(svg) { inline-size: 2.5rem; block-size: 2.5rem; }
    @media (width >= 64rem) {
      .component[data-presentation='inline'] { display: none; }
      .component[data-presentation='card'] { display: grid; }
    }
  }
</style>
