# TV

TV helps people discover movies and series, follow titles, and track upcoming releases.

For UI work, read the [design guide and reference images](apps/web/DESIGN.md).

## Local development

```shell
vp install
cp .env.example .env
cp apps/api/.env.example apps/api/.env
docker compose up -d database
vp run db:migrate
vp run dev
```

- Web: <http://127.0.0.1:3001>
- API health check: <http://127.0.0.1:8788/health>

The example API environment uses the public Turnstile test secret; the web development server uses the matching test site key. Set other local secrets in `apps/api/.env`.

## Checks

```shell
vp run test:unit
vp run test:integration
vp run test:e2e
```

Integration tests need local PostgreSQL 18 and a role allowed to create databases. The Docker setup provides both. Tests use a disposable database. Set `TEST_DATABASE_ADMIN_URL` if the admin connection differs from `postgresql://tv:tv@127.0.0.1:5433/postgres`; only loopback hosts are accepted.

See [package.json](package.json) for all commands, including migration generation, formatting, linting, and type checks.

## Deployment

GitHub Actions migrates and deploys staging for same-repository pull requests and production for pushes to `master`. Fork and Dependabot pull requests run checks only. Each environment uses its own Neon branch, Hyperdrive configuration, and `DATABASE_URL` secret.

For a manual deployment, authenticate Wrangler and load the owner connection string for the intended Neon branch:

```shell
printf 'Neon owner connection string: '
IFS= read -r -s DATABASE_URL
printf '\n'
export DATABASE_URL
```

Run one of these from the repository root, then clear `DATABASE_URL` with `unset DATABASE_URL`.

Staging:

```shell
vp run db:migrate
vp run deploy:staging
```

Production:

```shell
vp run db:migrate
vp run deploy:production
```
