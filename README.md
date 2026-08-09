# TV

TV is a service for finding movies and series, following them, and seeing their upcoming releases.

## MVP

The planned MVP allows a user to:

- Create an account and sign in.
- Search the catalog.
- View movie and series details.
- Follow movies and series.
- View upcoming releases for followed titles.

## Technical direction

The service will maintain its own complete catalog, including movies, series, episodes, people, localized metadata, genres, releases, and derived data.

### Confirmed

- Cloudflare Workers is the primary compute platform.
- Neon PostgreSQL is the source of truth for the catalog and user data.
- Cloudflare Hyperdrive connects Workers to Neon.
- Drizzle ORM manages the relational schema, queries, and migrations.
- Cloudflare Queues distributes catalog import and enrichment work.
- Cloudflare Workflows coordinates durable, multi-step import runs.
- Cloudflare R2 stores raw source datasets and object media.
- Cloudflare Cache API caches public catalog responses.
- Cloudflare D1 is not used as the primary relational database.
- Hono implements the backend API and Worker handlers.
- Nuxt 4 with Vue 3 implements the web application and server-side rendering.
- The repository uses a minimal workspace-based monorepo.

### Repository structure

```text
tv/
├── apps/
│   ├── web/          # Nuxt web application
│   └── api/          # Hono API and Cloudflare Worker handlers
└── packages/
    └── database/     # Drizzle schema, migrations, and database client
```
