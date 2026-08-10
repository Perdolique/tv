# TV

TV helps people discover movies and series, keep track of what interests them, and see what is coming next.

## Features

- Search a catalog of movies and series.
- View title details and release information.
- Follow movies and series.
- See upcoming releases for followed titles.
- Create an account and keep preferences across sessions.

## Technology

- Nuxt and Vue for the server-rendered web application.
- Hono and Cloudflare Workers for the API.
- PostgreSQL through Cloudflare Hyperdrive for application and catalog data.
- Drizzle ORM for schemas, queries, and migrations.
- Vitest and Playwright for automated testing.

## Local development

Install dependencies:

```shell
vp install
```

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
| `vp run test:unit` | Run unit tests in every workspace package that defines them |
| `vp run test:e2e` | Build the web Worker and run Chromium browser tests |
| `vp run cf-typegen` | Regenerate types for both Workers |

## Repository structure

```text
tv/
├── apps/
│   ├── web/          # Nuxt SSR Worker
│   └── api/          # Hono API Worker
└── packages/
    └── database/     # Shared Drizzle schema, migrations, and database access
```
