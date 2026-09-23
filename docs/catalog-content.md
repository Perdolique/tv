# Initial catalog content

The twelve catalog entries receive manually prepared English and Russian synopses and local promotional artwork. This is a one-time editorial snapshot, not a runtime import or synchronization feature. Sources were checked on 2026-09-08.

Synopses are original short summaries of the linked title information. Poster and cover artwork belongs to its original rights holders; the links below record where each source image was obtained. Artwork is not extracted from the generated design references.

WebP files retain the source composition, are at most 480 × 720 pixels without upscaling, and have embedded metadata removed. The page reserves a 2:3 box and uses a neutral fallback if an asset is missing. Source files smaller than this limit retain their original resolution.

| Asset | Title information | Artwork source |
| --- | --- | --- |
| `kin-dza-dza-1986.webp` | [Title information](https://en.wikipedia.org/wiki/Kin-dza-dza%21) | [Source image](https://upload.wikimedia.org/wikipedia/en/0/00/Kin-dza-dza-VHS.jpg) |
| `dead-man-1995.webp` | [Title information](https://en.wikipedia.org/wiki/Dead_Man) | [Source image](https://upload.wikimedia.org/wikipedia/en/8/89/DeadManPoster.jpg) |
| `dune-2021.webp` | [Title information](https://en.wikipedia.org/wiki/Dune_%282021_film%29) | [Source image](https://upload.wikimedia.org/wikipedia/en/8/8e/Dune_%282021_film%29.jpg) |
| `the-equalizer-2014.webp` | [Title information](https://en.wikipedia.org/wiki/The_Equalizer_%28film%29) | [Source image](https://upload.wikimedia.org/wikipedia/en/8/81/The_Equalizer_poster.jpg) |
| `wedding-trough-1974.webp` | [Title information](https://en.wikipedia.org/wiki/Vase_de_Noces) | [Source image](https://upload.wikimedia.org/wikipedia/en/b/b6/Vase_de_Noces.jpg) |
| `bella-mia-2013.webp` | [Title information](https://www.cinemart.cz/filmy/bella-mia/) | [Source image](https://www.cinemart.cz/wp-content/uploads/2013/08/Bella-Mia_poster_mail.jpg) |
| `spartacus-2010.webp` | [Title information](https://www.tvmaze.com/shows/716/spartacus) | [Source image](https://static.tvmaze.com/uploads/images/original_untouched/354/886339.jpg) |
| `1923-2022.webp` | [Title information](https://www.tvmaze.com/shows/60550/1923) | [Source image](https://static.tvmaze.com/uploads/images/original_untouched/557/1392576.jpg) |
| `the-wire-2002.webp` | [Title information](https://www.tvmaze.com/shows/179/the-wire) | [Source image](https://static.tvmaze.com/uploads/images/original_untouched/504/1260189.jpg) |
| `chernobyl-2019.webp` | [Title information](https://www.tvmaze.com/shows/30770/chernobyl) | [Source image](https://static.tvmaze.com/uploads/images/original_untouched/193/482599.jpg) |
| `stargate-atlantis-2004.webp` | [Title information](https://www.tvmaze.com/shows/206/stargate-atlantis) | [Source image](https://static.tvmaze.com/uploads/images/original_untouched/498/1245482.jpg) |
| `kingdom-2019.webp` | [Title information](https://www.tvmaze.com/shows/26153/kingdom) | [Source image](https://static.tvmaze.com/uploads/images/original_untouched/498/1245252.jpg) |

The migration fills metadata using the historical seed IDs before converting persisted UUIDv4 identifiers. Asset filenames do not contain database IDs, so the same paths work in local, staging, and production environments.

## Managed import research

[Managed catalog import](catalog-import.md) records the selected sources, identity and manual-value rules, reviewed preview contract, owned-poster path, and maintenance procedure for issue 60. The [sample report](catalog-import-sample.md) contains the checked TMDB and TVMaze examples, language and poster coverage, and episode-structure differences. The completed research defines the later implementation; it does not add a working importer or change catalog data.

The planned browser flow keeps TVMaze for regular episodes and introduces TMDB for cards. It must preserve the existing title and episode UUIDs, user relationships, editorial descriptions and posters, and reviewed exceptions below. The source-link migration keeps the manual snapshot procedure available while the managed importer is built. Episode air dates remain separate from release-calendar data.

## UUIDv7 rollout

The migration takes exclusive locks on the five related tables, changes IDs and dependent references in a single Drizzle transaction, validates foreign keys immediately, and restores their original non-deferrable definitions. Passwords, token hashes, timestamps, and row counts remain intact. A failed migration rolls back and prevents deployment through the existing workflow.

Verify the migrated catalog and an existing session in staging before merging. Reverting application code does not require reverting the migration: IDs remain UUID values, and the added metadata columns are nullable. Previously returned UUIDv4 catalog IDs are replaced; public title URLs are introduced only after this migration.

## Catalog episode snapshot

The current snapshot was checked on **2026-09-22**. It contains **783 regular episodes across all 15 current catalog series**. The reviewed mapping is in `apps/api/scripts/catalog-episode-sources.ts`; the normalized data is in `packages/database/data/catalog-episodes.json`. The mapping uses fixed TVMaze show IDs; English titles and years remain review context, not database match keys. The generator checks the source name, premiere date and language to catch a changed or incorrect show identity. It never selects shows through title search.

| Catalog series | TVMaze show | Regular episodes | Seasons in this snapshot |
| --- | --- | ---: | --- |
| Spartacus (2010) | [716](https://www.tvmaze.com/shows/716) | 33 | 1, 2, 3 |
| 1923 (2022) | [60550](https://www.tvmaze.com/shows/60550) | 15 | 1, 2 |
| The Wire (2002) | [179](https://www.tvmaze.com/shows/179) | 60 | 1, 2, 3, 4, 5 |
| Chernobyl (2019) | [30770](https://www.tvmaze.com/shows/30770) | 5 | 1 |
| Stargate Atlantis (2004) | [206](https://www.tvmaze.com/shows/206) | 100 | 1, 2, 3, 4, 5 |
| Kingdom (2019) | [26153](https://www.tvmaze.com/shows/26153) | 12 | 1, 2 |
| American Horror Story (2011) | [30](https://www.tvmaze.com/shows/30) | 145 | 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13 |
| Percy Jackson and the Olympians (2023) | [48108](https://www.tvmaze.com/shows/48108) | 24 | 1, 2, 3 |
| The Forsytes (2025) | [83209](https://www.tvmaze.com/shows/83209) | 6 | 1 |
| South Park (1997) | [112](https://www.tvmaze.com/shows/112) | 335 | 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 25, 26, 27, 28, 29 |
| A Different World (2026) | [91916](https://www.tvmaze.com/shows/91916) | 10 | 1 |
| Cyberpunk: Edgerunners (2022) | [48945](https://www.tvmaze.com/shows/48945) | 10 | 1 |
| Cyberpunk: Edgerunners 2 (2026) | [88337](https://www.tvmaze.com/shows/88337) | 10 | 1 |
| Pride and Prejudice (2026) | [84008](https://www.tvmaze.com/shows/84008) | 6 | 1 |
| The Gold (2023) | [57137](https://www.tvmaze.com/shows/57137) | 12 | 1, 2 |

The mapping selects the Korean 2019 *Kingdom*, the 2025 *The Forsytes*, and the 2026 versions of *A Different World* and *Pride and Prejudice*. Original *Cyberpunk: Edgerunners* uses only season 1 of show 48945. Its standalone sequel uses show 88337. The extra season listed under the original source is excluded. Specials are excluded for every show, including the South Park specials that TVMaze lists outside its regular episodes.

Episode lists are a snapshot of what the source knows, not a claim that a series is complete. They may include future episodes, missing air dates and names such as TBA. The interface shows season and episode numbers and uses `Episode N` for a missing or TBA name. It does not show a completion percentage. Source air dates do not replace the separately curated `catalog_releases` calendar data.

### Source and license

Data comes from [TVMaze](https://www.tvmaze.com/) through its [show API with embedded episodes](https://www.tvmaze.com/api#embedding). Each source show is linked in the coverage table. The application shows linked TVMaze credit next to episode lists.

TVMaze provides API data under [CC BY-SA](https://www.tvmaze.com/api#licensing). Attribution and ShareAlike apply to the episode data and its adapted snapshots. Retain the TVMaze credit, source links and these terms when distributing a snapshot. Our changes select regular episodes, restrict the original Edgerunners to season 1, keep only the fields used by TV, sort by season and episode, and convert empty air dates to null. We do not import descriptions or artwork.

The five Chernobyl episodes were first added on 2026-09-21. Their TVMaze IDs and all existing episode source IDs now live in `catalog_external_links`, while the internal episode UUIDs stay unchanged. Later snapshots match the source links and update metadata without replacing those UUIDs. No episode or watched mark is deleted when it is absent from a later snapshot. A source ID that changes series or episode coordinates, or a different source ID at an existing coordinate, stops the migration for manual review.

### Manual refresh

1. Review `apps/api/scripts/catalog-episode-sources.ts` against each linked show, including same-name adaptations, premiere dates, languages and the Edgerunners `seasonRestriction`. A null restriction includes all seasons; a number includes only that season. Update this mapping only after reviewing any source identity change.
2. From the repository root, run `vp run catalog:episodes:generate /tmp/tv-episodes-YYYY-MM-DD` with a new absolute output directory. The generator creates this directory before contacting TVMaze, so an existing or unavailable path fails without network requests. This is the only step that contacts TVMaze. The generator validates each response, excludes specials and rejects duplicate coordinates or source IDs. HTTP, validation or write failures stop generation and report the original cause. The new directory remains for inspection and may contain incomplete files; do not use this output for a migration. Discard the failed output and retry with a new directory after resolving the cause.
3. Review the generated `snapshot.json` against `packages/database/data/catalog-episodes.json`. Check every series, episode counts, changed names and air dates, new episodes, and removed or renumbered source entries. Do not automatically delete absent entries or move existing watched marks. A changed identity needs a separate reviewed correction.
4. Run `vp run db:generate --custom --name=refresh_catalog_episodes` to create a new migration directory. Replace its `migration.sql` with `/tmp/tv-episodes-YYYY-MM-DD/migration.sql` from the episode generator. Copy `/tmp/tv-episodes-YYYY-MM-DD/snapshot.json` to `packages/database/data/catalog-episodes.json`. Do not overwrite an applied migration. The SQL resolves each catalog series by its reviewed TVMaze show link and each existing episode by its TVMaze episode link; missing or conflicting links stop the migration for review.
5. Update this snapshot date and coverage table. Update the snapshot unit and database tests with the reviewed expected counts and source identities. Run the focused snapshot unit tests, episode database and Worker tests, and the affected episode browser tests. Check that existing UUIDs and marks survive and that the calendar stays unchanged.
6. Commit the reviewed JSON, new migration, mapping changes and documentation together. Use the normal staging migration and smoke-check process before production.

Deployment and page loads use only the committed SQL and database rows. They never call TVMaze. There is no automatic refresh job.
