# Issue 60: catalog sources and managed import plan

Status: agreed planning baseline, not completed research or an implemented importer.

Planning date: 2026-09-22. Task: [Choose catalog sources and import rules](https://github.com/Perdolique/tv/issues/60). Parent: [Managed catalog import](https://github.com/Perdolique/tv/issues/59).

Read [the handoff](60-catalog-import-handoff.md) with this plan. It records user decisions, evidence, alternatives, access limits, and the exact resume point. This document preserves the full agreed plan in English. Saving it does not complete issue 60 or authorize implementation of the whole parent Epic.

## 1. Outcome and boundaries

Issue 60 defines the data sources, import rules, reviewed preview contract, and first batch of 20 new titles. After it is complete, issues 61 and 63 can start without choosing providers or product rules again.

The planned final research outputs are:

- `docs/catalog-import.md`: decisions, comparison of alternatives, import rules, preview contract, poster handling, and data maintenance.
- `docs/catalog-import-sample.md`: checked examples, external IDs, language and artwork coverage, episode coverage, differences, and the agreed first batch.
- An update to `docs/catalog-content.md`: link the new rules and explain how the future managed import relates to the existing episode snapshots.

These final research outputs do not exist yet. The two files under `docs/plans/` are the saved planning record, not a substitute for API checks and their results.

Write documentation in simple English. Keep each Markdown paragraph and list item on one source line. Do not change the database schema, application, cloud resources, or production data while carrying out issue 60. Do not commit, push, or create a PR without a separate request.

Do not implement a command-only final import flow. The parent Epic requires import through the existing web application. The terminal may be used for research and the documented technical procedures that are explicitly allowed.

## 2. Selected sources and independent catalog

### Source decisions

| Area | Agreed decision |
| --- | --- |
| Movie and series cards | TMDB for names, original language, year, available descriptions, and poster information |
| Regular episodes | TVMaze |
| New poster storage | Our own copies in the existing Cloudflare Images account |
| Poster delivery | Our Worker through the Images binding, with optimization and caching |
| Commercial use | Non-commercial for now; review the source license before monetization |
| New subscriptions | None; use the user's existing Workers Paid and Images Paid subscriptions |
| Other data providers | Do not connect them in this delivery; keep external identities separate so they can be added later |
| Manual content | Support it in the data model and protect manual values; a manual editing interface is not part of this delivery |

Compare TMDB, TheTVDB, OMDb, and Wikidata using official documentation and terms. Cover movies and series, original/English/Russian data, artwork, access, storage conditions, attribution, request limits, and cost. Do not reject TheTVDB with the false claim that it always requires payment. Also compare the selected TMDB + TVMaze combination with using TMDB for everything, including the migration work for existing episodes.

The user selected the sources above. Do not repeat that choice without new evidence or a new user preference. Do not adjust research results to support a prior choice: if a source cannot meet the requirements, record the exact blocker and revisit the affected decision.

### Internal and external identities

- Our existing title and episode UUIDs remain the main identities. Follows and watched marks continue to refer to those UUIDs.
- Store external identities as separate links for catalog titles and episodes. Each link includes the provider, the provider's entity type, the external ID, and our record. The same external identity must not point to two internal records.
- A catalog record does not require an external identity. This allows future manual records without inventing a provider ID.
- Issue 61 must account for moving the current TVMaze episode IDs into independent source links. Do not recreate the existing 783 episode records or their user marks.
- Do not add a new provider-specific column for every future service. The general relation is `internal UUID <-> provider + provider entity type + external ID`.
- A link still belongs to a specific internal title or episode. Independence means no hard dependency on one provider, not a link with no catalog target.
- Names and years help an operator review a match. They are not automatic merge keys. Keep remakes, same-name adaptations, and standalone sequels separate.
- Use available IMDb or TheTVDB IDs to find a TMDB-to-TVMaze match. If there is no clear match, the operator selects a specific result. Conflicting external IDs block application.
- Preserve the reviewed separation of `Cyberpunk: Edgerunners` and `Cyberpunk: Edgerunners 2`, including the original show's season restriction. A new provider does not silently override these decisions.

Each series has one accepted episode structure in TV. A later provider can add information to matched episodes, but must not automatically replace that structure or combine two provider lists into one. Season and episode numbers alone do not prove that two records represent the same episode.

### Field ownership and manual changes

Record the origin of imported values and the value or fingerprint last applied by the importer. Track titles and descriptions separately for each language. Track year and poster separately from text.

| Current state | Repeat import behavior |
| --- | --- |
| An imported field is unchanged locally and the source supplies a new value | Show the proposed replacement in the preview |
| A field has a manual change | Keep the manual value and show the difference |
| A field is empty and is not protected as a manual value | Offer to fill it |
| A source stops supplying a field | Do not automatically erase the existing value; apply the source retention rules |
| A source record disappears | Do not delete our title, episodes, follows, or watched marks |
| An existing episode changes identity or coordinates | Block the conflict; do not move watched marks by guesswork |

Treat current editorial descriptions and posters as manual content. Adding a TMDB identity to an existing title does not make those values owned by TMDB. For episode fields, the reviewed committed snapshot may provide an initial comparison baseline only when it matches the current values.

Example: the importer previously applied value A. The provider now returns B. If the catalog still contains A, propose B. If an editor changed it to C, keep C and show the difference. Source identity and field ownership are separate facts.

Use ordinary, explicit catalog fields. Do not build a generic arbitrary-field database, a plugin platform, or automatic rules for deciding which of many providers is right. A future second metadata provider can first offer missing data for explicit review.

## 3. Import contract

### Required and optional data

A new title requires a selected external identity, a movie or series type, a non-empty original title, and a known original language. Year, translations, descriptions, and poster may be absent. Do not generate missing translations, descriptions, or dates.

- Read available original, English, and Russian metadata.
- Store the real language of each value. Do not label an English fallback returned by a provider as Russian.
- Keep names and descriptions independent in the preview contract. A missing translated name must not force the loss of an available description in that language.
- Preserve current display fallbacks: the requested locale and its language fallback, then English, then the original language. Keep the existing empty state when no description exists.
- Derive year from the provider's main movie date or first series date. No date means no year.
- For episodes, preserve external identity, season, number, available name, and air date. Unknown names and dates remain missing.
- Include known regular episodes, including future ones. Exclude specials. Do not turn episode air dates into release-calendar records.

Allow a series card with a clear warning when the series is genuinely absent from TVMaze or a successful response contains no regular episodes. A timeout, provider error, or ambiguous identity is not proof that episodes do not exist. Such a preview is not ready to apply.

### One title per operation

The first browser flow is:

1. Search TMDB.
2. Select the exact movie or series.
3. Fetch the card and available regular episodes.
4. Review data, source matches, poster, and proposed changes.
5. Explicitly confirm.
6. Show the result and operation history.

The first batch of 20 titles is imported as separate operations. Do not add multi-title selection, a batch queue, or batch retry UI in this version.

### Reviewed preview

The documented preview contract must include:

| Part | Required information |
| --- | --- |
| Version | Format version, preview identity, and data retrieval time |
| Sources | Selected external IDs, links, and metadata origin |
| Card | Original and translated names and descriptions, type, and year |
| Poster | The prepared image resource and a content fingerprint |
| Episodes | The validated regular episode structure and reviewed exceptions |
| Matching | New or existing internal record and identity conflicts |
| Changes | Add, update, keep manual, or leave unchanged |
| Readiness | Warnings, blocking errors, and whether application is allowed |
| Comparison baseline | The affected catalog state at review time |

Store the reviewed preview on the server. The client confirms its identity rather than sending arbitrary values to write.

- Apply the captured version. Do not silently fetch changed provider data during confirmation.
- If affected catalog data changed after review, require a new preview. A new watched mark alone does not invalidate the catalog preview.
- A repeated confirmation of a completed operation returns that result rather than creating duplicate work.
- Apply a title and its episode set atomically. A failed import must not leave half a series in the catalog.
- Run issue 62's server-side access checks on every privileged request, including requests from an existing session after access is revoked.
- Record the initiating account, target, time, and outcome. Keep useful raw technical causes in diagnostics without credentials. Give the interface safe error summaries.
- Distinguish loading, empty results, existing imports, conflicts, pending work, success, recoverable failure, and retry. UI visibility is not an access check.

The provider adapter produces TV's normalized data instead of exposing provider JSON throughout the application. The exact downstream route names and database storage layout are implementation details for the relevant Tasks, not implemented interfaces in issue 60.

### Owned posters

Use the existing Images account and Worker. Do not add R2 or use standard Images delivery URLs as the selected public delivery path.

- Fetch a selected poster only from the allowed source, validate it, and save an immutable copy linked to the preview.
- Show that saved copy to the operator. Confirmation must not replace it with a freshly downloaded image.
- Start with one web variant: WebP within 480 by 720 pixels, without upscaling or changing the source composition. Keep the existing 2:3 display box and fallback.
- Return our media URL for new posters. Existing local `/posters/...webp` assets continue to work.
- Preview images are available only to authorized operators. Images referenced by applied catalog cards can be public. Keep staging and production resources distinct, including deletion boundaries.
- Cache only public delivery. A changed image gets a new versioned URL. Do not put failures or protected preview responses into the public cache.
- A failed image download or validation is not the same as a source with no poster. Track unused copies after cancellation or failure for safe cleanup. Never delete a published resource as failed-operation cleanup.

Hosted images optimized through the Images binding use the transformation billing model rather than standard Images delivery billing. The pinned Worker types contain hosted-image upload, read, and delete APIs, and the pinned Wrangler schema supports Images bindings and Workers Cache. See the [Images binding documentation](https://developers.cloudflare.com/images/optimization/binding/) and [Images pricing](https://developers.cloudflare.com/images/pricing/).

The user confirmed existing Workers Paid and Images Paid subscriptions. No new fixed subscription is planned. Check the account's remaining storage and shared usage allowances before connecting resources; do not promise zero incremental charges without that check.

### Source terms and maintenance

Use TMDB for the agreed non-commercial phase with the required attribution. Preserve TVMaze attribution and CC BY-SA conditions. Do not present the sources as having the same license. See [TMDB's FAQ](https://developer.themoviedb.org/docs/faq) and [TVMaze's API terms](https://www.tvmaze.com/api#licensing).

Schedule a manual operational review every five months, leaving time before TMDB's six-month cache limit. This is a documented owner procedure, not an automatic synchronization job. See [TMDB's API terms](https://www.themoviedb.org/api-terms-of-use?language=en-US).

Document the owner, check dates, re-fetching of metadata and images, handling of removed source material, and removal of old copies. A repeat request does not automatically renew every old value. A manual edit does not remove a value's source origin or source conditions.

If material cannot be refreshed or kept under the source terms, the operator must replace or remove that material separately while preserving internal records and user relationships. Do not put permanent TMDB response dumps, descriptions, or images into Git. Research reports should record findings and references, not become an indefinite copy of provider content.

## 4. First batch and comparison sample

The user approved 20 new cards, not a new target size for the whole catalog.

| Movies | Series |
| --- | --- |
| The Matrix (1999) | Breaking Bad (2008) |
| Inception (2010) | Better Call Saul (2015) |
| Interstellar (2014) | Severance (2022) |
| Arrival (2016) | Dark (2017) |
| Parasite (2019) | The Office, UK (2001) |
| Spirited Away (2001) | The Office, US (2005) |
| The Thing (1982) | Black Mirror (2011) |
| The Thing (2011) | Attack on Titan (2013) |
| Brother / Брат (1997) | Пищеблок (2021) |
| Solaris / Солярис (1972) | Мастер и Маргарита (2005) |

Record exact external IDs, original language, English and Russian coverage, poster availability, and each series' reviewed TVMaze link and regular episodes. Do not silently replace an unavailable selection with another title.

Also check existing Dune (2021), Kingdom (2019), Bella Mia (2013), Cyberpunk: Edgerunners (2022), and Cyberpunk: Edgerunners 2 (2026). These are repeat-import, editorial-content, and identity-exception cases, not additional new cards.

Separate three kinds of claims in the research report:

- Results actually checked through a live API.
- Capabilities and conditions read in official documentation.
- Assumptions that have not yet been checked.

All ten selected series were found through live TVMaze requests during planning. The TMDB API sample has not been run. The user does not yet have a token and is willing to obtain developer access. Keep the token outside Git and research output.

## 5. Execution and acceptance for issue 60

1. Before editing, fetch the remote and check the branch against the fresh default branch. Preserve user changes; do not merge or rebase without authorization.
2. Obtain TMDB access and run limited research on the agreed sample without writing to the catalog.
3. Compare TMDB and TVMaze episode data for a small group of series: availability, numbering, translations, and specials. Record actual differences.
4. Check selected-provider requests, response shapes, missing data, request limits, HTTP 429 responses, timeouts, and retry conditions. Do not claim that untested providers passed live checks.
5. Write the final decision documents and contract examples. Record which later Task owns each implementation responsibility.
6. Run the applicable Markdown lint check and inspect the diff. Do not run full application suites for documentation-only work.

### Ownership of later work

| Task | Responsibility to carry forward |
| --- | --- |
| [61](https://github.com/Perdolique/tv/issues/61) | External title and episode links, preservation of internal identities, and the existing episode workflow |
| [62](https://github.com/Perdolique/tv/issues/62) | Account-based server-side management access, technical grant/revoke procedure, and revocation checks |
| [63](https://github.com/Perdolique/tv/issues/63) | Source fetching, normalization, validation, and preview preparation |
| [64](https://github.com/Perdolique/tv/issues/64) | Safe application, field origin, reviewed image references, operation history, and retry safety |
| [65](https://github.com/Perdolique/tv/issues/65) | Protected browser flow, media delivery, attribution, and supported accessible responsive states |
| [66](https://github.com/Perdolique/tv/issues/66) | Real first batch in staging and production, repeat-import checks, and maintenance documentation |

Record these responsibilities in the research output. This planning archive does not itself update child issue bodies or implement these changes. In particular, the selected episode-link migration and Images path need to be reflected when those Tasks are prepared for execution.

### Required scenarios for downstream implementation

- First import and repeat import with no changes.
- Provider updates while manual values stay protected.
- Missing translation, description, year, poster, episode name, air date, or episode list.
- Same-name movies, both Office versions, standalone sequels, and conflicting external IDs.
- New, missing, or renumbered source episodes without loss of existing UUIDs and watched marks.
- Provider or catalog changes between preview and confirmation.
- Duplicate submission, database failure, image failure, and safe retry.
- Provider outage, rate limiting, denied access, and access revoked during a signed-in session.
- Separate staging and production behavior, source-retention maintenance, and no release-calendar changes.

Issue 60 is complete only when the final documents contain checked sample evidence, the exact agreed batch, and the rules and contract without unresolved product choices. Missing API access or a newly found incompatibility remains an explicit blocker to completing the research; saving this plan is not evidence that those checks passed.

Actual imports, cloud resource changes, database migrations, a manual editor, additional providers, automatic refresh, bulk crawling, specials, release-calendar changes, ratings, recommendations, and user-request moderation remain outside issue 60.
