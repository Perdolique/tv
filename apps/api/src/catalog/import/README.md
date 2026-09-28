# Catalog import previews and application

This service implements #63, #64, and #65. It previews and applies one explicitly selected TMDB movie or series with regular TVMaze episodes. Operators use the protected web flow at `/manage/imports`.

## Service boundary

Call `createImportPreview(session, selection, { token: env.TMDB_READ_ACCESS_TOKEN, images: env.IMAGES })` with a server-resolved catalog session. The service checks the current `catalog.manage` grant. The selection must not contain an operator ID or card fields.

- A movie selection contains `type: 'movie'` and a positive integer `tmdbId`.
- A series selection contains `type: 'series'`, `tmdbId`, and `tvmaze: { status: 'selected', id }` or `tvmaze: { status: 'verified_absent', reason }`. An API failure is never evidence that a show is absent.
- `ready` and `blocked` results contain the saved preview. Only `ready` can be considered for application. Temporary source failures return `source_failure` with a safe issue and optional `retryAfterSeconds`; they do not create a preview.
- Permanent source errors and identity conflicts produce a saved `blocked` preview. Technical source causes go to private Worker logs, not preview messages. Full provider responses are not stored.

`openImportPreview(session, id)` checks the current grant, owner, expiry, and poster hash. It returns the saved data and bytes without contacting the providers. Missing, foreign, or expired previews return `null`. The HTTP layer returns JSON without poster bytes and serves saved poster bytes through a separate protected URL with `Cache-Control: no-store`. Preview data and images never enter a public cache.

Call `applyImportPreview(session, previewId, { hosted: env.IMAGES.hosted, namespace })` to apply a ready version 3 preview. The HTTP layer derives a stable namespace from `WEB_ORIGIN`. The service checks access again, applies the saved card and episodes, and returns a result with the catalog item ID and change counts. It does not contact TMDB or TVMaze again. A repeated call returns the successful operation, even after preview cleanup. A failed operation stays in history; pass `retry: true` to start a new attempt while its preview is still valid. Applying again or reading history marks pending attempts that have passed their five-minute lease as interrupted; a new attempt then needs an explicit retry. The HTTP history uses a cursor and shows the operator's current email, source selection, safe outcome, and an author-only retry flag.

## HTTP routes

All `/api/catalog/imports/*` routes resolve the current session and `catalog.manage` grant on every request. They return private uncached responses. Access is not added to `/api/auth/session`.

- `GET /api/catalog/imports/access` checks the grant.
- `GET /api/catalog/imports/navigation` returns a boolean hint for the account link. It checks the same current grant and returns `false` when access is missing or the session has expired, so ordinary account pages do not emit an access error in the console. Every import action still uses the protected access boundary.
- `GET /api/catalog/imports/search?type=movie|series&query=...&page=...` searches TMDB by exact type and returns source IDs, names, years, and a next page.
- `GET /api/catalog/imports/shows?query=...` returns TVMaze show candidates with their IDs and external IDs.
- `POST /api/catalog/imports/previews` accepts only the explicit selection. `GET /api/catalog/imports/previews/:id` reads its saved review data. `GET /api/catalog/imports/previews/:id/poster` streams its saved WebP privately.
- `POST /api/catalog/imports/previews/:id/apply` accepts `{ "retry": true|false }` and returns the existing operation on a repeated normal request.
- `GET /api/catalog/imports/operations?cursor=...` lists shared history. `GET /api/catalog/imports/operations/:id` refreshes one operation.

Temporary provider failures return a safe issue with status 503 and `Retry-After` when known. `GET /api/posters/:id.webp` is public, accepts only an ID in the current environment namespace, and serves uploaded WebP bytes with an immutable cache header.

## Source data

TMDB card requests include `translations` and `external_ids` through `append_to_response`. Original titles come from the original-title field. Localized names and descriptions come only from actual translation entries. Original-language, English, and Russian entries keep their full source locales, such as `en-US` and `en-GB`; the service does not silently pick a regional variant or relabel fallback text. Each value includes its source identity, field, and locale. Optional missing values stay `null` or absent from the translation list.

TVMaze requests use an explicitly selected show with embedded episodes. Shared IMDb and TheTVDB IDs must agree. If no shared ID is available, the preview warns that the explicit choice needs review. Only regular episodes with stable IDs and positive coordinates are accepted. Unknown names and air dates stay `null`; future episodes are kept. Show `48945` is restricted to season 1. Episode IDs and coordinates must be unique, and existing reviewed source mappings cannot be replaced.

Title and year are not merge keys. A version 3 preview includes changes per field and episode: add, update, unchanged, preserve an editorial value, or retain a value missing from the source. Existing fields without import provenance are editorial. Imported fields update only while their current value still equals the last applied value, including `null`. Source values and the last applied values are tracked separately; poster provenance keeps the checked TMDB path and image hash as well as the hash of the last applied image. A linked episode with changed coordinates blocks the preview for review.

## Storage and atomic application

`catalog_import_previews` stores the operator, selection, versioned normalized data, identity evidence, issues, proposed additions, affected-catalog fingerprint, and optional WebP bytes. A fresh source preview expires 24 hours after it is saved. Choosing a target creates a new preview with the same source data, poster bytes, candidates, and expiry. Its data must not be refreshed in place.

The fingerprint covers selected title identities, matching catalog cards, titles, descriptions, imported-field provenance, episodes, and source links. It also detects a previously absent source link being added. It excludes follows, watched marks, and release-calendar records. Build it with `readCatalogState` and `inspectCatalogState` in a repeatable-read transaction, using the saved selection, target, candidates, and episodes. Application rechecks the saved plan, current grant, expiry, and fingerprint inside the transaction. Catalog writes and the successful operation result commit together. A failure rolls back catalog changes, records a safe reason in operation history, and sends technical details to private Worker logs. Database uniqueness constraints settle races between different previews for the same source or episode.

Posters are downloaded only from a validated path on `https://image.tmdb.org/t/p/original`, with redirects disabled and a 10 MiB input limit. Images prepares one WebP within 480 × 720, with no crop or enlargement. Output must be at most 1 MiB. The preview stores the source URL, source hash, output hash, dimensions, and exact output bytes. The database also enforces the output size limit. Application uploads those exact bytes through the hosted Images binding before the catalog transaction. The ID includes environment, type, TMDB ID, and output hash; an existing ID is reused only when its bytes match. The operation records this ID even if the later database write fails, so an unreferenced upload can be inspected and reused. Catalog rows use `/api/posters/<id>.webp`, served by the Worker. Existing `/posters/*.webp` paths remain valid.

Provider HTTP requests allow at most three attempts, each with a 10-second deadline. JSON bodies are limited to 4 MiB for TMDB and 8 MiB for TVMaze. A retry waits for `Retry-After` when present. Delays above five seconds are returned to the caller instead of retrying early. 404, authorization failures, malformed data, and invalid artwork never become missing optional data.

## Environments and checks

Both Worker environments declare the `IMAGES` binding and require `TMDB_READ_ACCESS_TOKEN` as a secret. Keep local tokens in the ignored `apps/api/.env`; never add real values to the example file or repository. Automated tests override secrets with test values.

Production cleanup runs daily at 03:00 UTC; staging runs at 03:30 UTC. Each invocation deletes at most ten batches of 100 expired previews and closes its database connection. Expired previews cannot be opened even before cleanup removes them.

Focused unit tests cover normalization, source failures, fingerprints, and poster limits. Disposable PostgreSQL tests cover previews, application, idempotency, explicit retry, concurrent source conflicts, access, expiry, migration backfill, mid-write rollback, and preservation of UUIDs and user activity. Worker tests cover real local Images transforms, hosted upload of saved bytes, reuse, failure, and the scheduled database job. Local Images tests do not prove remote account access or remaining paid quota; verify those before the #66 staging smoke test.

References: [TMDB append-to-response](https://developer.themoviedb.org/docs/append-to-response), [TVMaze API](https://www.tvmaze.com/api), [Images binding](https://developers.cloudflare.com/images/optimization/binding/), and [Worker cron triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/).

## Choosing a catalog card

`POST /api/catalog/imports/previews/:id/target` accepts `{ "kind": "existing", "catalogItemId": "<uuid>" }` or `{ "kind": "new" }`. The operator must own the unexpired preview and still have `catalog.manage`. An existing target must belong to its saved candidates. Exact source-ID matches lock the target. Name-only matches start unresolved and cannot be applied until the operator chooses a card or confirms a separate work.

The new preview rechecks catalog fields, episodes, provenance, source ownership, and candidate state inside a repeatable-read transaction. It never reloads TMDB, TVMaze, or the poster. Source errors stay separate from catalog decisions and remain blocking after a target change. The response shows saved matches, not a new search on every read. Application checks the selected target without substituting another card.

## Deploying preview v3

Run the migrations before deploying this version. The reset removes saved v2 previews, including poster bytes, and marks their pending operations as non-retryable `preview_unavailable` failures. The follow-up migration removes any v2 previews saved after the reset and makes the database reject further v2 preview writes. An old Worker request during the migration-to-deploy window can fail; retry it after the new Worker is deployed. The migrations do not convert v2 data. Completed history, results, catalog data, user activity, and published posters remain unchanged. Old preview URLs use the normal unavailable-preview screen.
