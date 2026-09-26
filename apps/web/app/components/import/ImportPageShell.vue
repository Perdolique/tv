<template>
  <AppShell focused>
    <main :class="$style.component">
      <header :class="$style.header">
        <NuxtLink :class="$style.back" :to="backLocation" :aria-label="backLabel"><Icon aria-hidden="true" mode="svg" name="hugeicons:arrow-left-02" /></NuxtLink>
        <h1 :class="$style.heading">{{ title }}</h1>
        <nav :class="$style.navigation" aria-label="Import management">
          <NuxtLink v-if="isHistory" :class="$style.navigationLink" to="/manage/imports" aria-label="Import a title">
            <Icon aria-hidden="true" mode="svg" name="hugeicons:add-01" /><span :class="$style.navigationLabel">Import a title</span>
          </NuxtLink>
          <NuxtLink v-else :class="$style.navigationLink" to="/manage/imports/history" aria-label="Import history">
            <Icon aria-hidden="true" mode="svg" name="hugeicons:clock-01" /><span :class="$style.navigationLabel">Import history</span>
          </NuxtLink>
        </nav>
        <p v-if="description" :class="$style.description">{{ description }}</p>
      </header>
      <ol v-if="showProgress" :class="$style.steps" aria-label="Import progress">
        <li :class="$style.step" :aria-current="searchCurrent"><span :class="$style.stepNumber">1</span> Search</li>
        <li :class="$style.step" :aria-current="reviewCurrent"><span :class="$style.stepNumber">2</span> Review</li>
        <li :class="$style.step" :aria-current="importCurrent"><span :class="$style.stepNumber">3</span> Import</li>
      </ol>
      <section v-if="isDenied" :class="$style.panel">
        <h2>Access denied</h2>
        <p>You need catalog management access to view imports.</p>
      </section>
      <section v-else-if="hasAccessError" :class="$style.panel" role="alert">
        <h2>We couldn’t check your access</h2>
        <p>Try again to open catalog management.</p>
        <AppButton :disabled="checking" variant="secondary" @click="retryAccess">Try again</AppButton>
      </section>
      <slot v-else-if="canManage" />
    </main>
  </AppShell>
</template>

<script lang="ts" setup>
  import { Icon } from '#components'
  import { navigateTo, useRoute } from '#app'
  import { computed, ref } from 'vue'
  import AppShell from '~/components/app/AppShell.vue'
  import AppButton from '~/components/ui/AppButton.vue'
  import { useCatalogImportAccess } from '~/composables/use-catalog-import-access.ts'

  interface Props {
    title: string;
    description?: string;
    stage?: 'search' | 'review' | 'import';
  }

  const { stage } = defineProps<Props>()
  const route = useRoute()
  const { canManage, check, state: access } = useCatalogImportAccess()
  const checking = ref(false)
  const isHistory = computed(() => route.path === '/manage/imports/history')
  const isSearch = computed(() => route.path === '/manage/imports')
  const backLocation = computed(() => isSearch.value ? '/' : '/manage/imports')
  const backLabel = computed(() => isSearch.value ? 'Back to catalog' : 'Back to search')
  const showProgress = computed(() => canManage.value && stage !== undefined)
  const searchCurrent = computed(() => stage === 'search' ? 'step' as const : undefined)
  const reviewCurrent = computed(() => stage === 'review' ? 'step' as const : undefined)
  const importCurrent = computed(() => stage === 'import' ? 'step' as const : undefined)
  const isDenied = computed(() => access.value.status === 'denied')
  const hasAccessError = computed(() => access.value.status === 'error' || access.value.status === 'unknown')

  async function retryAccess(): Promise<void> {
    checking.value = true

    const status = await check()

    checking.value = false

    if (status === 'unauthorized') {
      await navigateTo({
        path: '/sign-in',
        query: { redirectTo: route.fullPath }
      })
    }
  }
</script>

<style module>
  @layer reset, vendor, tokens, base, components, utilities;

  @layer components {
    .component { max-inline-size: var(--layout-content-max); padding: 0 var(--layout-page-compact) var(--space-10); }
    .header { display: grid; grid-template-columns: 2.75rem minmax(0, 1fr) 2.75rem; align-items: center; column-gap: var(--space-2); min-block-size: calc(5rem + env(safe-area-inset-top)); padding-block-start: env(safe-area-inset-top); margin-inline: calc(-1 * var(--space-3)); margin-block-end: var(--space-4); }
    .heading { text-align: center; font-size: 1.25rem; font-weight: 600; line-height: 1.2; }
    .back, .navigationLink { display: inline-flex; align-items: center; justify-content: center; gap: var(--space-2); min-inline-size: 2.75rem; min-block-size: 2.75rem; color: var(--color-text-primary); text-decoration: none; }
    .back :global(svg), .navigationLink :global(svg) { inline-size: 1.5rem; block-size: 1.5rem; }
    .back { color: var(--color-accent); }
    .navigationLink:hover { text-decoration: underline; text-underline-offset: .25em; }
    .navigationLabel, .description, .steps { display: none; }
    .step { display: flex; align-items: center; gap: var(--space-3); color: var(--color-text-secondary); font-size: .875rem; }
    .step + .step::before { content: '·'; margin-inline-end: var(--space-4); }
    .stepNumber { display: grid; place-items: center; inline-size: 1.875rem; block-size: 1.875rem; border: 1px solid var(--color-border); border-radius: var(--radius-round); background: var(--color-surface-muted); font-variant-numeric: tabular-nums; }
    .step[aria-current='step'] { color: var(--color-text-primary); font-weight: 600; }
    .step[aria-current='step'] .stepNumber { border-color: var(--color-accent); background: var(--color-canvas); color: var(--color-accent); }
    .panel { display: grid; justify-items: start; gap: var(--space-4); max-inline-size: 36rem; padding: var(--space-6); border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface); }
    .panel h2 { font-size: 1.375rem; font-weight: 600; }
    .panel p { color: var(--color-text-secondary); }
    @media (width >= 40rem) {
      .component { padding-block-start: var(--space-8); }
      .header { grid-template-columns: minmax(0, 1fr) auto; min-block-size: 2.75rem; margin-inline: 0; margin-block-end: var(--space-6); }
      .heading { font-size: 1.75rem; text-align: start; }
      .back { display: none; }
      .navigationLabel { display: inline; font-size: .875rem; }
    }
    @media (width >= 64rem) {
      .component { padding: var(--space-8) var(--layout-page-wide) var(--space-10); }
      .header { row-gap: var(--space-2); margin-block-end: var(--space-8); }
      .heading { font-size: 2.25rem; }
      .description { display: block; grid-column: 1 / -1; color: var(--color-text-secondary); }
      .steps { display: flex; gap: var(--space-6); padding: 0; margin-block-end: var(--space-8); list-style: none; }
    }
  }
</style>
