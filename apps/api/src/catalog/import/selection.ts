import * as v from 'valibot'

const sourceId = v.pipe(v.number(), v.safeInteger(), v.minValue(1))

const selectionSchema = v.variant('type', [
  v.strictObject({
    type: v.literal('movie'),
    tmdbId: sourceId
  }),
  v.strictObject({
    type: v.literal('series'),
    tmdbId: sourceId,

    tvmaze: v.variant('status', [
      v.strictObject({
      status: v.literal('selected'),
      id: sourceId
    }),
      v.strictObject({
        status: v.literal('verified_absent'),
        reason: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(2000))
      })
    ])
  })
])

export { selectionSchema, sourceId }
