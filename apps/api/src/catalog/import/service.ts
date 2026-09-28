import type { ImportPreviewData, PreviewIssue } from '@tv/database/import-preview'
import { catalogImportPreviews } from '@tv/database/schema'
import { findRootCause, serializeError } from '@tv/shared/errors'
import * as v from 'valibot'

// oxlint-disable-next-line import/no-relative-parent-imports -- Imports reuse the catalog access and session boundaries.
import type { resolveCurrentSession } from '../../auth/current-session.ts'

// oxlint-disable-next-line import/no-relative-parent-imports -- Imports reuse the catalog access and session boundaries.
import { CatalogHttpError } from '../errors.ts'

// oxlint-disable-next-line import/no-relative-parent-imports -- Imports reuse the catalog access and session boundaries.
import { hasCatalogImportPermission } from '../permissions.ts'
import { findImportCatalogMatches } from './matches.ts'
import { reviewSavedSources } from './preview-plan.ts'
import { preparePoster, type PreparedPoster } from './poster.ts'
import { findImportPreview, PREVIEW_LIFETIME_MS, type StoredPreview } from './repository.ts'
import { selectionSchema } from './selection.ts'
import { ImportSourceError, type SourceHttpOptions } from './source-http.ts'
import { loadTmdbCard, loadTvmazeShow } from './sources.ts'

type ImportSession = NonNullable<Awaited<ReturnType<typeof resolveCurrentSession>>>

interface ImportDependencies extends SourceHttpOptions {
  token: string;
  images: Pick<ImagesBinding, 'info' | 'input'>;
}

interface PreviewResult {
  status: 'ready' | 'blocked';
  preview: StoredPreview;
}

interface SourceFailureResult {
  status: 'source_failure';
  issue: PreviewIssue;
  retryAfterSeconds: number | null;
}

type ImportPreviewResult = PreviewResult | SourceFailureResult

const SOURCE_MESSAGES = {
  source_unavailable: 'The source is temporarily unavailable. Try again later.',
  source_not_found: 'The selected source record was not found.',
  source_unauthorized: 'The source credentials need attention.',
  source_invalid: 'The source returned invalid or incomplete data.',
  poster_failed: 'The source poster could not be prepared.'
} as const

function logSourceFailure(error: ImportSourceError, operatorId: string): void {
  const cause = findRootCause(error)
  const technicalError = serializeError(cause)

  const entry = JSON.stringify({
    message: 'catalog import source failed',
    operatorId,
    provider: error.provider,
    code: error.code,
    error: technicalError
  })

  // oxlint-disable-next-line eslint/no-console -- Keep the technical cause in private Worker diagnostics.
  console.error(entry)
}

async function requireImportPermission(session: ImportSession): Promise<void> {
  const allowed = await hasCatalogImportPermission(session.database, session.user.id)

  if (!allowed) {
    throw new CatalogHttpError('FORBIDDEN', 403)
  }
}

function recordExternalIdEvidence(data: ImportPreviewData): void {
  for (const key of ['imdb', 'thetvdb'] as const) {
    const first = data.evidence.tmdb?.[key] ?? null
    const second = data.evidence.tvmaze?.externalIds[key] ?? null

    if (first !== null && second !== null && first === second) {
      data.evidence.matchingIds.push(key)
    } else if (first !== null && second !== null) {
      data.sourceErrors.push({
        code: 'external_id_conflict',
        message: `TMDB and TVMaze have conflicting ${key} IDs.`
      })
    }
  }
}

// Selection is client data; the operator is supplied only by the resolved server session.
async function createImportPreview(session: ImportSession, input: unknown, dependencies: ImportDependencies): Promise<ImportPreviewResult> {
  await requireImportPermission(session)

  const parsed = v.safeParse(selectionSchema, input)

  if (!parsed.success) {
    throw new CatalogHttpError('INVALID_REQUEST', 400)
  }

  const selection = parsed.output

  const data: ImportPreviewData = {
    version: 3,
    target: { kind: 'unresolved' },
    candidates: [],
    sourcesFetchedAt: '',
    sourceErrors: [],
    sourceWarnings: [],
    card: null,
    episodes: [],

    evidence: {
      tmdb: null,
      tvmaze: null,
      matchingIds: []
    },

    warnings: [],
    errors: [],

    additions: {
      catalogItemId: null,
      createItem: false,
      episodeExternalIds: [],
      sourceLinks: []
    },

    changes: [],
    poster: null
  }

  let poster: PreparedPoster | null = null

  try {
    const tmdb = await loadTmdbCard(selection, dependencies.token, dependencies)

    data.card = tmdb.card
    data.evidence.tmdb = tmdb.externalIds

    if (selection.type === 'series' && selection.tvmaze.status === 'selected') {
      const tvmaze = await loadTvmazeShow(selection.tvmaze.id, dependencies)

      data.episodes = tvmaze.episodes
      data.evidence.tvmaze = tvmaze.evidence

      data.sourceErrors.push(...tvmaze.errors)
      recordExternalIdEvidence(data)

      if (data.evidence.matchingIds.length === 0) {
        data.sourceWarnings.push({
          code: 'explicit_match',
          message: 'No shared external ID confirms this explicitly selected show. Review its identity.'
        })
      }

      if (data.episodes.length === 0 && data.sourceErrors.length === 0) {
        data.sourceWarnings.push({
          code: 'episodes_empty',
          message: 'The selected show has no regular episodes.'
        })
      }
    } else if (selection.type === 'series') {
      data.sourceWarnings.push({
        code: 'show_verified_absent',
        message: 'The operator verified that no matching TVMaze show exists.'
      })
    }

    if (tmdb.card.releaseYear.value === null) {
      data.sourceWarnings.push({
        code: 'year_missing',
        message: 'The source release year is missing.'
      })
    }

    for (const language of ['en', 'ru']) {
      const available = tmdb.card.translations.some(translation => translation.language === language && translation.title.value !== null)

      if (language !== tmdb.card.originalLanguage.value && !available) {
        data.sourceWarnings.push({
          code: `translation_${language}_missing`,
          message: `The ${language} title translation is missing.`
        })
      }
    }

    if (tmdb.card.posterPath.value === null) {
      data.sourceWarnings.push({
        code: 'poster_missing',
        message: 'The source has no poster.'
      })
    } else {
      poster = await preparePoster(tmdb.card.posterPath.value, dependencies.images, dependencies)
      data.poster = poster.metadata
    }
  } catch (error) {
    if (!(error instanceof ImportSourceError)) {
      throw error
    }

    logSourceFailure(error, session.user.id)

    const issue = {
      code: error.code,
      message: SOURCE_MESSAGES[error.code]
    }

    if (error.temporary) {
      return {
        status: 'source_failure',
        issue,
        retryAfterSeconds: error.retryAfterSeconds
      }
    }

    data.sourceErrors.push(issue)
  }

  const sourcesFetchedAt = dependencies.now?.() ?? new Date()

  data.sourcesFetchedAt = sourcesFetchedAt.toISOString()

  const savedResult: PreviewResult = await session.database.transaction(async (transaction) => {
    data.candidates = await findImportCatalogMatches(transaction, selection, data.card)

    const exact = data.candidates.find(candidate => candidate.kind === 'exact_source')

    if (exact !== undefined) {
      data.target = {
        kind: 'existing',
        catalogItemId: exact.id
      }
    } else if (data.candidates.length === 0) {
      data.target = { kind: 'new' }
    }

    const reviewed = await reviewSavedSources(transaction, selection, data)
    const now = dependencies.now?.() ?? new Date()
    const expiresAt = new Date(now.getTime() + PREVIEW_LIFETIME_MS)
    const status = reviewed.data.errors.length === 0 ? 'ready' : 'blocked'

    const rows = await transaction.insert(catalogImportPreviews).values({
      operatorId: session.user.id,
      selection,
      data: reviewed.data,
      status,
      catalogFingerprint: reviewed.fingerprint,
      posterBytes: poster?.bytes ?? null,
      createdAt: now,
      expiresAt
    }).returning()

    const [preview] = rows

    if (preview === undefined) {
      throw new Error('Import preview was not saved')
    }

    return {
      status,
      preview
    }
  }, { isolationLevel: 'repeatable read' })

  return savedResult
}

async function openImportPreview(session: ImportSession, id: string, now = new Date()): Promise<StoredPreview | null> {
  await requireImportPermission(session)

  const validId = v.safeParse(v.pipe(v.string(), v.uuid()), id)

  if (!validId.success) {
    throw new CatalogHttpError('INVALID_REQUEST', 400)
  }

  return findImportPreview(session.database, {
    id,
    operatorId: session.user.id,
    now
  })
}

export { createImportPreview, openImportPreview, requireImportPermission, SOURCE_MESSAGES }
export type { ImportDependencies, ImportPreviewResult, ImportSession }
