# Catalog import previews

This internal service implements #63. It prepares one explicitly selected TMDB movie or series. It does not add HTTP routes or write catalog, release-calendar, subscription, or watched records. Application belongs to #64; the protected web flow belongs to #65.

## Service boundary

Call `createImportPreview(session, selection, { token: env.TMDB_READ_ACCESS_TOKEN, images: env.IMAGES })` with a server-resolved catalog session. The service checks the current `catalog.manage` grant. The selection must not contain an operator ID or card fields.

- A movie selection contains `type: 'movie'` and a positive integer `tmdbId`.
- A series selection contains `type: 'series'`, `tmdbId`, and `tvmaze: { status: 'selected', id }` or `tvmaze: { status: 'verified_absent', reason }`. An API failure is never evidence that a show is absent.
- `ready` and `blocked` results contain the saved preview. Only `ready` can be considered for application. Temporary source failures return `source_failure` with a safe issue and optional `retryAfterSeconds`; they do not create a preview.
- Permanent source errors and identity conflicts produce a saved `blocked` preview. Technical source causes go to private Worker logs, not preview messages. Full provider responses are not stored.

`openImportPreview(session, id)` checks the current grant, owner, expiry, and poster hash. It returns the saved data and bytes without contacting the providers. Missing, foreign, or expired previews return `null`. The future HTTP layer must use protected, uncached responses, including `Cache-Control: no-store` for poster bytes. Do not put preview data or images in a public cache.

## Source data

TMDB card requests include `translations` and `external_ids` through `append_to_response`. Original titles come from the original-title field. Localized names and descriptions come only from actual translation entries. Original-language, English, and Russian entries keep their full source locales, such as `en-US` and `en-GB`; the service does not silently pick a regional variant or relabel fallback text. Each value includes its source identity, field, and locale. Optional missing values stay `null` or absent from the translation list.

TVMaze requests use an explicitly selected show with embedded episodes. Shared IMDb and TheTVDB IDs must agree. If no shared ID is available, the preview warns that the explicit choice needs review. Only regular episodes with stable IDs and positive coordinates are accepted. Unknown names and air dates stay `null`; future episodes are kept. Show `48945` is restricted to season 1. Episode IDs and coordinates must be unique, and existing reviewed source mappings cannot be replaced.

Title and year are not merge keys. Proposed additions list the new card, episode source IDs, and missing source links. They do not propose overwriting existing editorial fields. Field ownership and the final update summary remain part of #64.

## Storage and application handoff

`catalog_import_previews` stores the operator, selection, versioned normalized data, identity evidence, issues, proposed additions, affected-catalog fingerprint, and optional WebP bytes. A preview expires exactly 24 hours after it is saved. Its data must not be refreshed in place.

The fingerprint covers selected title identities, matching catalog cards and localized fields, their episodes, and source links. It also detects a previously absent source link being added. It excludes follows, watched marks, and release-calendar records. Build it with `readCatalogState` and `inspectCatalogState` in a repeatable-read transaction, using the saved selection and episodes. #64 must recheck this fingerprint and current access before writing, reject blocked or expired previews, and implement atomic, idempotent application. A later ownership table must be included in that state check when #64 introduces it.

Posters are downloaded only from a validated path on `https://image.tmdb.org/t/p/original`, with redirects disabled and a 10 MiB input limit. Images prepares one WebP within 480 × 720, with no crop or enlargement. Output must be at most 1 MiB. The preview stores the source URL, source hash, output hash, dimensions, and exact output bytes. The database also enforces the output size limit. Permanent upload and applied-image delivery are not part of this task.

Provider HTTP requests allow at most three attempts, each with a 10-second deadline. JSON bodies are limited to 4 MiB for TMDB and 8 MiB for TVMaze. A retry waits for `Retry-After` when present. Delays above five seconds are returned to the caller instead of retrying early. 404, authorization failures, malformed data, and invalid artwork never become missing optional data.

## Environments and checks

Both Worker environments declare the `IMAGES` binding and require `TMDB_READ_ACCESS_TOKEN` as a secret. Keep local tokens in the ignored `apps/api/.env`; never add real values to the example file or repository. Automated tests override secrets with test values.

Production cleanup runs daily at 03:00 UTC; staging runs at 03:30 UTC. Each invocation deletes at most ten batches of 100 expired previews and closes its database connection. Expired previews cannot be opened even before cleanup removes them.

Focused unit tests cover normalization, source failures, fingerprints, and poster limits. Disposable PostgreSQL tests cover storage, identity conflicts, access, expiry, bounded cleanup, and catalog preservation. Worker tests cover real local Images transforms, saved-byte integrity, and the scheduled database job. Local Images tests do not prove remote account access; verify that separately before a staging smoke test.

References: [TMDB append-to-response](https://developer.themoviedb.org/docs/append-to-response), [TVMaze API](https://www.tvmaze.com/api), [Images binding](https://developers.cloudflare.com/images/optimization/binding/), and [Worker cron triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/).
