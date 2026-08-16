import { Hono } from 'hono'
import { createAuthApp } from './auth/routes.ts'

const app = new Hono<{ Bindings: CloudflareBindings; }>()
const authApp = createAuthApp()

app.get('/health', (context) => context.json({
  status: 'ok',
  service: 'tv-api'
}))

app.route('/', authApp)

export default app
