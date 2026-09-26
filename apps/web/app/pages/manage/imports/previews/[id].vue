<template>
  <ImportPageShell title="Review import" description="Check the saved title and the changes before you confirm." :stage="progressStage">
    <p :class="$style.announcement" aria-live="polite" role="status">{{ announcement }}</p>
    <section v-if="loading" :class="$style.loading" aria-label="Loading saved preview" aria-busy="true"><div :class="$style.posterSkeleton" /><div :class="$style.copySkeleton"><span /><span /><span /></div></section>
    <section v-else-if="loadError" :class="$style.errorPanel">
      <AppMessage role="alert" tone="danger">{{ loadError }}</AppMessage>
      <AppButton v-if="canReload" variant="secondary" @click="loadPreview">Try again</AppButton>
      <NuxtLink :class="$style.link" to="/manage/imports">Create a new preview</NuxtLink>
    </section>
    <template v-else-if="preview">
      <div :class="$style.component">
        <section :class="$style.card" :aria-labelledby="cardHeadingId">
          <h2 :id="cardHeadingId" :class="$style.announcement">{{ cardTitle }}</h2>
          <dl :class="$style.fields">
            <div :class="$style.originalTitle"><dt>Original title</dt><dd>{{ cardTitle }}</dd></div>
            <div :class="$style.field"><dt>Release year</dt><dd>{{ releaseYear }}</dd></div>
            <div :class="$style.field"><dt>Original language</dt><dd>{{ preview.data.card?.originalLanguage.value ?? 'Unknown' }}</dd></div>
          </dl>
          <p :class="$style.savedAt">Read-only source data · Saved {{ savedDate }}</p>
        </section>
        <div :class="$style.details"><ImportPreviewDetails :preview="preview" :matches-id="matchesId" /></div>
        <aside :class="$style.reviewPanel" aria-label="Saved poster and sources">
          <div :class="$style.sourcePanel">
            <figure :class="$style.savedPoster">
              <figcaption :class="$style.panelHeading">Saved poster</figcaption>
              <CatalogPoster :key="preview.id" :poster-url="preview.posterUrl" :title="cardTitle" compact />
              <p :class="$style.meta">{{ cardMetadata }}</p>
            </figure>
            <section :class="$style.sourceRecords" :aria-labelledby="sourcesHeadingId">
              <h2 :id="sourcesHeadingId" :class="$style.panelHeading">Source</h2>
              <div :class="$style.sources">
                <a :class="$style.sourceLink" :href="tmdbUrl" rel="noopener noreferrer" target="_blank">TMDB #{{ preview.selection.tmdbId }} <Icon aria-hidden="true" mode="svg" name="hugeicons:arrow-up-right-01" /></a>
                <a v-if="tvmazeShowId" :class="$style.sourceLink" :href="tvmazeUrl" rel="noopener noreferrer" target="_blank">TVMaze show #{{ tvmazeShowId }} <Icon aria-hidden="true" mode="svg" name="hugeicons:arrow-up-right-01" /></a>
              </div>
              <p v-if="matchingSourceIds" :class="$style.matched"><Icon aria-hidden="true" mode="svg" name="hugeicons:tick-02" /> Matching source IDs: {{ matchingSourceIds }}</p>
              <details :class="$style.sourceEvidence">
                <summary>Compare source IDs</summary>
                <div :class="$style.source"><h3>TMDB</h3><dl :class="$style.identifiers"><div><dt>IMDb</dt><dd>{{ preview.data.evidence.tmdb?.imdb ?? 'Not provided' }}</dd></div><div><dt>TheTVDB</dt><dd>{{ preview.data.evidence.tmdb?.thetvdb ?? 'Not provided' }}</dd></div></dl></div>
                <div v-if="tvmazeShowId" :class="$style.source"><h3>TVMaze</h3><dl :class="$style.identifiers"><div><dt>IMDb</dt><dd>{{ preview.data.evidence.tvmaze?.externalIds.imdb ?? 'Not provided' }}</dd></div><div><dt>TheTVDB</dt><dd>{{ preview.data.evidence.tvmaze?.externalIds.thetvdb ?? 'Not provided' }}</dd></div></dl></div>
              </details>
              <p v-if="tvmazeAbsentReason" :class="$style.meta">No TVMaze match: {{ tvmazeAbsentReason }}</p>
            </section>
            <div :class="$style.workflow">
              <h2 :class="$style.panelHeading">Workflow status</h2>
              <AppStatusChip :tone="workflowTone">{{ workflowStatus }}</AppStatusChip>
              <p :class="$style.meta">{{ plannedCardChange }}</p>
            </div>
          </div>
          <section :class="$style.confirmation" :aria-labelledby="confirmHeadingId">
            <h2 :id="confirmHeadingId" ref="confirmHeading" :class="$style.confirmHeading" tabindex="-1">Confirm import</h2>
            <p v-if="hasNewEpisodes" :class="$style.meta">{{ newEpisodeSummary }}</p>
            <p v-if="hasPossibleMatches" :class="$style.duplicateNotice">Check the possible <a :href="matchesAnchor">catalog match</a> before creating a separate card.</p>
            <ul v-if="hasIssues" :class="$style.issues"><li v-for="issue in previewIssues" :key="issueKey(issue)">{{ issue.message }}</li></ul>
            <AppMessage v-if="showBlockedMessage" role="alert" tone="danger">This preview is blocked or expired. Create a new preview before importing.</AppMessage>
            <AppMessage v-else-if="alreadyCurrent" role="status">This catalog card is already up to date.</AppMessage>
            <NuxtLink v-if="existingCardLocation" :class="$style.link" :to="existingCardLocation">Open existing catalog card</NuxtLink>
            <AppMessage v-if="applyError" role="alert" tone="danger">{{ applyError }}</AppMessage>
            <div v-if="operation" :class="$style.outcome" :data-status="operation.status">
              <h3 ref="outcomeHeading" :class="$style.outcomeHeading" tabindex="-1">{{ operationLabel }}</h3>
              <p v-if="operation.issue" :class="$style.meta">{{ operation.issue.message }}</p>
              <p v-if="operation.result" :class="$style.meta">{{ operationSummary }}</p>
              <NuxtLink v-if="operation.result" :class="$style.link" :to="operationCardLocation">Open catalog card <Icon aria-hidden="true" mode="svg" name="hugeicons:arrow-right-02" /></NuxtLink>
              <AppButton v-if="isPending" :disabled="refreshing" variant="secondary" @click="refreshOperation">{{ refreshLabel }}</AppButton>
              <AppButton v-if="operation.canRetry" :disabled="applying" variant="secondary" @click="apply(true)">Retry failed import</AppButton>
            </div>
            <div :class="$style.actions">
              <AppButton v-if="canConfirm" :disabled="applying" @click="apply(retryRequested)">{{ confirmLabel }}</AppButton>
              <NuxtLink v-if="blocked" :class="$style.link" to="/manage/imports">Create a new preview</NuxtLink>
              <NuxtLink :class="$style.historyLink" to="/manage/imports">Change selection</NuxtLink>
              <NuxtLink :class="$style.historyLink" to="/manage/imports/history">View shared history</NuxtLink>
            </div>
            <p :class="$style.expiry">Preview expires {{ expiryDate }}</p>
          </section>
        </aside>
      </div>
      <footer :class="$style.credits">
        <img src="/tmdb-logo.svg" alt="TMDB" width="137" height="18">
        <div><p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p><p>Show data from <a href="https://www.tvmaze.com" rel="noopener noreferrer" target="_blank">TVMaze</a>.</p></div>
      </footer>
    </template>
  </ImportPageShell>
</template>

<script lang="ts" setup>
  import { Icon } from '#components'
  import { definePageMeta } from '#app/composables/pages'
  import { useHead, useRequestFetch, useResponseHeader, useRoute, navigateTo } from '#app'
  import type { ImportIssue, ImportOperationView, ImportPreviewView } from '@tv/shared/catalog-import'
  import { computed, nextTick, ref, useId, useTemplateRef, watch } from 'vue'
  import * as v from 'valibot'
  import ImportPageShell from '~/components/import/ImportPageShell.vue'
  import ImportPreviewDetails from '~/components/import/ImportPreviewDetails.vue'
  import CatalogPoster from '~/components/catalog/CatalogPoster.vue'
  import AppButton from '~/components/ui/AppButton.vue'
  import AppMessage from '~/components/ui/AppMessage.vue'
  import AppStatusChip, { type StatusChipTone } from '~/components/ui/AppStatusChip.vue'
  import { useCatalogImportAccess } from '~/composables/use-catalog-import-access.ts'
  import { importRequestMessage, importRequestStatus } from '~/utils/catalog-import-error.ts'

  import {
    importApplyResponseSchema,
    importOperationResponseSchema,
    importPreviewResponseSchema
  } from '~/utils/catalog-import-response.ts'

  definePageMeta({ middleware: ['authenticated', 'catalog-import'] })
  useHead({ title: 'Review preview · Import management · TV' })

  useResponseHeader('Cache-Control').value = 'private, no-store'

  const route = useRoute()
  const requestFetch = useRequestFetch()
  const { canManage, deny, unauthorize } = useCatalogImportAccess()
  const preview = ref<ImportPreviewView | null>(null)
  const operation = ref<ImportOperationView | null>(null)
  const loading = ref(false)
  const missing = ref(false)
  const loadError = ref('')
  const applyError = ref('')
  const conflicted = ref(false)
  const applying = ref(false)
  const refreshing = ref(false)
  const announcement = ref('')
  const outcomeHeading = useTemplateRef('outcomeHeading')
  const confirmHeading = useTemplateRef('confirmHeading')
  const cardHeadingId = useId()
  const matchesId = useId()
  const sourcesHeadingId = useId()
  const matchesAnchor = computed(() => `#${matchesId}`)
  const confirmHeadingId = useId()
  const retryRequested = computed(() => route.query.retry === '1')

  const blocked = computed(() => {
    if (conflicted.value || preview.value === null || preview.value.status === 'blocked') {return true}

    const expiresAt = new Date(preview.value.expiresAt)
    const expiresAtMilliseconds = expiresAt.getTime()

    return expiresAtMilliseconds <= Date.now()
  })

  const alreadyCurrent = computed(() => preview.value !== null && !preview.value.data.additions.createItem
    && preview.value.data.additions.episodeExternalIds.length === 0
    && preview.value.data.additions.sourceLinks.length === 0
    && preview.value.data.changes.every(change => change.action === 'unchanged' || change.action === 'preserve_manual' || change.action === 'retain_missing'))

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

  const canReload = computed(() => !missing.value)
  const cardTitle = computed(() => preview.value?.data.card?.originalTitle.value ?? 'Card unavailable')
  const releaseYear = computed(() => preview.value?.data.card?.releaseYear.value ?? 'Year unknown')
  const savedDate = computed(() => preview.value === null ? '' : displayDate(preview.value.createdAt))
  const expiryDate = computed(() => preview.value === null ? '' : displayDate(preview.value.expiresAt))
  const hasPossibleMatches = computed(() => preview.value?.data.additions.createItem && preview.value.matches.some(match => match.kind === 'possible_title'))
  const progressStage = computed(() => operation.value ? 'import' as const : 'review' as const)

  const cardMetadata = computed(() => {
    const type = preview.value?.selection.type === 'movie' ? 'Movie' : 'Series'
    const metadata = `${releaseYear.value} · ${type}`

    return metadata
  })

  const matchingSourceIds = computed(() => preview.value?.data.evidence.matchingIds.join(', '))

  const tmdbUrl = computed(() => {
    const type = preview.value?.selection.type === 'movie' ? 'movie' : 'tv'
    const url = `https://www.themoviedb.org/${type}/${preview.value?.selection.tmdbId}`

    return url
  })

  const tvmazeShowId = computed(() => preview.value?.selection.type === 'series' && preview.value?.selection.tvmaze.status === 'selected' ? preview.value?.selection.tvmaze.id : null)
  const tvmazeUrl = computed(() => `https://www.tvmaze.com/shows/${tvmazeShowId.value}`)
  const tvmazeAbsentReason = computed(() => preview.value?.selection.type === 'series' && preview.value?.selection.tvmaze.status === 'verified_absent' ? preview.value?.selection.tvmaze.reason : null)

  const plannedCardChange = computed(() => preview.value?.data.additions.createItem
    ? 'A new catalog card will be created.'
    : 'An existing catalog card will be updated.')

  const newEpisodeCount = computed(() => preview.value?.data.additions.episodeExternalIds.length ?? 0)
  const hasNewEpisodes = computed(() => newEpisodeCount.value > 0)

  const newEpisodeSummary = computed(() => {
    const label = newEpisodeCount.value === 1 ? 'episode record' : 'episode records'
    const summary = `${newEpisodeCount.value} ${label} will be added.`

    return summary
  })

  const previewIssues = computed(() => {
    if (preview.value === null) {return []}

    return [...preview.value.data.errors, ...preview.value.data.warnings]
  })

  const hasIssues = computed(() => previewIssues.value.length > 0)
  const showBlockedMessage = computed(() => blocked.value && !applyError.value)

  const existingCardLocation = computed(() => {
    const catalogItemId = preview.value?.data.additions.catalogItemId

    return catalogItemId ? `/titles/${catalogItemId}` : undefined
  })

  const operationLabel = computed(() => {
    if (operation.value?.status === 'succeeded') {return 'Import complete'}

    if (operation.value?.status === 'pending') {return 'Import pending'}

    return 'Import failed'
  })

  const workflowStatus = computed(() => {
    if (operation.value) {return operationLabel.value}

    return blocked.value ? 'Blocked' : 'Requires review'
  })

  const workflowTone = computed<StatusChipTone>(() => {
    if (operation.value?.status === 'succeeded') {return 'success'}

    if (operation.value?.status === 'failed' || blocked.value) {return 'danger'}

    return 'warning'
  })

  const operationSummary = computed(() => {
    const result = operation.value?.result

    if (!result) {return ''}

    const action = result.createdItem ? 'Created' : 'Updated'
    const episodes = result.createdEpisodes === 1 ? 'episode' : 'episodes'
    const fields = result.changedFields === 1 ? 'field' : 'fields'
    const formatted = `${action} catalog card · ${result.createdEpisodes} new ${episodes} · ${result.changedFields} changed ${fields}.`

    return formatted
  })

  const operationCardLocation = computed(() => {
    const catalogItemId = operation.value?.result?.catalogItemId

    return catalogItemId ? `/titles/${catalogItemId}` : undefined
  })

  const isPending = computed(() => operation.value?.status === 'pending')
  const refreshLabel = computed(() => refreshing.value ? 'Checking…' : 'Refresh status')
  const canConfirm = computed(() => !blocked.value && operation.value === null)

  const confirmLabel = computed(() => {
    if (applying.value) {return 'Importing…'}

    return retryRequested.value ? 'Retry failed import' : 'Confirm import'
  })

  function issueKey(issue: ImportIssue): string {
    const formatted = `${issue.code}-${issue.message}`

    return formatted
  }

  function handleFailure(error: unknown, fallback: string): string {
    const status = importRequestStatus(error)

    if (status === 401) {
      unauthorize()

      void navigateTo('/sign-in')

      return ''
    }

    if (status === 403) {
      deny()

      return ''
    }

    return importRequestMessage(error, fallback)
  }

  async function loadPreview(): Promise<void> {
    if (!canManage.value) {return}

    loading.value = true
    loadError.value = ''
    missing.value = false

    try {
      const previewId = String(route.params.id)
      const previewUrl = `/api/catalog/imports/previews/${previewId}`
      const body = await requestFetch(previewUrl, { retry: 0 })

      if (!canManage.value) {return}

      const response = v.parse(importPreviewResponseSchema, body)

      preview.value = response.preview
      conflicted.value = false
      announcement.value = 'Saved preview loaded.'
    } catch (error) {
      missing.value = importRequestStatus(error) === 404
      loadError.value = missing.value ? 'This preview is unavailable or expired.' : handleFailure(error, 'We couldn’t load the preview. Try again.')
    } finally {
      loading.value = false
    }
  }

  async function apply(retry: boolean): Promise<void> {
    if (!canManage.value || blocked.value || preview.value === null || applying.value) {return}

    applying.value = true
    applyError.value = ''

    try {
      const applyUrl = `/api/catalog/imports/previews/${preview.value.id}/apply`

      const body = await requestFetch(applyUrl, {
        method: 'POST',
        body: { retry },
        retry: 0
      })

      if (!canManage.value) {return}

      const response = v.parse(importApplyResponseSchema, body)

      operation.value = response.operation
      announcement.value = `Import ${response.status}.`

      await nextTick()
      outcomeHeading.value?.focus()
    } catch (error) {
      const status = importRequestStatus(error)

      conflicted.value = status === 409
      applyError.value = status === 409
        ? 'This preview changed or expired. Create a new preview.'
        : handleFailure(error, 'We couldn’t confirm the import. Try again.')

      await nextTick()
      confirmHeading.value?.focus()
    } finally {
      applying.value = false
    }
  }

  async function refreshOperation(): Promise<void> {
    if (!canManage.value || operation.value === null || refreshing.value) {return}

    refreshing.value = true
    applyError.value = ''

    try {
      const operationUrl = `/api/catalog/imports/operations/${operation.value.id}`
      const body = await requestFetch(operationUrl, { retry: 0 })

      if (!canManage.value) {return}

      const response = v.parse(importOperationResponseSchema, body)

      operation.value = response.operation
      announcement.value = `Import ${operation.value.status}.`

      await nextTick()
      outcomeHeading.value?.focus()
    } catch (error) {
      applyError.value = handleFailure(error, 'We couldn’t refresh the status. Try again.')
    } finally {
      refreshing.value = false
    }
  }

  watch(canManage, (allowed) => {
    if (allowed && preview.value === null && !loading.value) {
      void loadPreview()
    } else if (!allowed) {
      preview.value = null
      operation.value = null
    }
  })

  if (canManage.value) { await loadPreview() }
</script>

<style module>
  @layer reset, vendor, tokens, base, components, utilities;
  @layer components {
    .component { display: grid; gap: var(--space-8); align-items: start; }
    .announcement { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    .loading { display: grid; grid-template-columns: 7rem minmax(0, 1fr); gap: var(--space-5); align-items: start; }
    .card { display: grid; gap: var(--space-3); min-inline-size: 0; }
    .posterSkeleton { aspect-ratio: 2 / 3; border-radius: var(--radius-lg); background: var(--color-surface-muted); }
    .copySkeleton { display: grid; gap: var(--space-4); }
    .copySkeleton span { block-size: 1.5rem; border-radius: var(--radius-sm); background: var(--color-surface-muted); }
    .errorPanel { display: grid; justify-items: start; gap: var(--space-5); }
    .fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-5); }
    .field, .originalTitle { display: grid; gap: var(--space-2); min-inline-size: 0; }
    .originalTitle { grid-column: 1 / -1; }
    .fields dt { color: var(--color-text-secondary); font-size: .875rem; }
    .fields dd { font-weight: 500; }
    .meta { color: var(--color-text-secondary); font-size: .875rem; }
    .savedAt { color: var(--color-text-secondary); font-size: .75rem; }
    .reviewPanel { display: contents; }
    .sourcePanel { display: grid; gap: var(--space-6); padding: var(--space-5); border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface); box-shadow: var(--shadow-card); }
    .savedPoster { display: grid; justify-items: center; gap: var(--space-3); }
    .savedPoster > :nth-child(2) { max-inline-size: 8rem; }
    .savedPoster figcaption { justify-self: start; }
    .panelHeading { font-size: 1rem; font-weight: 500; }
    .sourceRecords, .workflow { display: grid; gap: var(--space-3); }
    .confirmation { display: grid; gap: var(--space-4); min-inline-size: 0; }
    .confirmHeading { font-size: 1.125rem; font-weight: 600; }
    .matched { display: flex; align-items: center; gap: var(--space-2); font-size: .875rem; color: var(--color-text-primary); }
    .matched :global(svg) { color: var(--color-accent); inline-size: 1.25rem; block-size: 1.25rem; }
    .sources { display: grid; gap: var(--space-2); }
    .sourceEvidence { font-size: .875rem; }
    .sourceEvidence summary { padding-block: var(--space-2); cursor: pointer; }
    .sourceEvidence h3 { font-size: .875rem; font-weight: 500; }
    .source { display: grid; gap: var(--space-2); padding-block: var(--space-3); }
    .sourceLink { color: var(--color-text-primary); display: inline-flex; align-items: center; gap: var(--space-1); font-weight: 600; font-size: .875rem; text-underline-offset: .2em; }
    .sourceLink :global(svg) { inline-size: 1rem; block-size: 1rem; }
    .identifiers { display: grid; gap: var(--space-1); font-size: .75rem; }
    .identifiers div { display: grid; grid-template-columns: 4rem minmax(0, 1fr); gap: var(--space-2); }
    .identifiers dt { color: var(--color-text-secondary); }
    .identifiers dd { font-variant-numeric: tabular-nums; }
    .duplicateNotice { font-size: .875rem; }
    .duplicateNotice a { text-underline-offset: .2em; }
    .issues { display: grid; gap: var(--space-2); padding-inline-start: var(--space-5); font-size: .875rem; }
    .outcome { display: grid; gap: var(--space-3); padding-block: var(--space-4); border-block: 1px solid var(--color-border); }
    .outcomeHeading { font-size: 1.25rem; font-weight: 600; }
    .outcome[data-status='succeeded'] .outcomeHeading { color: var(--color-accent); }
    .outcome[data-status='failed'] .outcomeHeading { color: var(--color-danger); }
    .link { color: var(--color-text-primary); display: inline-flex; align-items: center; gap: var(--space-2); min-block-size: 2.75rem; font-weight: 600; text-underline-offset: .2em; }
    .link :global(svg) { inline-size: 1.25rem; block-size: 1.25rem; }
    .actions { display: grid; gap: var(--space-2); }
    .historyLink { display: grid; place-items: center; min-block-size: 2.75rem; color: var(--color-text-secondary); font-size: .875rem; text-underline-offset: .2em; }
    .expiry { color: var(--color-text-secondary); font-size: .75rem; }
    .details { min-inline-size: 0; scroll-margin-block-start: var(--space-6); }
    .credits { display: flex; align-items: start; flex-wrap: wrap; gap: var(--space-4); margin-block-start: var(--space-10); padding-block-start: var(--space-6); border-block-start: 1px solid var(--color-border); color: var(--color-text-secondary); font-size: .75rem; }
    .credits img { margin-block-start: var(--space-1); inline-size: 6rem; block-size: auto; }
    .credits a { color: inherit; text-underline-offset: .2em; }
    @media (width >= 40rem) {
      .component { grid-template-columns: minmax(0, 1fr) 13.5rem; gap: var(--space-6); }
      .card, .details { grid-column: 1; }
      .sourcePanel { grid-column: 2; grid-row: 1 / 3; }
      .confirmation { grid-column: 1 / -1; padding-block-start: var(--space-6); border-block-start: 1px solid var(--color-border); }
    }
    @media (width >= 64rem) {
      .originalTitle { grid-column: auto; }
      .component { grid-template-columns: minmax(0, 1fr) var(--layout-rail); column-gap: var(--space-8); }
      .reviewPanel { display: grid; grid-column: 2; grid-row: 1 / 3; gap: var(--space-5); padding: var(--space-6); border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface); box-shadow: var(--shadow-card); }
      .sourcePanel { padding: 0; border: 0; box-shadow: none; grid-column: auto; grid-row: auto; }
      .confirmation { padding-block-start: var(--space-5); }
    }
  }
</style>
