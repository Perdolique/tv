# Catalog import research sample

Status: completed research for [issue 60](https://github.com/Perdolique/tv/issues/60), checked on 2026-09-22. Live TMDB and TVMaze checks support the selected sources, approved batch, and import rules. This report is not a production import or an implementation test. Rules and the preview example are in [Managed catalog import](catalog-import.md).

## Evidence and method

No live catalog database was queried or changed during this research.

The TVMaze sample started at 2026-09-22 20:16 UTC. Requests used HTTPS, an identifying User-Agent, a 30-second client timeout, and at least 650 ms between the main probe's requests. The main probe made 24 explicit GET requests, excluding redirect follow-ups: 13 show/episode requests, four episode requests including specials, four identifier lookups, and three missing-result probes. A separate request inspected a lookup redirect without following it. These are research settings, not browser-import defaults.

Successful lookups in the main probe followed redirects. Count only episodes with `type == regular`, then apply the existing original-Edgerunners season restriction. Check missing/TBA names, missing air dates, positive integer coordinates, duplicate IDs, and duplicate coordinates within each accepted series. Read response data temporarily and retain counts, IDs, and findings; do not commit full responses or artwork.

The owner then configured a local TMDB read token. Authenticated search and card checks completed at 20:29-20:31 UTC; poster decoding and the main episode comparison completed at 20:32-20:33 UTC, with focused follow-up checks afterward. Search movies and TV separately, review exact candidates, then request details for those IDs. The 25 search calls inspected the first result page; this was explicit candidate review, not an exhaustive search crawl. The 58 card requests covered `en-US`, `ru-RU`, and other original languages, with appended translations, external IDs, and image metadata. Requests used a bearer header, an identifying User-Agent, 650 ms spacing within each probe, and a 30-second timeout. Tokens were not included in report URLs or output.

| Evidence type | What this report establishes |
| --- | --- |
| Live TVMaze API | Returned identities, show languages, counts, optional-field observations, specials, lookup matches, and HTTP response shapes |
| Live TMDB API | Exact card IDs, original/English/Russian field availability, poster metadata and decoded bytes, external-ID agreement, episode differences, and selected error/empty responses |
| Official documentation | Source capabilities, access, terms, attribution, request guidance, and Cloudflare pricing in the companion document |
| Repository inspection | Current schema constraints, locale fallback behavior, poster validation, episode mappings, and existing snapshot |
| Outside these live checks | Actual database matches and repeat application, current Cloudflare account allowances, deployed image handling, and controlled timeout/429/5xx tests |

Dates and counts describe returned source data at check time, not a claim that a series is complete or that future dates are final.

## Approved first batch

The approved batch is 20 new cards: ten movies and ten series. It is not the target size of the whole catalog. The selection exercises English and non-English originals, same-name films, both Office adaptations, animation, and Russian titles. Preserve the exact selection; an unavailable match needs a decision, not a silent replacement.

| Movie | Series |
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

All 20 exact TMDB identities were checked. Each card has a non-empty original title, known original language, main date, original-language description, English description, Russian name and description, and a downloadable poster. A separate translated name may be absent even when the description exists. In the table, `original` means the core original title already supplies that language; `translated` means an explicit translation is present; `fallback` means no explicit name exists in that language. It must not be stored as a translated name.

| Selected card | TMDB identity | Original title | Language | Main date | English name | Russian name | Checked poster pixels |
| --- | --- | --- | --- | --- | --- | --- | --- |
| The Matrix (1999) | [movie:603](https://www.themoviedb.org/movie/603) | The Matrix | en | 1999-03-31 | original | translated | [1500 × 2250](https://image.tmdb.org/t/p/original/dXNAPwY7VrqMAo51EKhhCJfaGb5.jpg) |
| Inception (2010) | [movie:27205](https://www.themoviedb.org/movie/27205) | Inception | en | 2010-07-15 | original | translated | [2000 × 3000](https://image.tmdb.org/t/p/original/xlaY2zyzMfkhk0HSC5VUwzoZPU1.jpg) |
| Interstellar (2014) | [movie:157336](https://www.themoviedb.org/movie/157336) | Interstellar | en | 2014-11-05 | original | translated | [2000 × 3000](https://image.tmdb.org/t/p/original/yQvGrMoipbRoddT0ZR8tPoR7NfX.jpg) |
| Arrival (2016) | [movie:329865](https://www.themoviedb.org/movie/329865) | Arrival | en | 2016-11-10 | original | translated | [2000 × 3000](https://image.tmdb.org/t/p/original/pEzNVQfdzYDzVK0XqxERIw2x2se.jpg) |
| Parasite (2019) | [movie:496243](https://www.themoviedb.org/movie/496243) | 기생충 | ko | 2019-05-30 | translated | translated | [2000 × 3000](https://image.tmdb.org/t/p/original/7IiTTgloJzvGI1TAYymCfbfl3vT.jpg) |
| Spirited Away (2001) | [movie:129](https://www.themoviedb.org/movie/129) | 千と千尋の神隠し | ja | 2001-07-20 | translated | translated | [2000 × 3000](https://image.tmdb.org/t/p/original/39wmItIWsg5sZMyRUHLkWBcuVCM.jpg) |
| The Thing (1982) | [movie:1091](https://www.themoviedb.org/movie/1091) | The Thing | en | 1982-06-25 | original | translated | [1000 × 1500](https://image.tmdb.org/t/p/original/tzGY49kseSE9QAKk47uuDGwnSCu.jpg) |
| The Thing (2011) | [movie:60935](https://www.themoviedb.org/movie/60935) | The Thing | en | 2011-10-12 | original | translated | [1400 × 2100](https://image.tmdb.org/t/p/original/dmn2nVo8h7LMnk694JxCRIwK06p.jpg) |
| Brother / Брат (1997) | [movie:20992](https://www.themoviedb.org/movie/20992) | Брат | ru | 1997-12-12 | translated | original | [833 × 1250](https://image.tmdb.org/t/p/original/dxeVQdd227B367xQxvabkYTfz0b.jpg) |
| Solaris / Солярис (1972) | [movie:593](https://www.themoviedb.org/movie/593) | Солярис | ru | 1972-03-20 | translated | original | [2000 × 3000](https://image.tmdb.org/t/p/original/pgqj7QoBPWFLLKtLEpPmFYFRMgB.jpg) |
| Breaking Bad (2008) | [tv:1396](https://www.themoviedb.org/tv/1396) | Breaking Bad | en | 2008-01-20 | original | translated | [2000 × 3000](https://image.tmdb.org/t/p/original/anFx9aTOOYqgS3v7x3R84Kz67ly.jpg) |
| Better Call Saul (2015) | [tv:60059](https://www.themoviedb.org/tv/60059) | Better Call Saul | en | 2015-02-08 | original | translated | [2000 × 3000](https://image.tmdb.org/t/p/original/fC2HDm5t0kHl7mTm7jxMR31b7by.jpg) |
| Severance (2022) | [tv:95396](https://www.themoviedb.org/tv/95396) | Severance | en | 2022-02-17 | original | translated | [2000 × 3000](https://image.tmdb.org/t/p/original/pPHpeI2X1qEd1CS1SeyrdhZ4qnT.jpg) |
| Dark (2017) | [tv:70523](https://www.themoviedb.org/tv/70523) | Dark | de | 2017-12-01 | fallback | translated | [2000 × 3000](https://image.tmdb.org/t/p/original/apbrbWs8M9lyOpJYU5WXrpFbk1Z.jpg) |
| The Office, UK (2001) | [tv:2996](https://www.themoviedb.org/tv/2996) | The Office | en | 2001-07-09 | original | translated | [2000 × 3000](https://image.tmdb.org/t/p/original/oX2JKE1RzAONMbYlujHx0hRAJo1.jpg) |
| The Office, US (2005) | [tv:2316](https://www.themoviedb.org/tv/2316) | The Office | en | 2005-03-24 | original | translated | [2000 × 3000](https://image.tmdb.org/t/p/original/7DJKHzAi83BmQrWLrYYOqcoKfhR.jpg) |
| Black Mirror (2011) | [tv:42009](https://www.themoviedb.org/tv/42009) | Black Mirror | en | 2011-12-04 | original | translated | [2000 × 3000](https://image.tmdb.org/t/p/original/seN6rRfN0I6n8iDXjlSMk1QjNcq.jpg) |
| Attack on Titan (2013) | [tv:1429](https://www.themoviedb.org/tv/1429) | 進撃の巨人 | ja | 2013-04-07 | translated | translated | [1500 × 2126](https://image.tmdb.org/t/p/original/hTP1DtLGFamjfu8WqjnuQdP1n4i.jpg) |
| Пищеблок (2021) | [tv:110623](https://www.themoviedb.org/tv/110623) | Пищеблок | ru | 2021-05-19 | translated | original | [1000 × 1500](https://image.tmdb.org/t/p/original/eKP944op6UzzI2McIesfNoLq5Lf.jpg) |
| Мастер и Маргарита (2005) | [tv:6395](https://www.themoviedb.org/tv/6395) | Мастер и Маргарита | ru | 2005-12-19 | translated | original | [1200 × 1800](https://image.tmdb.org/t/p/original/fdHbRajsZmrs7TNmPF3NjjYCMaM.jpg) |

Every selected series' IMDb and TheTVDB IDs from TMDB agreed with the corresponding TVMaze IDs below. This verifies source-to-source identity evidence, not a link in TV's live database. Severance's main dates differ by one day: TMDB returns 2022-02-17 and TVMaze returns 2022-02-18. Both external IDs agree; date equality is not an identity requirement. Card year follows TMDB's main date, while episode dates remain TVMaze data.

Arrival search returned more than one movie with that name and a 2016 date. The selected movie 329865 has IMDb `tt2543164`, runtime 116 minutes, and director Denis Villeneuve; movie 472349 has IMDb `tt5433758`, runtime 22 minutes, and director Alex Myung. The two Thing selections also have different IDs, dates, IMDb IDs, and directors: `tt0084787` / John Carpenter and `tt0905372` / Matthijs van Heijningen Jr. These detail checks support explicit identity review instead of merging by name/year.

## Live TVMaze sample

Each linked show was read through `GET https://api.tvmaze.com/shows/{id}?embed=episodes`, returning HTTP 200 and a show object containing `_embedded.episodes`. The show `language` field is recorded as returned; it does not prove the language of every episode name.

| Selected series | TVMaze show | Premiere | Show language | Regular episodes | Seasons | IMDb ID | TheTVDB ID |
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

Total: **531 regular episodes**. All ten show responses had a non-null image property. There were no empty/TBA/TBD names, missing air dates, invalid coordinates, duplicate IDs, or duplicate coordinates within each accepted series. No TVMaze image bytes were downloaded or validated. These results do not establish translated episode names or absence of missing fields outside this sample.

### Specials and existing identity exceptions

Additional `GET /shows/{id}/episodes?specials=1` requests returned these counts:

| Show | Regular | Significant specials | Insignificant specials | Import consequence |
| --- | ---: | ---: | ---: | --- |
| The Office, UK (1292) | 12 | 2 | 0 | Keep the 12 regular episodes; exclude both specials |
| Attack on Titan (919) | 89 | 8 | 24 | Keep the 89 regular episodes; exclude 32 specials |
| Cyberpunk: Edgerunners (48945) | 11 | 0 | 0 | Apply the reviewed season-1 restriction; accept ten episodes |
| Cyberpunk: Edgerunners 2 (88337) | 10 | 0 | 0 | Keep the standalone sequel and its ten regular episodes |

The original Edgerunners response still includes episode ID `3758181` at season 2, episode 1. It is outside the reviewed season restriction, not an extra episode to merge into the sequel. This is a concrete reason to preserve the existing exception when changing source-link storage.

The sequel's ten names were all TBA, while its air dates were present. Its show response had null IMDb and TheTVDB IDs. TMDB also has no IMDb/TheTVDB link for this sequel. The checked separate TMDB record is 326788; both sources name the sequel and return 2026-10-20 as its first date. Keep the reviewed TVMaze mapping and explicit operator selection; do not invent a cross-provider ID or merge it with the original show.

### Existing-card sample

These five cases are additional checks, not extra new cards:

| Existing title | TVMaze or repository evidence | Checked TMDB identity and consequence |
| --- | --- | --- |
| Dune (2021) | Existing local artwork/editorial content is documented in `catalog-content.md` | [movie:438631](https://www.themoviedb.org/movie/438631), en, 2021-09-15, IMDb tt1160419; protect current editorial values when linking |
| Kingdom (2019) | TVMaze [26153](https://www.tvmaze.com/shows/26153), Korean, premiered 2019-01-25; 12 regular episodes; IMDb tt6611916; TheTVDB 355228 | [tv:70593](https://www.themoviedb.org/tv/70593), original 킹덤, ko, same date; both external IDs agree |
| Bella Mia (2013) | Existing local artwork/editorial content and source links are documented in `catalog-content.md` | [movie:345571](https://www.themoviedb.org/movie/345571), cs, 2013-11-21, IMDb tt3038088; English description exists without an explicit English title |
| Cyberpunk: Edgerunners (2022) | TVMaze [48945](https://www.tvmaze.com/shows/48945), Japanese, premiered 2022-09-13; ten accepted episodes in season 1; IMDb tt12590266; TheTVDB 384541 | [tv:105248](https://www.themoviedb.org/tv/105248), original サイバーパンク: エッジランナーズ, ja, same date; both external IDs agree; TMDB lists one ten-episode season |
| Cyberpunk: Edgerunners 2 (2026) | TVMaze [88337](https://www.tvmaze.com/shows/88337), Japanese, premiere field 2026-10-20; ten season-1 episodes; no IMDb/TheTVDB link | [tv:326788](https://www.themoviedb.org/tv/326788), original Cyberpunk: Edgerunners 2, ja, same date; keep separate; Japanese description is missing |

The three existing series also returned non-null show images and no duplicate/invalid accepted episode identities or coordinates. Their data is not a live check of TV's staging or production records. The committed catalog still has the reviewed 783-episode snapshot; research did not modify it.

All five existing-card samples have a non-empty original title, main date, English and Russian descriptions, and Russian names. Bella Mia and Edgerunners 2 have no explicit English translated name; Dune uses its English original, and Kingdom and the original Edgerunners have English translations. Original-language descriptions exist except for the sequel's Japanese description. The checked posters decoded at 2000 × 3000 for Dune, Kingdom, and the original Edgerunners, 1528 × 2159 for Bella Mia, and 935 × 1402 for the sequel. Linking these identities must preserve current manual fields; actual repeat-import behavior is a downstream implementation test.

### Identity lookup and failure shapes

| Request | Observed result | Meaning |
| --- | --- | --- |
| `/lookup/shows?imdb=tt0290978` | HTTP 301 to `/shows/1292`, then 200 when followed | UK Office identity |
| `/lookup/shows?thetvdb=78107` | Final HTTP 200, show 1292 | Second identifier agrees for UK Office |
| `/lookup/shows?imdb=tt0386676` | Final HTTP 200, show 526 | US Office identity |
| `/lookup/shows?thetvdb=73244` | Final HTTP 200, show 526 | Second identifier agrees for US Office |
| `/lookup/shows?imdb=tt0000000` | HTTP 404 with JSON null | No match for the artificial test ID; not proof that a selected real series is absent |
| `/shows/0` | HTTP 404 with a structured error object | Invalid test show; error body differs from lookup 404 |
| `/search/shows?q=tv-issue60-no-such-show-f93ac7` | HTTP 200 with `[]` | Successful empty search, distinct from HTTP failure |

Successful TVMaze responses included `Cache-Control: public, max-age=3600`. The invalid-show response contained `{"name":"Not Found","message":"","code":0,"status":404}`. Check status before assuming an error body shape. For lookups, follow only allowed provider redirects. No 429, timeout, or 5xx occurred in these checks; no load test was run to force them. A real selected show with no regular episodes was not found in this sample.

## TMDB language and artwork findings

The usable token was read from `TMDB_READ_ACCESS_TOKEN` in the ignored root `.env` and sent only in Authorization headers. This local research setting is not an application secret deployment. See [application authentication](https://developer.themoviedb.org/docs/authentication-application).

Translation records expose missing names independently of descriptions. Original-language translation names are often empty even when `original_title` or `original_name` is populated, so an empty translation name must not erase the original title. For English originals, the core original value supplies the English name. For Dark, Bella Mia, and Edgerunners 2, an `en-US` details request returns the original name despite an empty English translated-name field. Those returned strings do not establish an English translation. Their English descriptions are present in explicit translation records and match the English details response.

Russian descriptions are present in explicit `ru-RU` records for all 25 cards and match the Russian details responses. Names and descriptions were checked separately; the report stores availability and references rather than plot text. The sequel's original-language request returns no Japanese description, agreeing with its empty Japanese translation record.

Poster checks used the default `poster_path` from each English details response, the secure base URL from `/configuration`, and the supported `original` image size. All 25 requests returned HTTP 200, `image/jpeg`, and bytes that passed Pillow verification and a full decode. Total transferred bytes were 19,052,004; individual files ranged from 167,199 to 1,841,796 bytes. Image bytes stayed in memory and were not saved in Git or uploaded to Cloudflare. These checks establish source access and decoding, not a deployed Images transformation or visual review of poster composition.

Nineteen of the 20 new cards supplied a default poster marked `en`; the Master and Margarita poster was marked `ru`. Existing Dune, Kingdom, and both Edgerunners posters were marked `en`. Bella Mia's default poster was marked `cs` in an unfiltered image request: `/3bv112Eo55vcrJ1zv7icx7I1bvX.jpg`, 1528 × 2159 pixels. Its initial `include_image_language=en,ru,null` list was empty, but the unfiltered list contained two Czech posters. An empty filtered list is not evidence that artwork is absent, and the details request language does not establish poster language.

The source poster for Attack on Titan is 1500 × 2126, and Bella Mia is 1528 × 2159. Preserve those proportions within the agreed 480 × 720 limit; do not force the downloaded composition into a 2:3 crop. No selected card lacked a poster or main date, so those absence cases remain required adapter tests rather than observed failures in this batch.

Endpoint references: [movie translations](https://developer.themoviedb.org/reference/movie-translations), [series translations](https://developer.themoviedb.org/reference/tv-series-translations), [series external IDs](https://developer.themoviedb.org/reference/tv-series-external-ids), and [image basics](https://developer.themoviedb.org/docs/image-basics).

## Episode comparison

Read every listed TMDB season, including season zero where present, for the UK Office, Attack on Titan, and both Edgerunners entries. Request English, Russian, and the original language when different. Compare with TVMaze's episode list including specials, then apply the selected regular-episode filter and existing season restriction. The main comparison used 38 TMDB calls, including eleven individual episode-translation requests. Counts outside season zero describe TMDB's structure; they do not override TVMaze's `regular` classification.

| Series | TMDB episodes outside season zero | Accepted TVMaze regular episodes | TMDB season-zero / TVMaze special count | Finding |
| --- | ---: | ---: | --- | --- |
| The Office, UK | 12 | 12 | 17 / 2 | Regular coordinates, English names, and air dates agree; special lists differ |
| Attack on Titan | 87 | 89 | 37 / 32 | TMDB puts the two final chapters in season zero; TVMaze includes them as S04E29 and S04E30 |
| Cyberpunk: Edgerunners | 10 | 10 | 0 / 0 | Agrees after the reviewed TVMaze season-1 restriction; one English name differs in capitalization |
| Cyberpunk: Edgerunners 2 | 10 | 10 | 0 / 0 | Dates and coordinates agree; TMDB returns numbered placeholders and TVMaze returns TBA names |

For Attack on Titan, TVMaze episode `2474146` at S04E29 corresponds in title/date to TMDB episode `4271770` at S00E36, and TVMaze `2643610` at S04E30 corresponds to TMDB `4271771` at S00E37. These are comparison candidates, not persisted episode links. Both pairs share dates 2023-03-04 and 2023-11-05, respectively. Source runtimes also differ for the second pair. Retain TVMaze's accepted structure rather than dropping its final chapters or importing both lists.

Some dates differ even where coordinates and names agree. Attack on Titan S04E28 is dated 2022-04-04 by TMDB and 2022-04-03 by TVMaze. No cause for that one-day difference was established. Do not treat date equality as proof of episode identity or write either date into the release calendar.

Additional focused checks followed differences visible in the card-level season counts:

| Series and season | TMDB | TVMaze | Import consequence |
| --- | --- | --- | --- |
| The Office, US, season 4 | 14 records; S04E01 `Fun Run` is one 42-minute record | 19 regular records; S04E01 and S04E02 are separate parts of `Fun Run` | Coordinates shift after combined episodes. Season and number cannot be cross-provider merge keys |
| Black Mirror, season 2 | Four records, including `White Christmas` at S02E04, ID 7014792 | Three regular records plus `White Christmas` as a significant special with no episode number, ID 501956 | Exclude the TVMaze special under the agreed rule even though TMDB puts it in a numbered season |

### Episode translation checks

The eleven translation probes covered S01E01 and S02E01 of the UK Office; the first episode of each Attack on Titan season plus S04E26-E28; and S01E01 of each Edgerunners series. The Attack on Titan probes and original Edgerunners probe had explicit English, Russian, and Japanese names and descriptions. This is measured coverage of those episodes only.

For the UK Office probes, English names/descriptions were present but Russian fields were empty. A separate S01E01 request returned `Downsize` in English and `Эпизод 1` with no description in Russian. For Edgerunners 2 S01E01, English, Russian, and Japanese translation fields were empty; details still returned `Episode 1` and `Эпизод 1`. A non-empty localized response can therefore be a generated label, not a contributed translation. Do not infer translation coverage merely because requested-language names differ.

TMDB can provide episode translations, but the measured gaps and structure differences do not justify migrating existing episodes in this delivery. Keep TMDB cards and TVMaze episodes, with independent source links for later enrichment. References: [season details](https://developer.themoviedb.org/reference/tv-season-details) and [episode translations](https://developer.themoviedb.org/reference/tv-episode-translations).

## TMDB access and failure checks

| Request | Observed result | Meaning |
| --- | --- | --- |
| `/configuration` without a token | HTTP 401, status code 7, `success: false` | Missing-access failure; checked before the owner supplied access |
| `/configuration` with the token | HTTP 200 with secure image base and supported sizes | Developer access works for the sample |
| `/movie/0` with the token | HTTP 404, status code 6, `success: false` | Selected-ID failure must not become an empty successful preview |
| `/search/movie?query=tv-issue60-no-such-movie-f93ac7` | HTTP 200 with no results | Successful empty search |
| `/search/movie` without a query | HTTP 200 with no results | This API response does not replace our own input validation |

TMDB and TVMaze live probes did not encounter 429, 5xx, or timeouts. The research deliberately stayed below published request guidance. Bounded retry, Retry-After handling, malformed data, missing dates/posters, and genuine empty episode lists remain controlled tests for task 63. No failing provider was treated as an empty source. Recheck current terms and allowances when setting up resources or publishing; no source access blocker remains for issue 60.

## Documentation and account checks

Official documentation was re-read for the selected sources and alternatives. The resulting comparison and citations are in [Managed catalog import](catalog-import.md#source-decision). TheTVDB, OMDb, and Wikidata were compared through documentation, not authenticated title samples; no coverage ranking was measured.

TMDB API terms returned HTTP 200 on direct retrieval and still showed a last-updated date of 2023-10-20. The six-month cache restriction and content removal after API use ends remain relevant to the selected manual maintenance procedure. Cloudflare pricing still distinguishes hosted storage, standard delivery, and binding transformations. No cloud resource was created or changed.

The owner's existing Workers Paid and Images Paid subscriptions remain user-confirmed information. Account usage was not rechecked here. Verify remaining storage and shared allowances before resource setup in later tasks. This does not block independent source research, but it prevents a promise of zero additional cost.

## Completion status

| Issue 60 requirement | State |
| --- | --- |
| Exact first batch and boundaries | Recorded: 20 new cards, plus five existing-card checks |
| Provider choices and documented alternatives | Recorded; the checked sample supports TMDB cards plus TVMaze episodes |
| TVMaze identities, regular episodes, specials, and selected failure shapes | Checked live |
| TMDB original/English/Russian metadata and artwork sample | Checked live for 20 new cards and five existing titles, with field gaps and decoded posters recorded |
| TMDB-to-TVMaze episode comparison | Four complete series comparisons and two additional focused season comparisons; classification, numbering, dates, and translation differences recorded |
| Identity, field ownership, missing data, and preview/application rules | Recorded with a synthetic contract example |
| Current schema constraints and later-task ownership | Recorded; application and migrations are unchanged |
| Source terms, attribution, and maintenance procedure | Documented; account usage and deployed resources remain later setup checks |

The research acceptance criteria for issue 60 are met. The observed gaps follow the agreed missing-data and identity rules; no provider or batch change is required. The GitHub issue state and child issue bodies were not changed by this local documentation work. Implementation checks for transactions, revocation, image access, retry, and manual-value protection belong to tasks 61-66; no such implementation tests ran during this research. Actual catalog imports and cloud resource setup remain outside issue 60.
