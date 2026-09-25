<template>
  <ImportPageShell title="Import a title" description="Search first. Review before importing." stage="search">
    <div :class="$style.component">
      <section :class="$style.search" :aria-labelledby="tmdbHeadingId">
        <h2 :id="tmdbHeadingId" :class="$style.srOnly">Search TMDB</h2>
        <fieldset :class="$style.typePicker">
          <legend :class="$style.srOnly">Title type</legend>
          <label :class="$style.typeChoice"><input v-model="titleType" :name="titleTypeName" type="radio" value="movie">Movie</label>
          <label :class="$style.typeChoice"><input v-model="titleType" :name="titleTypeName" type="radio" value="series">Series</label>
        </fieldset>
        <ImportSearchForm ref="titleSearch" v-model="query" label="Title name" :button-label="searchLabel" :disabled="isSearchDisabled" @submit="findTitles(1)" />
        <p :class="$style.srOnly" aria-live="polite" role="status">{{ announcement }}</p>
        <AppMessage v-if="searchError" role="alert" tone="danger">{{ searchError }}</AppMessage>
        <div v-if="isInitialSearching" :class="$style.loading" aria-label="Searching TMDB" aria-busy="true"><span /><span /></div>
        <div v-else-if="isSearchEmpty" :class="$style.empty">
          <Icon aria-hidden="true" mode="svg" name="hugeicons:search-01" />
          <h3>No matching titles</h3>
          <p>Try another name or switch between Movie and Series.</p>
        </div>
        <p v-else-if="showSearchHint" :class="$style.searchHint">Find a title by its original or translated name.</p>
        <template v-if="hasResults">
          <p :class="$style.resultCount">{{ resultHeading }}</p>
          <ol :class="$style.results" aria-label="TMDB search results">
            <li v-for="item in visibleResults" :key="titleKey(item)" :class="$style.result" :data-selected="isSelectedTitle(item)">
              <CatalogPoster :class="$style.resultPoster" :poster-url="item.posterUrl" :title="item.title" compact loading="lazy" />
              <div :class="$style.resultInformation">
                <h3 :class="$style.resultTitle">{{ item.title }}</h3>
                <p :class="$style.meta">{{ titleMetadata(item) }}</p>
                <p v-if="hasOriginalTitle(item)" :class="$style.meta">{{ item.originalTitle }}</p>
                <p :class="$style.sourceId">TMDB #{{ item.id }}</p>
              </div>
              <div :class="$style.resultActions">
                <span v-if="isSelectedTitle(item)" :class="$style.selected"><Icon aria-hidden="true" mode="svg" name="hugeicons:tick-02" /> Selected</span>
                <AppButton v-if="isSeriesSelected" :class="$style.useButton" :disabled="saving" variant="secondary" @click="changeTitle">Change selection</AppButton>
                <AppButton v-else :class="$style.useButton" :disabled="saving" :aria-pressed="isSelectedTitle(item)" variant="secondary" @click="selectTitle(item)">Use this</AppButton>
              </div>
            </li>
          </ol>
        </template>
        <AppButton v-if="hasNextPage" :class="$style.moreResults" :disabled="searching" variant="secondary" @click="loadMoreTitles">More results</AppButton>
      </section>

      <section v-if="selected" :class="$style.metadata" :aria-labelledby="selectionHeadingId">
        <h2 :id="selectionHeadingId" :class="$style.srOnly" tabindex="-1">{{ selected.title }}</h2>
        <dl :class="$style.fields">
          <div :class="$style.fieldValue"><dt>Original title</dt><dd>{{ selected.originalTitle }}</dd></div>
          <div :class="$style.fieldValue"><dt>Release year</dt><dd>{{ selected.year ?? 'Unknown' }}</dd></div>
        </dl>
        <div v-if="isSeriesSelected" :class="$style.showMatching">
          <h3 ref="showHeading" :class="$style.subheading" tabindex="-1">Match the episode source</h3>
          <p :class="$style.meta">Choose the same show on TVMaze to include its episodes.</p>
          <ImportSearchForm v-model="showQuery" label="TVMaze show name" placeholder="Search show on TVMaze" :button-label="showSearchLabel" :disabled="isShowSearchDisabled" @submit="findShows" />
          <p :class="[$style.showSearchStatus, { 'is-idle': isShowSearchIdle }]" role="status">Searching TVMaze for episode sources…</p>
          <AppMessage v-if="showError" role="alert" tone="danger">{{ showError }}</AppMessage>
          <p v-if="isShowSearchEmpty" :class="$style.meta">No TVMaze shows found. You can record why there is no match.</p>
          <ul v-if="hasShows" :class="$style.showResults" aria-label="TVMaze show candidates">
            <li v-for="show in shows" :key="show.id" :class="$style.showResult" :data-selected="isSelectedShow(show)">
              <div>
                <h4 :class="$style.showTitle">{{ show.title }} <span :class="$style.meta">· {{ showYear(show) }}</span></h4>
                <a :class="$style.sourceLink" :href="showUrl(show)" rel="noopener noreferrer" target="_blank">TVMaze #{{ show.id }} <Icon aria-hidden="true" mode="svg" name="hugeicons:arrow-up-right-01" /></a>
                <p v-if="show.imdbId" :class="$style.sourceId">IMDb {{ show.imdbId }}</p>
                <p v-if="show.thetvdbId" :class="$style.sourceId">TheTVDB {{ show.thetvdbId }}</p>
              </div>
              <div :class="$style.showActions">
                <span v-if="isSelectedShow(show)" :class="$style.selected"><Icon aria-hidden="true" mode="svg" name="hugeicons:tick-02" /> Selected</span>
                <AppButton :class="$style.useButton" :disabled="isShowSelectionDisabled" :aria-pressed="isSelectedShow(show)" variant="secondary" @click="chooseShow(show.id)">Use this</AppButton>
              </div>
            </li>
          </ul>
          <div v-if="showSearched" :class="$style.noMatch">
            <label :class="$style.choiceLabel"><input v-model="noShowMatch" type="checkbox" @change="showChoice = null"> No matching TVMaze show</label>
            <label v-if="noShowMatch" :class="$style.field">Why is there no match?
              <textarea v-model.trim="noMatchReason" maxlength="500" minlength="8" rows="3" required />
            </label>
          </div>
        </div>
      </section>
      <section v-if="selected" :class="$style.selection" aria-label="Import sources">
        <div :class="$style.selectionPanel">
          <figure :class="$style.poster">
            <CatalogPoster :key="titleKey(selected)" :poster-url="selected.posterUrl" :title="selected.title" compact />
            <figcaption :class="$style.caption">TMDB search poster</figcaption>
          </figure>
          <div :class="$style.sources">
            <h2 :class="$style.subheading">Source</h2>
            <p :class="$style.sourceStatus"><Icon aria-hidden="true" mode="svg" name="hugeicons:checkmark-circle-02" /> TMDB selected</p>
            <p :class="$style.sourceId">TMDB #{{ selected.id }}</p>
            <template v-if="selectedShow">
              <p :class="$style.sourceStatus"><Icon aria-hidden="true" mode="svg" name="hugeicons:checkmark-circle-02" /> TVMaze selected</p>
              <p :class="$style.meta">{{ selectedShow.title }} · {{ showYear(selectedShow) }}</p>
              <p :class="$style.sourceId">TVMaze #{{ selectedShow.id }}</p>
            </template>
            <p v-else-if="isSeriesSelected" :class="$style.meta">{{ episodeSourceStatus }}</p>
          </div>
          <div :class="$style.workflow">
            <h2 :class="$style.subheading">Workflow status</h2>
            <AppStatusChip tone="warning">{{ workflowStatus }}</AppStatusChip>
          </div>
        </div>
        <div :class="$style.nextAction">
          <AppMessage v-if="saveError" role="alert" tone="danger">{{ saveError }}</AppMessage>
          <p v-if="needsEpisodeSource" :id="episodeSourceHintId" :class="$style.caption">{{ episodeSourceHint }}</p>
          <AppButton ref="reviewButton" :disabled="isSaveDisabled" :aria-describedby="reviewDescriptionId" @click="savePreview">{{ saveLabel }}</AppButton>
          <p :class="$style.caption">Review the saved data before confirming the import.</p>
        </div>
      </section>
    </div>
    <footer :class="$style.credits">
      <img src="/tmdb-logo.svg" alt="TMDB" width="137" height="18">
      <div><p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p><p>Show data from <a href="https://www.tvmaze.com" rel="noopener noreferrer" target="_blank">TVMaze</a>.</p></div>
    </footer>
  </ImportPageShell>
</template>

<script lang="ts" setup>
  import { Icon } from '#components'
  import { definePageMeta } from '#app/composables/pages'
  import { navigateTo, useHead, useRequestFetch, useResponseHeader } from '#app'
  import type { ImportSearchItem, ImportSelection, ImportShowItem } from '@tv/shared/catalog-import'
  import { computed, nextTick, ref, useId, useTemplateRef, watch } from 'vue'
  import * as v from 'valibot'
  import ImportPageShell from '~/components/import/ImportPageShell.vue'
  import CatalogPoster from '~/components/catalog/CatalogPoster.vue'
  import ImportSearchForm from '~/components/import/ImportSearchForm.vue'
  import AppButton from '~/components/ui/AppButton.vue'
  import AppMessage from '~/components/ui/AppMessage.vue'
  import AppStatusChip from '~/components/ui/AppStatusChip.vue'
  import { titleKey, titleMetadata, showYear, showUrl, hasOriginalTitle } from '~/utils/catalog-import-display.ts'
  import { useCatalogImportAccess } from '~/composables/use-catalog-import-access.ts'
  import { useRequestCancellation } from '~/composables/use-request-cancellation.ts'
  import { importRequestMessage, importRequestStatus } from '~/utils/catalog-import-error.ts'

  import {
    importPreviewResponseSchema,
    importSearchResponseSchema,
    importShowSearchResponseSchema
  } from '~/utils/catalog-import-response.ts'

  definePageMeta({ middleware: ['authenticated', 'catalog-import'] })
  useHead({ title: 'Import a title · TV' })

  useResponseHeader('Cache-Control').value = 'private, no-store'

  const requestFetch = useRequestFetch()
  const { canManage, deny, unauthorize } = useCatalogImportAccess()
  const titleType = ref<'movie' | 'series'>('movie')
  const query = ref('')
  const results = ref<ImportSearchItem[]>([])
  const nextPage = ref<number | null>(null)
  const searched = ref(false)
  const searching = ref(false)
  const searchError = ref('')
  const selected = ref<ImportSearchItem | null>(null)
  const showQuery = ref('')
  const shows = ref<ImportShowItem[]>([])
  const showChoice = ref<number | null>(null)
  const showSearched = ref(false)
  const showSearching = ref(false)
  const showError = ref('')
  const noShowMatch = ref(false)
  const noMatchReason = ref('')
  const saving = ref(false)
  const saveError = ref('')
  const announcement = ref('Enter a title to search.')
  const titleRequest = useRequestCancellation()
  const showRequest = useRequestCancellation()
  const saveRequest = useRequestCancellation()
  const tmdbHeadingId = useId()
  const selectionHeadingId = useId()
  const titleTypeName = useId()
  const episodeSourceHintId = useId()
  const titleSearch = useTemplateRef('titleSearch')
  const showHeading = useTemplateRef('showHeading')
  const reviewButton = useTemplateRef('reviewButton')
  const selectedShow = computed(() => shows.value.find(show => show.id === showChoice.value))
  const showSearchHint = computed(() => !searched.value && !searchError.value)

  const resultCountLabel = computed(() => {
    const count = results.value.length
    const noun = count === 1 ? 'result' : 'results'
    const label = `${count} ${noun} from TMDB`

    return label
  })

  const isSearchDisabled = computed(() => searching.value || saving.value)
  const searchLabel = computed(() => searching.value ? 'Searching…' : 'Search titles')
  const isSearchEmpty = computed(() => searched.value && !searching.value && !searchError.value && results.value.length === 0)
  const hasResults = computed(() => results.value.length > 0)
  const isInitialSearching = computed(() => searching.value && !hasResults.value)
  const isSeriesSelected = computed(() => selected.value?.type === 'series')
  const hasNextPage = computed(() => nextPage.value !== null && !isSeriesSelected.value)
  const visibleResults = computed(() => isSeriesSelected.value && selected.value ? [selected.value] : results.value)
  const resultHeading = computed(() => isSeriesSelected.value ? 'Selected title' : resultCountLabel.value)
  const isShowSearchDisabled = computed(() => showSearching.value || saving.value)
  const isShowSearchIdle = computed(() => !showSearching.value)
  const isShowSelectionDisabled = computed(() => showSearching.value || saving.value || !showSearched.value)
  const showSearchLabel = computed(() => showSearching.value ? 'Searching…' : 'Search shows')
  const isShowSearchEmpty = computed(() => showSearched.value && shows.value.length === 0)
  const hasShows = computed(() => shows.value.length > 0)
  const saveLabel = computed(() => saving.value ? 'Saving preview…' : 'Review import')

  const canSave = computed(() => {
    if (!canManage.value || selected.value === null) {return false}

    if (selected.value.type === 'movie') {return true}

    return showSearched.value && (showChoice.value !== null || (noShowMatch.value && noMatchReason.value.length >= 8))
  })

  const episodeSourceStatus = computed(() => noShowMatch.value ? 'No TVMaze match recorded' : 'TVMaze match needed')
  const workflowStatus = computed(() => canSave.value ? 'Ready to review' : 'Needs episode source')
  const needsEpisodeSource = computed(() => isSeriesSelected.value && !canSave.value)
  const reviewDescriptionId = computed(() => needsEpisodeSource.value ? episodeSourceHintId : undefined)

  const episodeSourceHint = computed(() => {
    if (showSearching.value) {return 'Searching TVMaze for episode sources…'}

    if (showError.value) {return 'TVMaze search failed. Try searching again to continue.'}

    if (noShowMatch.value) {return 'Enter a reason of at least 8 characters to continue without a TVMaze match.'}

    if (!showSearched.value) {return 'Search TVMaze to choose an episode source before reviewing.'}

    return 'Choose a TVMaze show, or record why no show matches, to continue.'
  })

  const isSaveDisabled = computed(() => !canSave.value || saving.value)

  function isSelectedTitle(item: ImportSearchItem): boolean {
    return selected.value?.id === item.id && selected.value.type === item.type
  }

  function isSelectedShow(show: ImportShowItem): boolean {
    return showChoice.value === show.id
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

  function resetShows(): void {
    showRequest.cancel()

    showSearching.value = false
    shows.value = []
    showChoice.value = null
    showSearched.value = false
    showError.value = ''
    noShowMatch.value = false
    noMatchReason.value = ''
  }

  async function findTitles(page = 1): Promise<void> {
    if (!canManage.value || query.value.length < 2) {return}

    const controller = titleRequest.start()
    const searchQuery = query.value
    const searchType = titleType.value

    searching.value = true
    searchError.value = ''

    if (page === 1) {
      results.value = []
      nextPage.value = null
      searched.value = false
      selected.value = null

      resetShows()
    }

    try {
      const body = await requestFetch('/api/catalog/imports/search', {
        query: {
          type: searchType,
          query: searchQuery,
          page
        },

        retry: 0,
        signal: controller.signal
      })

      if (!titleRequest.isCurrent(controller) || !canManage.value) {return}

      const response = v.parse(importSearchResponseSchema, body)

      results.value = page === 1 ? response.items : [...results.value, ...response.items]
      nextPage.value = response.nextPage
      searched.value = true
      announcement.value = `${results.value.length} title${results.value.length === 1 ? '' : 's'} shown.`
    } catch (error) {
      if (titleRequest.isCurrent(controller)) {searchError.value = handleFailure(error, 'We couldn’t search TMDB. Try again.')}
    } finally {
      if (titleRequest.finish(controller)) {searching.value = false}
    }
  }

  function loadMoreTitles(): void {
    if (nextPage.value !== null) {
      void findTitles(nextPage.value)
    }
  }

  async function findShows(): Promise<void> {
    if (!canManage.value || selected.value?.type !== 'series' || showQuery.value.length < 2) {return}

    const controller = showRequest.start()

    showSearching.value = true
    showError.value = ''
    showSearched.value = false
    showChoice.value = null
    noShowMatch.value = false

    try {
      const body = await requestFetch('/api/catalog/imports/shows', {
        query: { query: showQuery.value },
        retry: 0,
        signal: controller.signal
      })

      if (!showRequest.isCurrent(controller) || !canManage.value) {return}

      shows.value = v.parse(importShowSearchResponseSchema, body).items
      showSearched.value = true
      announcement.value = `${shows.value.length} TVMaze show${shows.value.length === 1 ? '' : 's'} found.`
    } catch (error) {
      if (showRequest.isCurrent(controller)) {showError.value = handleFailure(error, 'We couldn’t search TVMaze. Try again.')}
    } finally {
      if (showRequest.finish(controller)) {showSearching.value = false}
    }
  }

  async function selectTitle(item: ImportSearchItem): Promise<void> {
    if (item.type === 'series') {
      titleRequest.cancel()

      searching.value = false
    }

    selected.value = item
    showQuery.value = item.originalTitle

    resetShows()

    saveError.value = ''
    announcement.value = `${item.title} selected for review.`

    await nextTick()

    if (item.type === 'series') {
      showHeading.value?.focus()
      await findShows()
    }
  }

  async function changeTitle(): Promise<void> {
    selected.value = null

    resetShows()

    announcement.value = 'Choose another TMDB title.'

    await nextTick()
    titleSearch.value?.focus()
  }

  async function chooseShow(id: number): Promise<void> {
    showChoice.value = id
    noShowMatch.value = false
    noMatchReason.value = ''
    announcement.value = `TVMaze show #${id} selected.`

    await nextTick()
    reviewButton.value?.focus()
  }

  function createSelection(choice: ImportSearchItem): ImportSelection {
    if (choice.type === 'movie') {
      return {
        type: 'movie',
        tmdbId: choice.id
      }
    }

    if (showChoice.value === null) {
      return {
        type: 'series',
        tmdbId: choice.id,

        tvmaze: {
          status: 'verified_absent',
          reason: noMatchReason.value
        }
      }
    }

    return {
      type: 'series',
      tmdbId: choice.id,

      tvmaze: {
        status: 'selected',
        id: showChoice.value
      }
    }
  }

  async function savePreview(): Promise<void> {
    if (!canSave.value || selected.value === null) {return}

    const controller = saveRequest.start()

    saving.value = true
    saveError.value = ''

    const selection = createSelection(selected.value)

    try {
      const body = await requestFetch('/api/catalog/imports/previews', {
        method: 'POST',
        body: selection,
        retry: 0,
        signal: controller.signal
      })

      if (!saveRequest.isCurrent(controller) || !canManage.value) {return}

      const response = v.parse(importPreviewResponseSchema, body)
      const previewLocation = `/manage/imports/previews/${response.preview.id}`

      await navigateTo(previewLocation)
    } catch (error) {
      if (saveRequest.isCurrent(controller)) {saveError.value = handleFailure(error, 'We couldn’t save the preview. Try again.')}
    } finally {
      if (saveRequest.finish(controller)) {saving.value = false}
    }
  }

  watch([selected, showChoice, noShowMatch, noMatchReason], () => {
    saveRequest.cancel()

    saving.value = false
    saveError.value = ''
  })

  watch([titleType, query], () => {
    titleRequest.cancel()

    searching.value = false
    results.value = []
    nextPage.value = null
    searched.value = false
    selected.value = null

    resetShows()
  })

  watch(showQuery, resetShows)

  watch(canManage, (allowed) => {
    if (allowed) {
      return
    }

    titleRequest.cancel()

    searching.value = false

    showRequest.cancel()

    showSearching.value = false

    saveRequest.cancel()

    saving.value = false
    nextPage.value = null
    results.value = []
    selected.value = null
    shows.value = []
  })
</script>

<style module>
  @layer reset, vendor, tokens, base, components, utilities;
  @layer components {
    .component { display: grid; align-items: start; gap: var(--space-6); }
    .search { display: grid; gap: var(--space-5); min-inline-size: 0; }
    .srOnly { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    .typePicker { display: flex; gap: var(--space-1); padding: var(--space-1); border: 1px solid var(--color-border); border-radius: var(--radius-round); background: var(--color-surface); box-shadow: var(--shadow-card); }
    .typeChoice { position: relative; display: flex; align-items: center; justify-content: center; flex: 1; min-block-size: 2.75rem; border: 1px solid transparent; border-radius: var(--radius-round); color: var(--color-text-secondary); cursor: pointer; }
    .typeChoice input { position: absolute; inline-size: 1px; block-size: 1px; opacity: 0; }
    .typeChoice:has(:checked) { background: var(--color-accent-fill); color: var(--color-on-accent); font-weight: 600; }
    .typeChoice:has(:focus-visible) { outline: .1875rem solid var(--color-focus); outline-offset: .1875rem; }
    .loading { display: grid; gap: var(--space-4); }
    .loading span { block-size: 10rem; border-radius: var(--radius-md); background: var(--color-surface-muted); }
    .empty { display: grid; justify-items: start; gap: var(--space-2); padding-block: var(--space-8); color: var(--color-text-secondary); }
    .empty :global(svg) { inline-size: 2rem; block-size: 2rem; }
    .empty h3 { color: var(--color-text-primary); font-size: 1.125rem; font-weight: 600; }
    .searchHint, .resultCount { color: var(--color-text-secondary); font-size: .875rem; }
    .results { display: grid; gap: var(--space-4); padding: 0; list-style: none; }
    .result { display: grid; grid-template-columns: 4.5rem minmax(0, 1fr); column-gap: var(--space-4); row-gap: var(--space-2); padding: var(--space-3); border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface); box-shadow: var(--shadow-card); }
    .result[data-selected='true'] { border-color: var(--color-accent); }
    .resultPoster { grid-column: 1; grid-row: 1 / 3; border-radius: var(--radius-sm); }
    .resultInformation { min-inline-size: 0; }
    .resultTitle { font-size: 1.125rem; font-weight: 600; line-height: 1.3; margin-block-end: var(--space-1); }
    .meta { color: var(--color-text-secondary); font-size: .875rem; }
    .sourceId { margin-block-start: var(--space-1); color: var(--color-text-secondary); font-size: .75rem; font-variant-numeric: tabular-nums; }
    .moreResults { justify-self: start; min-block-size: 2.75rem; padding: var(--space-2) var(--space-4); font-size: .875rem; }
    .resultActions { grid-column: 2; display: flex; align-items: end; justify-content: end; flex-wrap: wrap; gap: var(--space-2); }
    .useButton[data-variant='secondary'] { min-block-size: 2.75rem; padding: var(--space-2) var(--space-4); border-color: var(--color-accent); font-weight: 600; font-size: .875rem; }
    .useButton[aria-pressed='true'] { background: var(--color-surface-selected); }
    .selected { display: inline-flex; align-items: center; gap: var(--space-1); align-self: center; color: var(--color-accent); font-size: .75rem; font-weight: 600; }
    .selected :global(svg) { inline-size: 1rem; block-size: 1rem; }
    .metadata { position: relative; min-inline-size: 0; }
    .fields { display: grid; gap: var(--space-5); }
    .fieldValue { display: grid; gap: var(--space-2); min-inline-size: 0; }
    .fieldValue dt { color: var(--color-text-secondary); font-size: .875rem; }
    .fieldValue dd { font-weight: 500; }
    .selection { display: grid; gap: var(--space-6); min-inline-size: 0; padding: var(--space-5); border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface); box-shadow: var(--shadow-card); }
    .selectionPanel { display: grid; gap: var(--space-6); min-inline-size: 0; }
    .poster { display: none; justify-items: center; gap: var(--space-3); }
    .poster > :first-child { max-inline-size: 10rem; }
    .subheading { font-size: 1rem; font-weight: 500; }
    .sources, .workflow { display: grid; gap: var(--space-2); }
    .sourceStatus { display: flex; align-items: center; gap: var(--space-2); font-size: .875rem; }
    .sourceStatus :global(svg) { color: var(--color-accent); inline-size: 1.25rem; block-size: 1.25rem; }
    .showMatching { display: grid; gap: var(--space-4); margin-block-start: var(--space-3); padding-block-start: var(--space-5); border-block-start: 1px solid var(--color-border); }
    .showSearchStatus {
      color: var(--color-text-secondary);
      font-size: .875rem;
      &:global(.is-idle) { visibility: hidden; }
    }
    .showResults { display: grid; gap: var(--space-3); padding: 0; list-style: none; }
    .showResult { background: var(--color-surface); display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--space-3); padding: var(--space-4); border: 1px solid var(--color-border); border-radius: var(--radius-md); }
    .showResult[data-selected='true'] { border-color: var(--color-accent); }
    .showTitle { font-size: 1rem; font-weight: 600; }
    .sourceLink { display: inline-flex; align-items: center; gap: var(--space-1); min-block-size: 1.75rem; font-size: .875rem; text-underline-offset: .2em; }
    .sourceLink :global(svg) { inline-size: 1rem; block-size: 1rem; }
    .showActions { display: flex; align-items: center; justify-content: end; margin-inline-start: auto; gap: var(--space-3); }
    .noMatch { display: grid; gap: var(--space-3); }
    .choiceLabel { display: flex; align-items: center; gap: var(--space-2); min-block-size: 2.75rem; font-size: .875rem; }
    .field { display: grid; gap: var(--space-2); font-size: .875rem; font-weight: 600; }
    .field textarea { inline-size: 100%; padding: var(--space-3); border: 1px solid var(--color-border-strong); border-radius: var(--radius-md); background: var(--color-surface); color: var(--color-text-primary); resize: vertical; font: inherit; }
    .nextAction { display: grid; gap: var(--space-4); margin-block-start: var(--space-2); padding-block-start: var(--space-5); border-block-start: 1px solid var(--color-border); }
    .caption { color: var(--color-text-secondary); font-size: .875rem; }
    .credits { display: flex; align-items: start; flex-wrap: wrap; gap: var(--space-4); margin-block-start: var(--space-10); padding-block-start: var(--space-6); border-block-start: 1px solid var(--color-border); color: var(--color-text-secondary); font-size: .75rem; }
    .credits img { margin-block-start: var(--space-1); inline-size: 6rem; block-size: auto; }
    .credits a { color: inherit; text-underline-offset: .2em; }
    @media (width >= 40rem) {
      .component { grid-template-columns: minmax(0, 1fr) 13.5rem; }
      .poster { display: grid; }
      .search { grid-column: 1 / -1; }
      .metadata { grid-column: 1; }
      .selection { display: contents; }
      .selectionPanel { grid-column: 2; grid-row: 2; padding: var(--space-5); border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface); box-shadow: var(--shadow-card); }
      .nextAction { grid-column: 1 / -1; }
      .result { grid-template-columns: 5.5rem minmax(0, 1fr); gap: var(--space-3) var(--space-5); }
      .resultTitle { font-size: 1.375rem; }
    }
    @media (width >= 64rem) {
      .component { grid-template-columns: minmax(0, 1fr) var(--layout-rail); grid-template-rows: min-content 1fr; gap: var(--space-8); }
      .search { grid-column: 1; grid-row: 1; }
      .metadata { grid-row: 2; }
      .selection { display: grid; grid-column: 2; grid-row: 1 / 3; }
      .selectionPanel { grid-column: auto; grid-row: auto; padding: 0; border: 0; box-shadow: none; }
      .fields { grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr); }
      .result { grid-template-columns: 7rem minmax(0, 1fr); }
      .resultInformation { padding-block-start: var(--space-3); }
      .selection { padding: var(--space-6); }
      .poster > :first-child { max-inline-size: 11rem; }
    }
  }
</style>
