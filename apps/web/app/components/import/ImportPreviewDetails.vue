<template>
  <div :class="$style.component">
    <section v-if="preview.data.card" :class="$style.section" :aria-labelledby="translationsHeadingId">
      <h2 :id="translationsHeadingId" :class="$style.heading">Titles & descriptions</h2>
      <details v-for="(translation, index) in preview.data.card.translations" :key="translation.locale" :class="$style.disclosure" :open="index === 0">
        <summary :class="$style.summary"><span>{{ translation.language }}</span><span :class="$style.meta">{{ translation.locale }}</span></summary>
        <dl :class="$style.translation" :lang="translation.locale">
          <div :class="$style.field"><dt>Title</dt><dd>{{ availableText(translation.title.value) }}</dd></div>
          <div :class="$style.field"><dt>Overview</dt><dd>{{ availableText(translation.description.value) }}</dd></div>
        </dl>
      </details>
    </section>

    <section :id="matchesId" :class="$style.section" :aria-labelledby="matchesHeadingId">
      <h2 :id="matchesHeadingId" :class="$style.heading">Catalog matches</h2>
      <p v-if="hasNoMatches" :class="$style.meta">No catalog matches found.</p>
      <ul v-else :class="$style.matches">
        <li v-for="match in preview.matches" :key="match.id" :class="$style.match">
          <div>
            <p :class="$style.meta">{{ matchLabel(match) }}</p>
            <NuxtLink :class="$style.matchTitle" :to="matchLocation(match)">{{ match.title }}</NuxtLink>
            <p :class="$style.meta">{{ matchMetadata(match) }}</p>
          </div>
          <Icon aria-hidden="true" mode="svg" name="hugeicons:arrow-up-right-01" />
        </li>
      </ul>
      <p v-if="hasPossibleMatches" :class="$style.meta">Name matches are hints. If a match is the same title, stop here to avoid a duplicate. Linking an unlinked card is not available yet.</p>
    </section>

    <section :class="$style.section" :aria-labelledby="changesHeadingId">
      <h2 :id="changesHeadingId" :class="$style.heading">Planned changes</h2>
      <p v-if="hasNoChanges" :class="$style.meta">No field changes are planned.</p>
      <details v-for="group in changeGroups" :key="group.label" :class="$style.disclosure" :open="group.open">
        <summary :class="$style.summary"><span>{{ group.label }}</span><span :class="$style.meta">{{ countLabel(group.changes.length, 'field') }}</span></summary>
        <ul :class="$style.changes">
          <li v-for="change in group.changes" :key="change.key" :class="$style.change">
            <div :class="$style.changeHeading"><h3 :class="$style.fieldName">{{ change.fieldLabel }}</h3><AppStatusChip :tone="change.tone">{{ change.actionLabel }}</AppStatusChip></div>
            <dl :class="$style.values"><div><dt>Current</dt><dd>{{ change.before }}</dd></div><div><dt>Saved source</dt><dd>{{ change.sourceValue }}</dd></div></dl>
          </li>
        </ul>
      </details>
    </section>

    <section v-if="hasEpisodes" :class="$style.section" :aria-labelledby="episodesHeadingId">
      <h2 :id="episodesHeadingId" :class="$style.heading">{{ episodesHeading }}</h2>
      <details v-for="season in seasons" :key="season.number" :class="$style.disclosure">
        <summary :class="$style.summary"><span>Season {{ season.number }}</span><span :class="$style.meta">{{ countLabel(season.episodes.length, 'episode') }}</span></summary>
        <ol :class="$style.episodes">
          <li v-for="episode in season.episodes" :key="episode.identity.externalId" :class="$style.episode">
            <span :class="$style.episodeNumber">E{{ episode.episodeNumber.value }}</span>
            <div><p>{{ episode.title.value ?? 'Untitled episode' }}</p><p :class="$style.meta">{{ episode.airDate.value ?? 'Air date unknown' }} · TVMaze #{{ episode.identity.externalId }}</p></div>
          </li>
        </ol>
      </details>
    </section>

  </div>
</template>

<script lang="ts" setup>
  import { Icon } from '#components'
  import type { ImportCatalogMatch, ImportChange, ImportEpisode, ImportPreviewView } from '@tv/shared/catalog-import'
  import { computed, useId } from 'vue'
  import AppStatusChip, { type StatusChipTone } from '~/components/ui/AppStatusChip.vue'

  interface ChangeRow {
    key: string;
    fieldLabel: string;
    actionLabel: string;
    tone: StatusChipTone;
    before: string | number;
    sourceValue: string | number;
  }

  interface Props {
    preview: ImportPreviewView;
    matchesId: string;
  }

  const { preview } = defineProps<Props>()
  const matchesHeadingId = useId()
  const translationsHeadingId = useId()
  const episodesHeadingId = useId()
  const changesHeadingId = useId()
  const hasNoMatches = computed(() => preview.matches.length === 0)
  const hasPossibleMatches = computed(() => preview.data.additions.createItem && preview.matches.some(match => match.kind === 'possible_title'))
  const hasEpisodes = computed(() => preview.data.episodes.length > 0)
  const episodesHeading = computed(() => `Episodes (${preview.data.episodes.length})`)
  const hasNoChanges = computed(() => preview.data.changes.length === 0)

  const seasons = computed(() => {
    const groups = new Map<number, ImportEpisode[]>()

    for (const episode of preview.data.episodes) {
      const number = episode.seasonNumber.value
      const episodes = groups.get(number) ?? []

      episodes.push(episode)
      groups.set(number, episodes)
    }

    const groupedSeasons = Array.from(groups, ([number, episodes]) => {
      return {
        number,
        episodes
      }
    })

    return groupedSeasons
  })

  function countLabel(count: number, noun: string): string {
    const label = count === 1 ? noun : `${noun}s`
    const formatted = `${count} ${label}`

    return formatted
  }

  function availableText(value: string | null): string {
    return value ?? 'Not available'
  }

  function matchLabel(match: ImportCatalogMatch): string {
    const label = match.kind === 'exact_source' ? 'Linked by source ID' : 'Possible name match'

    return label
  }

  function matchLocation(match: ImportCatalogMatch): string {
    const location = `/titles/${match.id}`

    return location
  }

  function matchMetadata(match: ImportCatalogMatch): string {
    const year = match.year ?? 'Year unknown'
    const type = match.type === 'movie' ? 'Movie' : 'Series'
    const metadata = `${year} · ${type}`

    return metadata
  }

  function fieldLabel(change: ImportChange): string {
    const name = {
      title: 'Title',
      description: 'Description',
      releaseYear: 'Release year',
      posterPath: 'Poster',
      seasonNumber: 'Season',
      episodeNumber: 'Episode',
      sourceTitle: 'Episode title',
      airDate: 'Air date'
    }[change.field]

    const locale = change.locale ? ` · ${change.locale}` : ''
    const episode = change.episodeExternalId ? ` · TVMaze #${change.episodeExternalId}` : ''
    const label = `${name}${locale}${episode}`

    return label
  }

  function changeKey(change: ImportChange, index: number): string {
    const key = `${change.target}-${change.field}-${change.locale}-${change.episodeExternalId}-${index}`

    return key
  }

  function changeValue(value: ImportChange['before']): string | number {
    return value ?? '—'
  }

  function actionLabel(action: ImportChange['action']): string {
    return {
      add: 'Add',
      update: 'Update',
      unchanged: 'Unchanged',
      preserve_manual: 'Keep manual edit',
      retain_missing: 'Keep local value'
    }[action]
  }

  function actionTone(action: ImportChange['action']): StatusChipTone {
    const tones: Record<ImportChange['action'], StatusChipTone> = {
      add: 'success',
      update: 'info',
      unchanged: 'neutral',
      preserve_manual: 'warning',
      retain_missing: 'warning'
    }

    return tones[action]
  }

  const changeGroups = computed(() => {
    const changed: ChangeRow[] = []
    const kept: ChangeRow[] = []
    const episodes: ChangeRow[] = []
    const indexedChanges = preview.data.changes.entries()

    for (const [index, change] of indexedChanges) {
      const key = changeKey(change, index)
      const label = fieldLabel(change)
      const action = actionLabel(change.action)
      const tone = actionTone(change.action)
      const before = changeValue(change.before)
      const sourceValue = changeValue(change.sourceValue)

      const row: ChangeRow = {
        key,
        fieldLabel: label,
        actionLabel: action,
        tone,
        before,
        sourceValue
      }

      if (change.action !== 'add' && change.action !== 'update') {
        kept.push(row)
      } else if (change.target === 'episode') {
        episodes.push(row)
      } else {
        changed.push(row)
      }
    }

    const groups = [
      {
        label: 'Card fields',
        changes: changed,
        open: true
      },
      {
        label: 'Episode fields',
        changes: episodes,
        open: false
      },
      {
        label: 'Kept as they are',
        changes: kept,
        open: false
      }
    ]

    const populatedGroups = groups.filter(group => group.changes.length > 0)

    return populatedGroups
  })
</script>

<style module>
  @layer reset, vendor, tokens, base, components, utilities;
  @layer components {
    .component { container: preview-details / inline-size; display: grid; gap: var(--space-8); min-inline-size: 0; }
    .section { scroll-margin-block-start: var(--space-6); display: grid; gap: var(--space-4); min-inline-size: 0; }
    .heading { font-size: 1.375rem; line-height: 1.3; font-weight: 600; }
    .meta { color: var(--color-text-secondary); font-size: .875rem; font-weight: 400; }
    .matches { display: grid; gap: var(--space-3); padding: 0; list-style: none; }
    .match { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); padding: var(--space-4); border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface); }
    .match :global(svg) { inline-size: 1.25rem; block-size: 1.25rem; flex-shrink: 0; color: var(--color-text-secondary); }
    .matchTitle { display: inline-block; padding-block: var(--space-1); color: var(--color-text-primary); font-weight: 600; text-underline-offset: .2em; }
    .disclosure { min-inline-size: 0; border-block-end: 1px solid var(--color-border); }
    .summary { padding-block: var(--space-3); cursor: pointer; font-weight: 600; }
    .summary::marker { color: var(--color-text-secondary); }
    .summary > .meta { margin-inline-start: var(--space-3); white-space: nowrap; }
    .translation { display: grid; gap: var(--space-5); padding-block: var(--space-3) var(--space-5); }
    .field { display: grid; gap: var(--space-2); font-size: .875rem; }
    .field dt { color: var(--color-text-secondary); }
    .field dd { white-space: pre-wrap; }
    .episodes { padding: 0; list-style: none; }
    .episode { display: grid; grid-template-columns: 2.75rem minmax(0, 1fr); gap: var(--space-3); padding-block: var(--space-3); border-block-start: 1px solid var(--color-border); }
    .episodeNumber { color: var(--color-text-secondary); font-variant-numeric: tabular-nums; }
    .changes { padding: 0; list-style: none; }
    .change { display: grid; gap: var(--space-3); padding-block: var(--space-4); border-block-start: 1px solid var(--color-border); }
    .changeHeading { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--space-2); }
    .fieldName { font-size: .875rem; font-weight: 600; }
    .values { display: grid; gap: var(--space-3); font-size: .875rem; }
    .values div { display: grid; gap: var(--space-1); min-inline-size: 0; }
    .values dt { color: var(--color-text-secondary); font-size: .75rem; }
    .values dd { white-space: pre-wrap; }
    @container preview-details (inline-size >= 30rem) { .values { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (width >= 40rem) { .heading { font-size: 1.5rem; } }
  }
</style>
