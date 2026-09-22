import * as v from 'valibot'
import { CatalogHttpError } from './errors.ts'

const catalogEpisodeIdSchema = v.pipe(v.string(), v.uuid())

function validateCatalogEpisodeId(value: string): string {
  if (!v.is(catalogEpisodeIdSchema, value)) {
    throw new CatalogHttpError('INVALID_REQUEST', 400, {
      fields: { id: 'Use a valid catalog episode UUID.' }
    })
  }

  return value
}

export { validateCatalogEpisodeId }
