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

Create the API environment file, then set `TURNSTILE_SECRET` to the secret for the configured Turnstile widget. Authentication intentionally remains unavailable when this secret is missing.

```shell
cp apps/api/.env.example apps/api/.env
```

Run both applications:

```shell
vp run dev
```

- Web: <http://127.0.0.1:3001>
- API health check: <http://127.0.0.1:8788/health>

### Local database

Start PostgreSQL 18 and create the local environment file:

```shell
docker compose up -d database
cp .env.example .env
vp run db:migrate
```

Wrangler maps the API's `DATABASE` Hyperdrive binding to the local development database. Integration tests create, migrate, and remove a separate `tv_test_<uuid>` database on the same PostgreSQL server, so they never truncate development data or connect to Neon.

Generate a migration after changing the Drizzle schema:

```shell
vp run db:generate
```

Run the PostgreSQL and Worker integration suites:

```shell
vp run test:integration
```

The test runner requires PostgreSQL 18 and a local role allowed to create databases. The Docker role has this permission by default. Set `TEST_DATABASE_ADMIN_URL` only when the PostgreSQL admin connection differs from `postgresql://tv:tv@127.0.0.1:5433/postgres`. The test runner rejects non-loopback database hosts.

### Cloud environments

Production and staging use separate Neon branches and cache-disabled Hyperdrive configurations. Automated tests remain local; staging is for deployed smoke tests and release verification, not for CI data.

GitHub Actions reads the owner connection string from a `DATABASE_URL` secret defined separately in the `staging` and `production` environments. A same-repository pull request migrates and deploys staging; a push to `master` migrates and deploys production. Fork and Dependabot pull requests still run checks, but skip migration and deployment.

The deployment job starts only after its migration job succeeds, then deploys the API Worker followed by the web Worker. The owner connection string is available only to the migration job. The Worker connects at runtime with the restricted `tv_app` role stored in the corresponding Hyperdrive configuration.

For a manual deployment, authenticate Wrangler and load the owner connection string for the intended Neon branch through a hidden prompt:

```shell
printf 'Neon owner connection string: '
IFS= read -r -s DATABASE_URL
printf '\n'
export DATABASE_URL
```

Run exactly one intended environment from the repository root, then remove the owner connection string from the environment.

#### Staging

```shell
vp run db:migrate
vp run deploy:staging
unset DATABASE_URL
```

#### Production

```shell
vp run db:migrate
vp run deploy:production
unset DATABASE_URL
```

## Commands

| Command | Purpose |
| --- | --- |
| `vp run build` | Build and validate both Cloudflare Workers with Wrangler dry runs |
| `vp run db:generate` | Generate a Drizzle migration from schema changes |
| `vp run db:migrate` | Apply pending migrations using `DATABASE_URL` |
| `vp run deploy:production` | Deploy both production Workers |
| `vp run deploy:staging` | Deploy both staging Workers |
| `vp run format` | Format TypeScript files |
| `vp run format:check` | Check TypeScript formatting |
| `vp run lint:markdown` | Lint Markdown files |
| `vp run lint:oxlint` | Lint source and configuration files |
| `vp run test:integration` | Run PostgreSQL and Worker tests in a disposable PostgreSQL 18 database |
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
