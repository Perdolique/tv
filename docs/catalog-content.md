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

## UUIDv7 rollout

The migration takes exclusive locks on the five related tables, changes IDs and dependent references in a single Drizzle transaction, validates foreign keys immediately, and restores their original non-deferrable definitions. Passwords, token hashes, timestamps, and row counts remain intact. A failed migration rolls back and prevents deployment through the existing workflow.

Verify the migrated catalog and an existing session in staging before merging. Reverting application code does not require reverting the migration: IDs remain UUID values, and the added metadata columns are nullable. Previously returned UUIDv4 catalog IDs are replaced; public title URLs are introduced only after this migration.
