import type {
  ImportApplyResponse,
  ImportHistoryResponse,
  ImportPreviewResponse,
  ImportSearchResponse,
  ImportShowSearchResponse,
  ImportSourceFailureResponse
} from '@tv/shared/catalog-import'

import * as v from 'valibot'

const positiveInteger = v.pipe(v.number(), v.safeInteger(), v.minValue(1))
const nonnegativeInteger = v.pipe(v.number(), v.safeInteger(), v.minValue(0))
const uuid = v.pipe(v.string(), v.uuid())
const dateTime = v.pipe(v.string(), v.isoTimestamp())

const selectionSchema = v.variant('type', [
  v.object({
    type: v.literal('movie'),
    tmdbId: positiveInteger
  }),
  v.object({
    type: v.literal('series'),
    tmdbId: positiveInteger,

    tvmaze: v.variant('status', [
      v.object({
      status: v.literal('selected'),
      id: positiveInteger
    }),
      v.object({
      status: v.literal('verified_absent'),
      reason: v.string()
    })
    ])
  })
])

const importSearchResponseSchema = v.object({
  items: v.array(v.object({
    id: positiveInteger,
    type: v.picklist(['movie', 'series']),
    title: v.string(),
    originalTitle: v.string(),
    posterUrl: v.nullable(v.pipe(v.string(), v.regex(/^https:\/\/image\.tmdb\.org\/t\/p\/w500\/[a-zA-Z0-9]+\.(?:jpg|jpeg|png|webp)$/u))),
    year: v.nullable(nonnegativeInteger)
  })),

  nextPage: v.nullable(positiveInteger)
}) satisfies v.GenericSchema<ImportSearchResponse>

const importShowSearchResponseSchema = v.object({
  items: v.array(v.object({
    id: positiveInteger,
    title: v.string(),
    year: v.nullable(nonnegativeInteger),
    imdbId: v.nullable(v.string()),
    thetvdbId: v.nullable(positiveInteger)
  }))
}) satisfies v.GenericSchema<ImportShowSearchResponse>

const sourceIdentitySchema = v.object({
  provider: v.picklist(['tmdb', 'tvmaze']),
  entityType: v.picklist(['movie', 'tv', 'show', 'episode']),
  externalId: v.string()
})

const fieldOriginSchema = v.object({
  identity: sourceIdentitySchema,
  field: v.string(),
  locale: v.nullable(v.string())
})

function sourceValueSchema<ValueSchema extends v.GenericSchema>(value: ValueSchema) {
  return v.object({
    value,
    source: fieldOriginSchema
  })
}

const optionalTextValueSchema = sourceValueSchema(v.nullable(v.string()))
const positiveIntegerValueSchema = sourceValueSchema(positiveInteger)
const dateValueSchema = sourceValueSchema(v.nullable(v.string()))

const externalIdsSchema = v.object({
  imdb: v.nullable(v.string()),
  thetvdb: v.nullable(positiveInteger)
})

const issueSchema = v.object({
  code: v.string(),
  message: v.string()
})

const previewDataSchema = v.object({
  version: v.literal(2),

  card: v.nullable(v.object({
    identity: sourceIdentitySchema,
    type: v.picklist(['movie', 'series']),
    originalTitle: sourceValueSchema(v.string()),
    originalLanguage: sourceValueSchema(v.string()),
    releaseYear: sourceValueSchema(v.nullable(nonnegativeInteger)),

    translations: v.array(v.object({
      locale: v.string(),
      language: v.string(),
      title: optionalTextValueSchema,
      description: optionalTextValueSchema
    })),

    posterPath: optionalTextValueSchema
  })),

  episodes: v.array(v.object({
    identity: sourceIdentitySchema,
    seasonNumber: positiveIntegerValueSchema,
    episodeNumber: positiveIntegerValueSchema,
    title: optionalTextValueSchema,
    airDate: dateValueSchema
  })),

  evidence: v.object({
    tmdb: v.nullable(externalIdsSchema),

    tvmaze: v.nullable(v.object({
      identity: sourceIdentitySchema,
      name: v.nullable(v.string()),
      premiered: v.nullable(v.string()),
      language: v.nullable(v.string()),
      externalIds: externalIdsSchema,
      seasonRestriction: v.nullable(positiveInteger)
    })),

    matchingIds: v.array(v.picklist(['imdb', 'thetvdb']))
  }),

  warnings: v.array(issueSchema),
  errors: v.array(issueSchema),

  additions: v.object({
    catalogItemId: v.nullable(uuid),
    createItem: v.boolean(),
    episodeExternalIds: v.array(v.string()),
    sourceLinks: v.array(sourceIdentitySchema)
  }),

  changes: v.array(v.object({
    target: v.picklist(['item', 'title', 'description', 'episode']),
    field: v.picklist(['title', 'description', 'releaseYear', 'posterPath', 'seasonNumber', 'episodeNumber', 'sourceTitle', 'airDate']),
    locale: v.nullable(v.string()),
    episodeExternalId: v.nullable(v.string()),
    action: v.picklist(['add', 'update', 'unchanged', 'preserve_manual', 'retain_missing']),
    before: v.nullable(v.union([v.string(), v.number()])),
    after: v.nullable(v.union([v.string(), v.number()])),
    sourceValue: v.nullable(v.union([v.string(), v.number()])),
    sourceHash: v.nullable(v.string()),
    source: fieldOriginSchema
  })),

  poster: v.nullable(v.object({
    sourceUrl: v.string(),
    sourceHash: v.string(),
    sha256: v.string(),
    contentType: v.literal('image/webp'),
    width: positiveInteger,
    height: positiveInteger,
    byteLength: positiveInteger
  }))
})

const importPreviewResponseSchema = v.object({
  preview: v.object({
    id: uuid,
    status: v.picklist(['ready', 'blocked']),
    selection: selectionSchema,
    data: previewDataSchema,
    createdAt: dateTime,
    expiresAt: dateTime,
    posterUrl: v.nullable(v.string()),

    matches: v.array(v.object({
      id: uuid,
      title: v.string(),
      year: v.nullable(nonnegativeInteger),
      type: v.picklist(['movie', 'series']),
      kind: v.picklist(['exact_source', 'possible_title'])
    }))
  })
}) satisfies v.GenericSchema<ImportPreviewResponse>

const applySummarySchema = v.object({
  catalogItemId: uuid,
  createdItem: v.boolean(),
  createdEpisodes: nonnegativeInteger,
  linkedSources: nonnegativeInteger,
  changedFields: nonnegativeInteger,
  updatedFields: nonnegativeInteger,
  preservedFields: nonnegativeInteger,
  posterPath: v.nullable(v.string())
})

const operationSchema = v.object({
  id: uuid,
  previewId: uuid,
  operatorId: uuid,
  actor: v.string(),
  selection: selectionSchema,
  title: v.string(),
  status: v.picklist(['pending', 'succeeded', 'failed']),
  startedAt: dateTime,
  finishedAt: v.nullable(dateTime),
  result: v.nullable(applySummarySchema),
  issue: v.nullable(issueSchema),
  canRetry: v.boolean()
})

const importApplyResponseSchema = v.object({
  status: v.picklist(['succeeded', 'pending', 'failed', 'blocked']),
  operation: v.nullable(operationSchema),
  issue: v.nullable(issueSchema)
}) satisfies v.GenericSchema<ImportApplyResponse>

const importHistoryResponseSchema = v.object({
  items: v.array(operationSchema),
  nextCursor: v.nullable(v.string())
}) satisfies v.GenericSchema<ImportHistoryResponse>

const importOperationResponseSchema = v.object({ operation: operationSchema })

const importSourceFailureResponseSchema = v.object({
  status: v.literal('source_failure'),
  issue: issueSchema,
  retryAfterSeconds: v.nullable(nonnegativeInteger)
}) satisfies v.GenericSchema<ImportSourceFailureResponse>

export {
  importApplyResponseSchema,
  importHistoryResponseSchema,
  importOperationResponseSchema,
  importPreviewResponseSchema,
  importSearchResponseSchema,
  importShowSearchResponseSchema,
  importSourceFailureResponseSchema
}
