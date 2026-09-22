# Issue 60: planning handoff

Saved from the planning discussion on 2026-09-22. Read the [full agreed plan](60-catalog-import-plan.md) before continuing.

Remote summary: [agreed planning baseline on issue 60](https://github.com/Perdolique/tv/issues/60#issuecomment-5782290324).

## Start here

The user selected [issue 60](https://github.com/Perdolique/tv/issues/60), discussed the source and architecture choices, and then had to leave. The archive request covered saving this context and adding a planning comment to the existing issue. The user then separately requested a pull request, authorizing the commit and push needed to publish these two documents. Neither request authorizes implementing the importer, changing production, or creating cloud resources.

The first action in a later session is to read both planning files, inspect changes since the baseline below, and continue the remaining research for issue 60 when the user asks. Do not repeat settled preference questions. Revisit a decision only if new evidence contradicts it or the user changes the requirement.

Suggested resume request:

> Continue issue 60. Read docs/plans/60-catalog-import-handoff.md and docs/plans/60-catalog-import-plan.md first. Keep the agreed decisions and continue the remaining source and sample checks. Do not implement the whole import Epic.

These files were first saved as local working-tree additions. The follow-up publication uses branch `docs/60-catalog-import-plan` and a draft pull request. Until it is merged, another checkout must use that branch to read the documents. The GitHub planning comment records the earlier local-only state and remains a separate remote summary.

## Scope and baseline

| Item | Recorded state |
| --- | --- |
| Repository | `Perdolique/tv` at `/home/perd/src/tv` |
| Branch | `master` |
| Baseline commit | `881b8f730b8c2e76fd751c4df3920a55acb1d9ed` |
| Remote check | `git fetch origin` completed before the archive edits; HEAD and `origin/master` matched, with ahead/behind counts of 0/0 |
| Initial working tree | Clean; no user changes or existing staging to preserve |
| Latest merged work | PR 58: personal viewing history; earlier PR 57: current-series episode data |
| Current task | Issue 60, source selection and import rules |
| Parent Epic | Issue 59, selected catalog import through the existing web app |
| Issue 60 before the archive | Open, with its original scope and no comments |

The baseline is a fact about the checked revision, not a promise about a future checkout or live database. No application code, schema, cloud resources, or catalog records were changed during planning. No application test suite, source import, or cloud image upload was run. Live provider research consisted of read-only documentation and TVMaze requests.

The archive task adds the two planning documents and a comment on issue 60. It does not close the issue, change its acceptance criteria, modify child issues, or change Project status.

## Settled user decisions

| Topic | User decision | Consequence |
| --- | --- | --- |
| Business model | Non-commercial for now | Use suitable non-commercial access; revisit source terms before monetization |
| Budget | No new payments for source services or a new subscription | Reuse existing services and check included account allowances; do not promise zero overage |
| TMDB account | No token yet; willing to obtain access | Real TMDB API checks still need an owner-provided developer token |
| Batch size | 20 new titles: 10 movies and 10 series | Not a target size for the whole catalog |
| Batch selection | Assistant proposes; user approved the exact list | Do not silently swap titles |
| Card source | TMDB | Original, English, and Russian metadata plus artwork information |
| Episode source | TVMaze for both existing and new series | Do not migrate episode data to TMDB in this delivery |
| Provider independence | Separate external links and internal identities | Keep UUIDs stable and avoid a separate hard-coded ID column per future provider |
| Manual values | Protect manual changes; update untouched imported fields | Remember value origin and the last applied value or fingerprint |
| Manual editing scope | Data-model foundation only | No manual creation/editing screen in the first delivery |
| Missing TVMaze episodes | Allow a card with a warning | A real absence differs from an outage or unresolved identity |
| Source data maintenance | Manual refresh rather than an automatic job | The final plan sets a five-month review interval before TMDB's six-month limit |
| Image ownership | Store our own copies | Direct browser hotlinks to TMDB were not selected |
| Existing Cloudflare plans | Workers Paid for $5 and Images Paid for $5, confirmed by the user | These are user-confirmed subscriptions, not API-verified account state |
| Existing R2 use | None, according to the user | R2 was considered but not selected |
| Final image choice | Images storage plus Worker delivery through Images binding and cache | Do not fall back to the earlier R2 proposal or standard Images delivery URLs without a new reason |
| Operation size | One title per operation | Its regular episodes belong to the same reviewed operation; no multi-title batch UI |

The original conversation and plans were in Russian. These documents preserve their technical content in English under the repository's writing rules. The full plan includes technical defaults proposed during planning, such as five-month maintenance and one 480 by 720 WebP variant. Those should not be confused with separate live checks or an implemented feature.

## Why these choices were made

### One source now versus multiple sources later

The user asked whether starting with one source would make it hard to add a second, third, or later manual content. The agreed answer was to keep our own catalog independent without building a general provider platform in advance.

Internal title and episode UUIDs already exist. User data refers to these IDs, which is the useful foundation. The current mandatory `tvmaze_episode_id` column is the actual provider-specific coupling. Separate identity links remove that coupling while keeping a link to the correct internal record.

Adding another source later still needs fetching code, matching rules, tests, attribution, and conflict handling. The goal is to avoid rebuilding follows, watched marks, and the catalog itself. It is not to make arbitrary providers work by configuration alone.

Independent links, field origin, protected manual values, and a normalized preview format are needed now. A plugin registry, arbitrary-field storage, provider priority editor, automatic merging of many sources, and a manual catalog editor are not needed now.

For example, an internal episode may later have both a TVMaze identity and a TMDB identity while retaining its UUID and watched marks. That does not mean a matching season/episode number is enough to create the link. Different services can group, split, and number content differently.

### Why retain TVMaze episodes

The user requested a detailed comparison before choosing. TVMaze is focused on series and episodes, has a public API without an API key, and can return a show's episode list in one request. Its episode endpoints do not provide a language selector. TMDB covers movies and series and supports language parameters for season data, but translated content is available only when contributors have supplied it.

The existing 783 regular episodes already have TVMaze identities and reviewed exceptions. Keeping this source avoids an immediate source-to-source episode migration. This is a scope and migration argument, not proof that TVMaze's data is always more complete or accurate.

The alternatives were all-TMDB with a full migration, or TMDB for new series while keeping legacy TVMaze series. The latter would avoid immediate legacy matching but would retain two episode import paths. The user finally chose TMDB cards plus TVMaze episodes with independent links.

Future episode enrichment must respect one accepted structure per internal series. Do not union provider lists or move watched marks based only on episode coordinates.

### Why manual-value protection

The user chose updating untouched imported fields over either filling only empty fields or importing only new cards. The other options are simpler but fail to carry useful source corrections into existing imported content.

Linking a manually prepared card to TMDB must not transfer ownership of its current descriptions or poster to that source. Source identity is not field ownership. A later manual editor must be able to preserve even a deliberate manual empty value.

### How the image decision changed

The first recommendation was direct source CDN delivery because it needs no new storage. The user explicitly chose owned copies.

R2 was then considered under the no-new-payments constraint. After the user confirmed both Workers Paid and Images Paid, the final recommendation changed to using the existing Images storage and optimizing its bytes through the Worker binding, with cached public responses. The user selected this option.

Do not mistake the paid Images storage increment for unlimited image delivery. Standard hosted delivery URLs count as Images Delivered. The official pricing documentation says optimization of a hosted image through the binding counts as Images Transformed instead. The included transformation allowance is shared with other account work. Worker requests and CPU also use the existing account allowance.

A planning estimate was about 20 unique transformations for 20 unchanged posters in one size in a month. It is not an account-wide forecast and excludes later image versions, other sizes, other projects, and additional staging work. Remaining usage was not observable through the available Cloudflare connection.

### Why manual maintenance

TMDB's current terms page was fetched directly during planning and included a six-month cache restriction. An indefinite one-time snapshot was therefore rejected. The user chose a manual refresh process rather than automatic synchronization or searching for a different long-term-storage source.

The final plan leaves a five-month maintenance interval as operational margin. It does not claim that any provider request renews all stored values, that manual edits remove source conditions, or that keeping our own image copy removes the source's retention requirements.

## Repository evidence already inspected

| Location | Relevant observation at the baseline |
| --- | --- |
| `packages/database/src/schema.ts` | Titles and episodes have internal UUIDs; episode source identity is currently a required unique TVMaze integer; watched marks reference internal episode UUIDs |
| `apps/api/src/catalog/search.ts` | Locale fallbacks include requested locale variants and English; original title is the final title fallback |
| `apps/api/src/catalog/details.ts` | Description selection follows locale fallbacks and original language; poster path is returned as `posterUrl` |
| `apps/web/app/utils/catalog-response.ts` | Poster validation currently accepts only local `/posters/[a-z0-9-]+.webp` paths; hosted media will need a deliberate contract update |
| `apps/web/app/components/catalog/CatalogPoster.vue` | Stable 2:3 box with loading and missing/failed-image fallback |
| `apps/web/app/components/catalog/CatalogEpisodeList.vue` | Episode credit currently names TVMaze directly; future credit must follow actual source data |
| `apps/api/scripts/catalog-episode-sources.ts` | Reviewed mappings for 15 series; fixed TVMaze show IDs, source names, premiere dates, languages, and season restrictions |
| `apps/api/scripts/catalog-episode-snapshot.ts` | Existing normalization and migration generation reject duplicate source IDs and episode coordinates; source identity changes require review |
| `apps/api/scripts/generate-catalog-episodes.ts` | Existing generator uses sequential TVMaze requests with 600 ms spacing and a 30-second request timeout; these are current script facts, not newly chosen web-import defaults |
| `packages/database/data/catalog-episodes.json` | Reviewed snapshot with 783 regular episodes across 15 series |
| `docs/catalog-content.md` | Current editorial data, artwork origins, TVMaze attribution, refresh process, and separation of episode air dates from calendar releases |
| `apps/web/DESIGN.md` | Design source of truth; preserve semantic tokens, responsive light/dark support, keyboard use, and stable image boxes |
| API and web Wrangler configuration | Existing Worker deployment and database bindings; no catalog Images or R2 binding was configured |
| Installed Worker types | `ImagesBinding.hosted` supports upload and image handles with byte access, metadata, and deletion |
| Installed Wrangler schema | Supports `images` and `cache`; Images bindings must also be declared in named environments |

Pinned versions checked: Wrangler `4.130.0` and `@cloudflare/workers-types` `5.20260908.1`. No dependency upgrade was proposed.

The existing episode snapshot includes the Korean Kingdom (2019), The Forsytes (2025), A Different World (2026), and Pride and Prejudice (2026). The original Edgerunners maps to TVMaze show 48945 with season 1 only; its standalone sequel maps to 88337. Preserve these reviewed choices until a separately justified correction is agreed.

The approved 20-title batch was not found in the committed catalog seed migrations inspected at the baseline. This was not a query of the live staging or production database. Recheck actual identities before applying any import.

## Live TVMaze sample from planning

Checked on 2026-09-22 using public read-only requests to `/search/shows?q=...` followed by `/shows/{id}?embed=episodes`. Counts below include only records with `type == regular`. They describe the source snapshot at that time, not a permanent claim that a series is complete.

| Selected series | TVMaze show | Premiere | Source language | Regular episodes | Seasons | IMDb ID | TheTVDB ID |
| --- | --- | --- | --- | ---: | --- | --- | --- |
| Breaking Bad (2008) | [169](https://www.tvmaze.com/shows/169) | 2008-01-20 | English | 62 | 1-5 | tt0903747 | 81189 |
| Better Call Saul (2015) | [618](https://www.tvmaze.com/shows/618) | 2015-02-08 | English | 63 | 1-6 | tt3032476 | 273181 |
| Severance (2022) | [44933](https://www.tvmaze.com/shows/44933) | 2022-02-18 | English | 19 | 1-2 | tt11280740 | 371980 |
| Dark (2017) | [17861](https://www.tvmaze.com/shows/17861) | 2017-12-01 | German | 26 | 1-3 | tt5753856 | 334824 |
| The Office, UK (2001) | [1292](https://www.tvmaze.com/shows/1292) | 2001-07-09 | English | 12 | 1-2 | tt0290978 | 78107 |
| The Office, US (2005) | [526](https://www.tvmaze.com/shows/526) | 2005-03-24 | English | 202 | 1-9 | tt0386676 | 73244 |
| Black Mirror (2011) | [305](https://www.tvmaze.com/shows/305) | 2011-12-04 | English | 32 | 1-7 | tt2085059 | 253463 |
| Attack on Titan (2013) | [919](https://www.tvmaze.com/shows/919) | 2013-04-07 | Japanese | 89 | 1-4 | tt2560140 | 267440 |
| Пищеблок (2021) | [50809](https://www.tvmaze.com/shows/50809) | 2021-05-19 | Russian | 16 | 1-2 | tt13266012 | 394412 |
| Мастер и Маргарита (2005) | [4184](https://www.tvmaze.com/shows/4184) | 2005-12-19 | Russian | 10 | 1 | tt0403783 | 85691 |

The observed total was 531 regular episodes. The check found no empty or `TBA` names and no empty air dates among those returned regular episodes. Each selected show had a non-null image property in the search result. This was not an image download or quality check.

The responses also contained these legacy TVRage IDs where present: Breaking Bad 18164, Better Call Saul 37780, The Office UK 6060, The Office US 6061, Black Mirror 30348, Attack on Titan 35298, and Мастер и Маргарита 15442. Severance, Dark, and Пищеблок returned null. These are recorded response facts, not a decision to support TVRage as a provider.

Search returned distinct Office entries for the UK, US, Australian, and Indian versions. It also returned separate companion or spin-off entries for Breaking Bad, Better Call Saul, and Пищеблок. This supports explicit selection rather than accepting the first fuzzy search result as identity.

No TMDB ID has been validated for any of these titles in this session. Do not infer a TMDB ID from a TVMaze ID, TheTVDB ID, IMDb ID, or a remembered value.

## Official sources consulted

The observations below were read during planning on 2026-09-22. Recheck conditions that affect access, cost, or publication when those actions are performed. There is no need to repeat general source discovery without a new reason.

### TMDB references

- [FAQ](https://developer.themoviedb.org/docs/faq): developer access, non-commercial use, commercial licensing, approved logo and attribution requirements. The required credit belongs in an About or Credits area; metadata and images are not automatically public-domain material.
- [API terms](https://www.themoviedb.org/api-terms-of-use?language=en-US): storage and use restrictions, including the six-month cache limit and removal duties when access ends. Direct retrieval returned HTTP 200 during planning; the page stated that its agreement was last updated on 2023-10-20.
- [Search and details](https://developer.themoviedb.org/docs/search-and-query-for-details): explicit source selection followed by a details request.
- [Languages](https://developer.themoviedb.org/docs/languages), [movie translations](https://developer.themoviedb.org/reference/movie-translations), and [series translations](https://developer.themoviedb.org/reference/tv-series-translations): language capabilities, not evidence that every selected title has every translation.
- [Series external IDs](https://developer.themoviedb.org/reference/tv-series-external-ids): available external identifiers for cross-provider matching.
- [Season details](https://developer.themoviedb.org/reference/tv-season-details) and [season translations](https://developer.themoviedb.org/reference/tv-season-translations): the alternative TMDB episode path supports language requests.
- [Image basics](https://developer.themoviedb.org/docs/image-basics) and [image languages](https://developer.themoviedb.org/docs/image-languages): source image paths, sizes, and language handling.
- [Rate limiting](https://developer.themoviedb.org/docs/rate-limiting): respect 429 responses; the documented approximate upper rate is not a guaranteed entitlement.

### TVMaze and other candidates

- [TVMaze API](https://www.tvmaze.com/api): public search, lookup by IMDb/TheTVDB identity, embedded episodes, regular/special handling, images, caching, and rate limits. Its documented minimum is 20 requests per 10 seconds per IP; back off on 429.
- [TVMaze licensing](https://www.tvmaze.com/api#licensing): CC BY-SA and linked source credit.
- [TheTVDB API information](https://thetvdb.com/api-information): an attribution-based free tier was listed for company revenue below $50,000 per year. This is not evidence that this project's account has been approved for access.
- [TheTVDB official API repository](https://github.com/thetvdb/v4-api) and [README](https://raw.githubusercontent.com/thetvdb/v4-api/main/README.md): local copies/caching, translation and artwork integration context, and different episode orders. [TheTVDB terms](https://thetvdb.com/tos) distinguish API access from rights to images.
- [OMDb API](https://www.omdbapi.com/) and [key access](https://www.omdbapi.com/apikey.aspx): documented free daily request limit and a separate patron poster API. No live OMDb sample was run.
- [Wikidata licensing](https://www.wikidata.org/wiki/Wikidata:Licensing): structured data is CC0; this does not establish that every linked image or external description has that license.

TheTVDB, OMDb, and Wikidata were investigated through documentation and selected public information, not a full authenticated comparison sample. Their coverage must not be described as measured or inferior without the relevant evidence.

### Cloudflare references

- [Images pricing](https://developers.cloudflare.com/images/pricing/): storage, delivery, and transformations are separate billing dimensions. The published included transformation allowance was 5,000 unique transformations per month; hosted storage and standard delivery use different units.
- [Images binding](https://developers.cloudflare.com/images/optimization/binding/): works with image bytes, including hosted images; supports optimization through a Worker. Responses need deliberate caching.
- [Binding billing change](https://developers.cloudflare.com/changelog/post/2026-07-01-binding-unique-transformations/): repeat source/parameter combinations in the same calendar month no longer count as separate unique transformations; image information calls are not billed as transformations.
- [Workers Cache](https://developers.cloudflare.com/workers/cache/): selected caching capability; do not enable public caching for authenticated management responses.
- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/): existing Worker usage remains part of the shared account allowance.
- [R2 pricing](https://developers.cloudflare.com/r2/pricing/): evaluated as an alternative, not selected. Standard storage has a free allowance; it is not an unlimited unmetered store.

## Access limits and unfinished verification

### TMDB

Only environment variable names were checked, not secret values. No matching TMDB, TVDB, OMDb, or TVMaze credential names were found in the process environment or the inspected root/API environment files. The user confirmed that no TMDB token exists yet and is willing to obtain one.

Do not ask for a token in chat. Arrange local secret configuration outside Git when continuing the live checks. Do not write tokens into command output, URLs in reports, or the research documents.

### Cloudflare

The repository account ID matched the configured Cloudflare connector account. Read-only inspection of subscriptions, Images statistics, and R2 buckets was attempted. The connector returned:

```text
Cloudflare API error: 10000: Authentication error
```

No successful account usage result was available. This was a connector authentication failure, not an automatic approval rejection. The $5 Workers Paid and $5 Images Paid subscriptions and unused R2 state came from the user's answers. Do not present them as verified via the API, or claim that the shared free allowance is unused.

The installed types and configuration schema establish local API availability, not deployed access or a successful staging image test. No resource was created to test it.

### Work still required to finish issue 60

1. Obtain usable TMDB developer access and run the agreed live sample.
2. Verify TMDB title identities, original/English/Russian fields, image information, external IDs, and actual missing-field behavior.
3. Compare episode structures from TMDB and TVMaze on a small useful subset; record differences rather than assuming that both number episodes alike.
4. Complete the evidence-based provider comparison, attribution requirements, and maintenance procedure in the planned final research outputs.
5. Confirm relevant Cloudflare account access and remaining allowances before resource setup is proposed or performed. Do not delay independent source research because this connector is unavailable.
6. Review the preview contract against current schema constraints, especially independent translated descriptions and external episode links. Record required downstream changes without implementing them inside issue 60.
7. Run documentation checks and assess all issue 60 acceptance criteria. Keep the issue open if required sample evidence is missing.

Detailed route naming, table layouts, preview lifetime, image cleanup mechanics, and exact retry timing belong to the downstream implementation plans. They were not silently selected during this discussion. The accepted behavior, safety requirements, source choices, and non-goals are already fixed in the saved plan.

## Working rules for continuation

Follow the repository's current `AGENTS.md` and the implementation workflow. Before repository edits, fetch and compare with the fresh default branch. Do not merge/rebase automatically. Preserve unrelated changes and existing staging.

Use `vp` for package-manager commands and `vpx` for direct package CLIs. Keep documentation in English and do not hard-wrap Markdown paragraphs or list items. For documentation-only work, the focused check is `vp run lint:markdown`. When committing, let the repository hooks run the mandatory checks without running that suite manually first. A later implementation must use the checks required by its changed files and flows.

The parent Epic permits only explicitly authorized operator accounts to manage imports, initially the owner. Existing sessions must lose privileged access when it is revoked. Operators must not grant privileges to themselves or others. There is no user/role management screen in scope.

Do not change the accepted product boundary: no scheduled imports, bulk crawling, release-calendar updates, general catalog editing, request moderation, ratings, recommendations, or automatic episode identity corrections. The owner can later add context or change decisions explicitly.

Use the saved plan as the working baseline. The next useful work is the missing source/sample verification, not a new round of general planning or a rewrite of the existing application.
