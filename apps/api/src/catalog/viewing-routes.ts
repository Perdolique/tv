import type { Hono } from 'hono'
import { canonicalizeTitleLocale } from './search.ts'
import { withCatalogSession, type CatalogDependencies, type CatalogEnvironment } from './session.ts'
import { createViewingHistoryResponse, decodeViewingCursor } from './viewing-history.ts'
import { findViewingHistoryRows, findViewingSummary } from './viewing-repository.ts'

function registerCatalogViewingRoutes(app: Hono<CatalogEnvironment>, dependencies: CatalogDependencies): void {
  app.get('/api/catalog/viewing-history', async (context) => {
    const url = new URL(context.req.url)

    const response = await withCatalogSession(context, dependencies.connectDatabase, async (session) => {
      const cursorValue = url.searchParams.get('cursor')
      const localeValue = url.searchParams.get('titleLocale')
      const cursor = decodeViewingCursor(cursorValue)
      const locale = canonicalizeTitleLocale(localeValue)
      const rows = await findViewingHistoryRows(session.database, session.user.id, cursor)

      return createViewingHistoryResponse(rows, locale)
    })

    return context.json(response)
  })

  app.get('/api/catalog/viewing-summary', async (context) => {
    const url = new URL(context.req.url)

    const response = await withCatalogSession(context, dependencies.connectDatabase, async (session) => {
      const localeValue = url.searchParams.get('titleLocale')
      const locale = canonicalizeTitleLocale(localeValue)

      return findViewingSummary(session.database, session.user.id, locale)
    })

    return context.json(response)
  })
}

export { registerCatalogViewingRoutes }
