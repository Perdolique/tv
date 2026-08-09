# TV

TV is a service for finding movies and series, following them, and seeing their upcoming releases.

This repository currently contains the minimal Cloudflare foundation: a Nuxt SSR Worker, a Hono API Worker, and a shared Drizzle package. It does not provision or deploy cloud resources and does not connect to a database yet.

## Prerequisites

- Node.js 24.14
- pnpm 11.20.0
- Chromium installed for Playwright (`vp exec playwright install chromium`)

Install dependencies with `vp install`.

## Local development

Run both applications:

```shell
vp run dev
```

- Web: <http://127.0.0.1:3001>
- API health check: <http://127.0.0.1:8788/health>

## Commands

| Command | Purpose |
| --- | --- |
| `vp run build` | Build and validate both Cloudflare Workers with Wrangler dry runs |
| `vp run lint:markdown` | Lint Markdown files |
| `vp run lint:oxlint` | Lint source and configuration files |
| `vp run test:typecheck` | Type-check every workspace and verify generated Worker types |
| `vp run test:unit:ci` | Run API and database wiring tests once |
| `vp run test:e2e:ci` | Build the web Worker and run Chromium browser tests |
| `vp run cf-typegen` | Regenerate types for both Workers |

## Repository structure

```text
tv/
├── apps/
│   ├── web/          # Nuxt SSR Worker
│   └── api/          # Hono API Worker
└── packages/
    └── database/     # Shared Drizzle factory, empty schema, and migrations
```
