import { Hono } from 'hono'

const app = new Hono<{ Bindings: CloudflareBindings }>()

app.get('/health', (context) => context.json({
  status: 'ok',
  service: 'tv-api'
}))

export default app
