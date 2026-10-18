import type { Hono } from 'hono'
import { canonicalizeTitleLocale } from './search.ts'
import { withCatalogSession, type CatalogDependencies, type CatalogEnvironment } from './session.ts'
import { parseViewingStatus } from './viewing-history.ts'
import { findViewingHistory, findViewingSummary } from './viewing-repository.ts'

function registerCatalogViewingRoutes(app: Hono<CatalogEnvironment>, dependencies: CatalogDependencies): void {
  app.get('/api/catalog/viewing-history', async (context) => {
    const url = new URL(context.req.url)

    const response = await withCatalogSession(context, dependencies.connectDatabase, async (session) => {
      const cursorValue = url.searchParams.get('cursor')
      const localeValue = url.searchParams.get('titleLocale')
      const locale = canonicalizeTitleLocale(localeValue)
      const statusValue = url.searchParams.get('status')
      const status = parseViewingStatus(statusValue)

      return findViewingHistory(session.database, {
        userId: session.user.id,
        status,
        titleLocale: locale
      }, cursorValue)
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
