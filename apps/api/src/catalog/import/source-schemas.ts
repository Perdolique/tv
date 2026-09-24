import * as v from 'valibot'
import { sourceId } from './selection.ts'

const optionalText = v.nullish(v.string())
const optionalId = v.nullish(sourceId)
const imdbId = v.nullish(v.union([v.literal(''), v.pipe(v.string(), v.regex(/^tt\d+$/u))]))

// TMDB language codes checked on 2026-09-24, including cn/mo/sh; xx is not a known original language.
const languageCodeList = 'aa ab ae af ak am an ar as av ay az ba be bg bi bm bn bo br bs ca ce ch cn co cr cs cu cv cy da de dv dz ee el en eo es et eu fa ff fi fj fo fr fy ga gd gl gn gu gv ha he hi ho hr ht hu hy hz ia id ie ig ii ik io is it iu ja jv ka kg ki kj kk kl km kn ko kr ks ku kv kw ky la lb lg li ln lo lt lu lv mg mh mi mk ml mn mo mr ms mt my na nb nd ne ng nl nn no nr nv ny oc oj om or os pa pi pl ps pt qu rm rn ro ru rw sa sc sd se sg sh si sk sl sm sn so sq sr ss st su sv sw ta te tg th ti tk tl tn to tr ts tt tw ty ug uk ur uz ve vi vo wa wo xh yi yo za zh zu'.split(' ')
const languageCodes = new Set(languageCodeList)
const originalLanguageSchema = v.pipe(v.string(), v.check(value => languageCodes.has(value)))

const translationSchema = v.object({
  iso_639_1: v.pipe(v.string(), v.regex(/^[a-z]{2}$/u)),
  iso_3166_1: v.pipe(v.string(), v.regex(/^[A-Z]{2}$/u)),

  data: v.object({
    title: optionalText,
    name: optionalText,
    overview: optionalText
  })
})

const commonCardEntries = {
  id: sourceId,
  original_language: originalLanguageSchema,
  poster_path: optionalText,
  translations: v.object({ translations: v.array(translationSchema) }),

  external_ids: v.object({
    imdb_id: imdbId,
    tvdb_id: optionalId
  })
}

const movieSchema = v.object({
  ...commonCardEntries,
  original_title: v.pipe(v.string(), v.trim(), v.minLength(1)),
  release_date: optionalText
})

const seriesSchema = v.object({
  ...commonCardEntries,
  original_name: v.pipe(v.string(), v.trim(), v.minLength(1)),
  first_air_date: optionalText
})

const episodeSchema = v.object({
  id: sourceId,
  type: v.picklist(['regular', 'significant_special', 'insignificant_special']),
  season: v.nullish(v.pipe(v.number(), v.safeInteger())),
  number: v.nullish(v.pipe(v.number(), v.safeInteger())),
  name: optionalText,
  airdate: optionalText
})

const showSchema = v.object({
  id: sourceId,
  name: optionalText,
  premiered: optionalText,
  language: optionalText,

  externals: v.object({
    imdb: imdbId,
    thetvdb: optionalId
  }),

  _embedded: v.object({ episodes: v.array(episodeSchema) })
})

export { movieSchema, seriesSchema, showSchema }
