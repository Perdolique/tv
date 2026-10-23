/* oxlint-disable import/no-relative-parent-imports -- Title requests reuse the catalog session boundary and shared source readers. */
import type { Hono, Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import * as v from 'valibot'
import { titleRequestInputSchema, type RequestCard, type TitleRequestInput } from '@tv/shared/catalog-requests'
import { CatalogHttpError } from '../errors.ts'

import {
  withCatalogSession,
  withCatalogImportAccess,
  type CatalogEnvironment,
  type CatalogDependencies
} from '../session.ts'

import { searchTmdb, parseImportSearchQuery, parseImportSearchPage } from '../import/search.ts'
import { loadTmdbCard } from '../import/sources.ts'
import { findImportCatalogMatches } from '../import/matches.ts'
import { findRequestedCatalogItem, findOwnTitleRequest, listTitleRequests, saveTitleRequest } from './repository.ts'

const requestPageSchema = v.pipe(v.number(), v.safeInteger(), v.minValue(1), v.maxValue(1_000_000))

async function limitRequest(context: Context<CatalogEnvironment>, userId: string): Promise<void> {
  const result = await context.env.CATALOG_REQUEST_RATE_LIMITER.limit({ key: userId })

  if (!result.success) {
    context.header('Retry-After', '60')

    throw new CatalogHttpError('RATE_LIMITED', 429)
  }
}

function requestCard(input: TitleRequestInput, card: Awaited<ReturnType<typeof loadTmdbCard>>['card']): RequestCard {
  const translation = card.translations.find(item => item.language === 'en')
  const title = translation?.title.value ?? card.originalTitle.value
  const description = translation?.description.value ?? null
  const path = card.posterPath.value
  const hasPoster = path !== null && /^\/[a-zA-Z0-9]+\.(?:jpg|jpeg|png|webp)$/u.test(path)
  const posterUrl = hasPoster ? `https://image.tmdb.org/t/p/w500${path}` : null

  return {
    type: input.type,
    tmdbId: input.tmdbId,
    title,
    originalTitle: card.originalTitle.value,
    year: card.releaseYear.value,
    description,
    posterUrl
  }
}

function parseSelection(type: unknown, id: unknown): TitleRequestInput {
  const tmdbId = Number(id)

  const parsed = v.safeParse(titleRequestInputSchema, {
    type,
    tmdbId
  })

  if (!parsed.success) { throw new CatalogHttpError('INVALID_REQUEST', 400) }

  return parsed.output
}

function parseTitleRequestPage(value: string | null): number {
  const page = value === null ? 1 : Number(value)

  if (!v.is(requestPageSchema, page)) {
    throw new CatalogHttpError('INVALID_REQUEST', 400, {
      fields: { page: 'Use a positive page number up to 1000000.' }
    })
  }

  return page
}

function registerTitleRequestRoutes(app: Hono<CatalogEnvironment>, dependencies: CatalogDependencies): void {
  app.get('/api/catalog/requests/search', async context => withCatalogSession(context, dependencies.connectDatabase, async session => {
    const url = new URL(context.req.url)
    const rawType = url.searchParams.get('type')
    const rawQuery = url.searchParams.get('query')
    const rawPage = url.searchParams.get('page')
    const input = parseSelection(rawType, 1)
    const query = parseImportSearchQuery(rawQuery)
    const page = parseImportSearchPage(rawPage)

    await limitRequest(context, session.user.id)

    const results = await searchTmdb({
      type: input.type,
      query,
      page,
      token: context.env.TMDB_READ_ACCESS_TOKEN
    })

    return context.json(results)
  }))

  app.get('/api/catalog/requests/preview', async context => withCatalogSession(context, dependencies.connectDatabase, async session => {
    const url = new URL(context.req.url)
    const rawType = url.searchParams.get('type')
    const rawTmdbId = url.searchParams.get('tmdbId')
    const input = parseSelection(rawType, rawTmdbId)

    await limitRequest(context, session.user.id)

    const source = await loadTmdbCard(input, context.env.TMDB_READ_ACCESS_TOKEN, {})
    const card = requestCard(input, source.card)
    const catalogItemId = await findRequestedCatalogItem(session.database, input.type, input.tmdbId)
    const matches = await findImportCatalogMatches(session.database, input, source.card)
    const similarMatches = matches.filter(match => match.kind === 'possible_title')

    const similar = similarMatches.map(match => {return {
      id: match.id,
      title: match.title,
      year: match.year,
      type: match.type
    }})

    return context.json({
      card,
      catalogItemId,
      similar
    })
  }))

  app.post('/api/catalog/requests', async context => withCatalogSession(context, dependencies.connectDatabase, async session => {
    const checkBodySize = bodyLimit({
      maxSize: 2048,
      onError: () => { throw new CatalogHttpError('INVALID_REQUEST', 413) }
    })

    await checkBodySize(context, async () => {
      // Continue after the authenticated body-size check.
    })

    const body = context.req.json()
    const raw: unknown = await body.catch(() => null)
    const parsed = v.safeParse(titleRequestInputSchema, raw)

    if (!parsed.success) { throw new CatalogHttpError('INVALID_REQUEST', 400) }

    const input = parsed.output

    await limitRequest(context, session.user.id)

    const existing = await findOwnTitleRequest(session.database, session.user.id, input.type, input.tmdbId)

    if (existing !== null) {
      return context.json({
        request: existing,
        catalogItemId: existing.catalogItemId
      })
    }

    const catalogItemId = await findRequestedCatalogItem(session.database, input.type, input.tmdbId)

    if (catalogItemId !== null) {
      return context.json({
        request: null,
        catalogItemId
      })
    }

    const source = await loadTmdbCard(input, context.env.TMDB_READ_ACCESS_TOKEN, {})
    const card = requestCard(input, source.card)
    const request = await saveTitleRequest(session.database, session.user.id, card)

    return context.json({
      request,
      catalogItemId: request.catalogItemId
    }, 201)
  }))

  app.get('/api/catalog/requests', async context => withCatalogSession(context, dependencies.connectDatabase, async session => {
    const url = new URL(context.req.url)
    const rawPage = url.searchParams.get('page')
    const page = parseTitleRequestPage(rawPage)
    const result = await listTitleRequests(session.database, session.user.id, page)

    return context.json(result)
  }))

  app.get('/api/catalog/manage/requests', async context => withCatalogImportAccess(context, dependencies.connectDatabase, async session => {
    const url = new URL(context.req.url)
    const rawPage = url.searchParams.get('page')
    const page = parseTitleRequestPage(rawPage)
    const result = await listTitleRequests(session.database, null, page)

    return context.json(result)
  }))
}
export { registerTitleRequestRoutes }
