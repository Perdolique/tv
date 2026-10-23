import * as v from 'valibot'

const titleRequestInputSchema = v.strictObject({
  type: v.picklist(['movie', 'series']),
  tmdbId: v.pipe(v.number(), v.safeInteger(), v.minValue(1), v.maxValue(2_147_483_647))
})

const requestCardSchema = v.object({
  type: v.picklist(['movie', 'series']),
  tmdbId: v.number(),
  title: v.string(),
  originalTitle: v.string(),
  year: v.nullable(v.number()),
  description: v.nullable(v.string()),
  posterUrl: v.nullable(v.string())
})

const titleRequestSchema = v.object({
  id: v.string(),
  card: requestCardSchema,
  createdAt: v.pipe(v.string(), v.isoTimestamp()),
  status: v.picklist(['pending', 'available']),
  catalogItemId: v.nullable(v.string()),
  requesterCount: v.number()
})

const titleRequestPageSchema = v.object({
  items: v.array(titleRequestSchema),
  nextPage: v.nullable(v.number())
})

const titleRequestPreviewSchema = v.object({
  card: requestCardSchema,
  catalogItemId: v.nullable(v.string()),

  similar: v.array(v.object({
    id: v.string(),
    title: v.string(),
    year: v.nullable(v.number()),
    type: v.picklist(['movie', 'series'])
  }))
})

type TitleRequestInput = v.InferOutput<typeof titleRequestInputSchema>
type RequestCard = v.InferOutput<typeof requestCardSchema>
type TitleRequest = v.InferOutput<typeof titleRequestSchema>
type TitleRequestPage = v.InferOutput<typeof titleRequestPageSchema>
type TitleRequestPreview = v.InferOutput<typeof titleRequestPreviewSchema>

export { titleRequestInputSchema, requestCardSchema, titleRequestSchema, titleRequestPageSchema, titleRequestPreviewSchema }
export type { TitleRequestInput, RequestCard, TitleRequest, TitleRequestPage, TitleRequestPreview }
