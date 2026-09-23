# Managed catalog import

Status: completed research for [issue 60](https://github.com/Perdolique/tv/issues/60), checked on 2026-09-22. Authenticated TMDB checks cover the approved 20 new cards and five existing titles; the episode comparison confirms the selected TVMaze structure. This document defines the agreed behavior, not an implemented importer. See the [sample evidence and verification limits](catalog-import-sample.md).

This research covers the sources, rules, preview contract, and approved first batch. Application changes, database migrations, cloud resource setup, imports, and general catalog editing belong to later tasks in [Epic 59](https://github.com/Perdolique/tv/issues/59).

## Source decision

Use TMDB for movie and series cards, TVMaze for regular episodes, and owned poster copies in the existing Cloudflare Images account. Deliver new posters through our Worker and the Images binding. The product is non-commercial for now. No new subscription is selected.

The following comparison describes documented capabilities. Live samples cover TMDB and TVMaze; alternatives were assessed through their official documentation. A missing authenticated comparison does not prove that another provider has worse data.

| Source | Movies, series, and languages | Artwork and episodes | Access and fit |
| --- | --- | --- | --- |
| TMDB | Movie and series details; original language and title; translation endpoints and language parameters for available translations | Poster paths and image metadata; series, seasons, and episodes | Developer access requires a key or read token. Selected for cards; checked coverage and missing-field cases are in the sample report |
| TVMaze | Series API; show language and names; documented episode endpoints have no language selector | Show images and regular/special episode lists | Public API without a key. Selected for episodes; keeps the existing source identities and reviewed exceptions |
| TheTVDB | Movies and series; translation endpoints; original/English/Russian sample coverage was not measured | Artwork and episode data with several possible season orders | Viable alternative. The published tier below $50,000 annual company revenue is free with attribution; this project's access has not been approved or tested |
| OMDb | Movie, series, and episode lookup; documented parameters have no metadata language selector | Separate high-resolution Poster API requires patron access | Free key has a 1,000-request daily limit. The documented interface does not establish the required original/English/Russian translation coverage |
| Wikidata | Structured items, language labels, and external IDs; original/English/Russian sample coverage was not measured | Linked media and episode relationships need their own interpretation | Public structured data can support matching. Its short identifying descriptions are not plot summaries, so it is not a direct replacement for the selected card source |

References: [TMDB FAQ](https://developer.themoviedb.org/docs/faq), [TMDB languages](https://developer.themoviedb.org/docs/languages), [TVMaze API](https://www.tvmaze.com/api), [TheTVDB access](https://thetvdb.com/api-information), [TheTVDB API](https://thetvdb.github.io/v4-api/), [OMDb parameters](https://www.omdbapi.com/), [OMDb keys](https://www.omdbapi.com/apikey.aspx), [Wikidata access](https://www.wikidata.org/wiki/Wikidata:Data_access), and [Wikidata descriptions](https://www.wikidata.org/wiki/Help:Description).

| Source | Storage, attribution, and cost | Request limits |
| --- | --- | --- |
| TMDB | Free developer use for non-commercial projects with required credit. API terms prohibit caching information for more than six months; owned copies do not remove that condition. Commercial use needs a separate agreement | Current guidance describes an approximate upper range of 40 requests/second, which can change; respect HTTP 429 |
| TVMaze | CC BY-SA data; retain linked attribution and ShareAlike for adapted episode data. Public API has no subscription requirement | At least 20 calls per 10 seconds per IP under normal conditions; back off on 429. Most output has a one-hour upstream cache |
| TheTVDB | Free attribution tier may fit this project. Official integration guidance supports a local copy or caching proxy. Access terms and image rights still apply | No numeric allowance was established from the reviewed access page and integration guide; confirm it before choosing this provider |
| OMDb | Site states CC BY-NC 4.0; retain attribution and observe non-commercial conditions. Free key and paid Poster API are separate. No TMDB-style cache deadline was found on the reviewed API/key pages | 1,000 requests/day for the free key; no throughput guarantee was verified |
| Wikidata | Structured data is CC0 and can be stored locally. Linked artwork has its own rights; CC0 does not cover every linked asset | Endpoint-specific limits apply. For Action API clients, follow serial-request, User-Agent, and maxlag guidance; no unlimited request allowance is assumed |

References: [TMDB API terms](https://www.themoviedb.org/api-terms-of-use?language=en-US), [TMDB rate limits](https://developer.themoviedb.org/docs/rate-limiting), [TVMaze licensing and limits](https://www.tvmaze.com/api#licensing), [TheTVDB integration guide](https://github.com/thetvdb/v4-api), [OMDb license notice](https://www.omdbapi.com/), [Wikidata licensing](https://www.wikidata.org/wiki/Wikidata:Licensing), and [MediaWiki API etiquette](https://www.mediawiki.org/wiki/API:Etiquette). These are source conditions, not a claim that the providers own all supplied artwork.

Using TMDB for all data would reduce the number of fetching adapters and offer language-aware season requests. It would also require matching 783 existing TVMaze episodes, resolving numbering differences, and preserving every internal UUID and watched mark. Using TMDB only for new episodes would retain two episode workflows. The selected combination avoids that migration and keeps one accepted episode source. This is a scope decision, not a claim that TVMaze always has more complete data. The [live comparison](catalog-import-sample.md#episode-comparison) found different regular/special classification for Attack on Titan and Black Mirror, plus split episodes in the US Office. Those differences support preserving one reviewed structure.

## Identity and matching

Internal title and episode UUIDs remain authoritative. Follows and watched marks keep those UUIDs. Store external links separately as `(provider, provider entity type, external ID) -> internal UUID`; the external tuple is unique. For example, TMDB movie and TV identifiers have different entity types. A manual catalog record may have no external link.

Move the required `tvmaze_episode_id` values into episode links without recreating the existing episodes. Preserve unique episode coordinates within each series. Both the browser importer and the existing episode snapshot workflow must use the same identity rules after that migration.

Select an exact TMDB result. Compare media type, original title, year, and available external IDs. Names and years help review; they are not merge keys. Keep both Office adaptations, both Thing movies, and standalone sequels separate.

For series, use available IMDb and TheTVDB identifiers to look up TVMaze candidates. When both IDs are present, conflicting matches block application. A failed lookup through one ID alone does not prove the series is absent: review remaining IDs and a specific search result. Keep an existing reviewed TVMaze mapping unless a separate correction is approved. Ambiguous matches require operator selection; an outage cannot be accepted as an absent series.

Each internal series has one accepted episode structure. Do not union providers' lists or match episodes only by season and number. For original Edgerunners, keep only season 1 of TVMaze show 48945; its separate sequel uses 88337. Existing identity or coordinate changes block application instead of moving watched marks.

## Normalized data and field ownership

| Data | Rule |
| --- | --- |
| Required card fields | Selected external identity, movie/series type, non-empty original title, and known original language |
| Year | Derive from the main movie release date or first series date; missing date means null year |
| Text | Read available original, English, and Russian names and descriptions independently; keep actual language tags and field source |
| Missing text | Keep it missing. Do not generate translations, descriptions, or fallback text for storage |
| Display fallback | Requested locale and its language fallbacks, then English, then original language; retain the empty description state |
| Poster | Optional when the source has none; failed download or invalid bytes are errors, not absence |
| Episodes | Regular episodes only, including known future ones; stable source identity, positive season/number, nullable name and air date |
| Episode list | A verified absent show or successful empty regular list allows a card with a warning; unknown, failed, or ambiguous results block it |
| Calendar | Episode air dates never create or update release-calendar entries |

Use translation records to check the language and presence of each field; a language parameter alone does not prove a returned fallback is in that language. Read the original title from `original_title` or `original_name` with `original_language`, even when the matching translation record has an empty name. Keep country/locale information when supplied. In the live sample, Dark and Bella Mia have an English description but no explicit English translated name; keep that description and use the original-language title through display fallback. Do not store a fallback as a new English translation.

Do not infer an episode name's language from the show's original language. TVMaze does not offer the selected multilingual episode path. Existing display behavior substitutes an episode-number label for missing or TBA names. TMDB can also return generated labels such as `Episode 1` or `Эпизод 1` while the corresponding translation record is empty; these are not evidence of translated episode titles.

Track origin and the last applied value or fingerprint separately for each title/description locale, year, poster, and imported episode field. A protected manual empty value is different from a field that has never had a value. Source identity alone does not transfer ownership of a field.

| Current state | Proposed action |
| --- | --- |
| Importer applied A; local value is A; source now supplies B | `update`: show A to B for review |
| Importer applied A; local value is manually changed to C | `keep_manual`: keep C and show the source difference |
| Field is empty and not manually protected | `add`: offer the available source value |
| Value and source are unchanged | `unchanged`: preserve the value and identity |
| Source no longer supplies a field | Keep the existing value; flag source maintenance when needed |
| Source title or episode disappears | Keep internal records and user relationships; resolve source material retention separately |

Treat existing editorial descriptions and posters as manual. Import ownership of existing episode fields can start from the reviewed committed snapshot only when it matches current values. Do not adopt an unverified live database value as the previous import baseline.

## Reviewed preview contract

One operation contains one movie, or one series and its regular episode set. The server stores the normalized data and proposed changes. The operator reviews that saved version in the existing web app and confirms its identity. Provider JSON is confined to fetching adapters.

| Part | Required contract |
| --- | --- |
| Version | Format version, immutable preview identity, and retrieval time for each source |
| Sources | Selected external tuples, source URLs, and per-field provenance |
| Card | Type, original title/language, independent localized names and descriptions, nullable year |
| Poster | Absent or prepared immutable resource, content fingerprint, source, and protected preview reference |
| Episodes | Validated list, source identities, names/dates, and any reviewed season restriction |
| Matching | New/existing target, relevant internal IDs, evidence for source matches, and conflicts |
| Changes | Proposed additions, updates, protected manual values, and unchanged data |
| Readiness | Explicit warnings and blocking errors; application is allowed only for a fully prepared preview |
| Baseline | Fingerprint or version of affected catalog fields, links, episode structure, and field ownership; user watched marks are excluded |

### Synthetic example

This example is invented contract data, not a provider response or checked title. IDs, resource references, hashes, and the single episode are illustrative. Field names show the required separation; routes, database layouts, preview lifetime, and concrete serialization belong to tasks 63-65. Production source adapters validate provider-specific IDs and URLs.

```json
{
  "formatVersion": 1,
  "previewId": "example-preview",
  "retrievedAt": "2026-09-22T20:00:00Z",
  "sources": [
    {
      "key": "card",
      "provider": "tmdb",
      "entityType": "tv",
      "externalId": "900000001",
      "url": "https://www.themoviedb.org/tv/900000001",
      "retrievedAt": "2026-09-22T20:00:00Z"
    },
    {
      "key": "episodes",
      "provider": "tvmaze",
      "entityType": "show",
      "externalId": "900000002",
      "url": "https://www.tvmaze.com/shows/900000002",
      "retrievedAt": "2026-09-22T20:00:00Z"
    }
  ],
  "card": {
    "type": "series",
    "source": "card",
    "originalTitle": "Example Series",
    "originalLanguage": "en",
    "releaseYear": null,
    "titles": [{ "locale": "en", "value": "Example Series", "source": "card" }],
    "descriptions": [{ "locale": "ru", "value": "Пример описания.", "source": "card" }]
  },
  "poster": {
    "state": "prepared",
    "resourceId": "example-image",
    "source": "card",
    "fingerprint": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "previewReference": "example-protected-image-reference"
  },
  "episodes": {
    "state": "available",
    "source": "episodes",
    "seasonRestriction": null,
    "items": [
      {
        "identity": { "provider": "tvmaze", "entityType": "episode", "externalId": "900000003" },
        "season": 1,
        "number": 1,
        "name": null,
        "airDate": null
      }
    ]
  },
  "matching": {
    "target": "new",
    "catalogItemId": null,
    "episodeMatch": "operator_reviewed",
    "conflicts": []
  },
  "changes": [
    { "target": "card", "action": "add" },
    { "target": "episode:900000003", "action": "add" }
  ],
  "readiness": {
    "canApply": true,
    "warnings": ["MISSING_YEAR", "MISSING_RUSSIAN_TITLE", "MISSING_EPISODE_NAME", "MISSING_AIR_DATE"],
    "errors": []
  },
  "baseline": {
    "catalogItemId": null,
    "catalogFingerprint": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "expectedUnlinkedSources": ["card", "episodes"]
  }
}
```

For movies, episodes are explicitly not applicable. A series with no TVMaze match needs a reviewed absence result rather than an empty list with an unknown cause. For updates, change entries include the current and proposed values and why a manual value is kept. The baseline includes the absence of links for new records so a concurrent import cannot create another copy.

Confirmation sends only the saved preview identity, for example `{"previewId":"example-preview"}`. The server loads its record and rechecks current authorization. If it already completed, return the saved result before rechecking the old preview baseline or readiness. Otherwise, check the captured version, readiness, image availability, and affected catalog state. Never trust client-supplied card values or silently fetch replacement provider data during confirmation.

If an unfinished preview's catalog baseline changed, require a new preview. A new watched mark alone does not invalidate it. Overlapping imports must share database identity constraints and transaction checks. Commit the title, episode set, field origins, image references, and successful operation result atomically. Record failed attempts without leaving a partial catalog write.

The image upload is prepared before the database transaction. A database rollback does not undo a cloud upload: keep the unreferenced resource available for safe retry or cleanup. Cleanup must check published references and environment ownership before deleting anything. Do not claim that a SQL transaction includes Cloudflare storage.

Every privileged request, including preview images, history, and repeat confirmations, rechecks the account's current management access from task 62. Initially only the owner has access. Grant/revoke uses the technical procedure; operators do not grant access through this interface. Keep raw technical causes in diagnostics without credentials, and show safe summaries in the UI.

## Provider failures and retry

| Result | Preview behavior | Retry behavior |
| --- | --- | --- |
| Successful empty search | Show no matches; no selected card exists | Operator changes the query |
| Successful series with no regular episodes | Ready with a warning if all other checks pass | A later manual refresh may find episodes |
| TVMaze lookup 404 | Review other identifiers/search; do not immediately infer absence | Retry only when matching evidence changes |
| Selected title 404 | Block; show missing source record | Review identity or source removal |
| HTTP 401/403 | Block with access/configuration error | Resolve access; do not retry indefinitely |
| HTTP 429 | Block or remain pending; never substitute an empty result | Respect Retry-After when supplied; otherwise use bounded backoff |
| Timeout, connection failure, HTTP 5xx | Recoverable failure; never mark incomplete data as ready | Bounded retry with backoff; preserve raw cause |
| Malformed data, duplicate identity/coordinates | Block with validation details | Retry only after source correction or a reviewed decision |
| Poster fetch, validation, or storage failure | Preview is not ready | Retry preparation; do not publish a different unreviewed image |

Exact timeouts, attempt counts, and preview expiry are implementation choices for task 63. The current episode generator's 30-second timeout and 600 ms spacing are useful repository evidence, not adopted browser-import defaults. Live 429, 5xx, and timeout behavior was not forced during research; task 63 must cover them with controlled responses and failure tests.

## Owned posters and cost

Fetch only the selected allowed source image, validate it, and save an immutable copy for review. Keep a source reference and fingerprint. A protected preview must show those saved bytes; confirmation must not download a different copy. Start with one WebP variant within 480 by 720 pixels, preserving composition without upscaling, and keep the current 2:3 display box and fallback. Source images need not have a 2:3 ratio; the checked Attack on Titan and Bella Mia posters do not.

A language-filtered image list can be empty even when details supply a valid poster from another language. Bella Mia returned a Czech poster with English and Russian details, while its `en,ru,null` poster list was empty. Review the original-language or unfiltered image metadata before declaring that no poster exists. The selected image's language comes from its metadata, not the requested details language.

New posters use our versioned media URLs; existing local `/posters/...webp` assets remain supported. Only images referenced by applied cards are public. Separate staging and production ownership, authorization, cache keys, and deletion boundaries. Cache public success responses only; protected previews and failures must not enter public caches. Use the [Images binding](https://developers.cloudflare.com/images/optimization/binding/) and deliberate response caching.

The owner confirmed Workers Paid and Images Paid at $5 each; current account usage was not verified. Hosted storage costs $5 per 100,000 images per month. Optimizing hosted bytes through the binding counts as transformations: 5,000 unique transformations/month are included, then $0.50 per 1,000. Standard hosted delivery URLs instead cost $1 per 100,000 deliveries. The selected public path uses the binding. See [Images pricing](https://developers.cloudflare.com/images/pricing/).

Twenty unchanged posters in one size suggest about 20 unique transformations in a month, not a traffic forecast. Other projects, environments, image versions, abandoned previews, and Worker usage also matter. Before resource setup, verify remaining storage and shared allowances. Do not promise zero additional cost or add a subscription based on the current research.

## Attribution and manual maintenance

Show the approved TMDB logo, less prominently than TV branding, in an About/Credits area with this required notice: “This product uses the TMDB API but is not endorsed or certified by TMDB.” Retain linked TVMaze episode credit and CC BY-SA conditions for adapted episode data. These sources do not share one license. See the [TMDB attribution requirements](https://developer.themoviedb.org/docs/faq) and [TVMaze license](https://www.tvmaze.com/api#licensing).

The owner is responsible for a manual review every five months after import or the last complete refresh. This leaves time before the six-month TMDB cache limit. Task 66 documents actual import dates, each material's last successful verification, next review date, operator, outcome, and outstanding removals. This is an operational procedure, not a scheduled synchronization job.

At review, fetch current metadata and artwork, compare changes using the same protected-field rules, and explicitly handle removed or unavailable material. A request for one endpoint does not renew all stored values or images. Manual edits do not automatically remove source origin or conditions. Replace or remove material that cannot be retained, including old poster versions and cached or preview copies, while preserving internal records and user relationships. If API use ends, follow the terms' content removal requirement. See the [TMDB API terms](https://www.themoviedb.org/api-terms-of-use?language=en-US).

Do not commit provider response dumps, plot descriptions, or downloaded TMDB artwork. Research stores findings and references. Clear temporary source content when its research purpose ends. Keep audit outcomes without retaining expired source text or image copies inside old previews or history.

## Implementation ownership and current constraints

| Task | Required work and affected surfaces |
| --- | --- |
| [61: identities](https://github.com/Perdolique/tv/issues/61) | Title/episode links and uniqueness; migrate current TVMaze IDs without changing UUIDs; adapt the snapshot generator's matching and preserve exceptions |
| [62: access](https://github.com/Perdolique/tv/issues/62) | Owner access, technical grant/revoke, and current authorization on every privileged request |
| [63: preview](https://github.com/Perdolique/tv/issues/63) | Fetching adapters, validation, language provenance, missing-data states, prepared image references, and captured preview data |
| [64: application](https://github.com/Perdolique/tv/issues/64) | Field ownership and independent localized descriptions, catalog baseline checks, atomic writes, retry safety, image references, and operation history |
| [65: web flow](https://github.com/Perdolique/tv/issues/65) | Protected search/select/review/confirm/history flow, private/public media delivery, attribution, and responsive accessible states |
| [66: first import](https://github.com/Perdolique/tv/issues/66) | Approved 20 cards in separate operations, staging then production checks, repeat imports, and dated maintenance procedure |

Current `packages/database/src/schema.ts` requires a title on each localized description row, so it cannot represent a description with no title in that locale. Tasks 63/64 must preserve independent fields instead of inventing a translation. `apps/api/src/catalog/search.ts` and `details.ts` own current locale fallbacks; persistence changes must keep their visible behavior.

`apps/web/app/utils/catalog-response.ts` currently accepts only local poster paths. Task 65 must deliberately support our media URLs across details, watchlists, and viewing history. Read `apps/web/DESIGN.md` before UI changes. Required states include loading, empty search, already imported, warnings, conflicts, pending, success, recoverable failure, and retry, with keyboard access and light/dark responsive layouts.

Task bodies have not been updated by this research. Carry these requirements into their execution plans, including episode links in 61, localized-description storage in 64, and Images preparation/delivery across 63-65. Task 64's existing reference to a batch outcome does not add multi-title operations: the agreed delivery handles one title at a time.

Required downstream checks cover first/repeat imports; source updates and protected manual values; missing fields; remakes and sequels; episode removals or renumbering; catalog/provider changes after review; duplicate confirmation; database/image failure and safe retry; source outage/429; revoked access; staging/production separation; maintenance; and an unchanged release calendar. The [research checklist](catalog-import-sample.md#completion-status) records completed evidence and the boundaries of this research.
