import { Hono } from 'hono'
import { createAuthApp } from './auth/routes.ts'
import { createCatalogApp } from './catalog/routes.ts'
import { scheduled } from './catalog/import/scheduled.ts'

const app = new Hono<{ Bindings: CloudflareBindings }>()
const authApp = createAuthApp()
const catalogApp = createCatalogApp()

app.get('/health', (context) => context.json({
  status: 'ok',
  service: 'tv-api'
}))

app.route('/', authApp)
app.route('/', catalogApp)

export default {
  fetch: app.fetch,
  scheduled
} satisfies ExportedHandler<CloudflareBindings>
