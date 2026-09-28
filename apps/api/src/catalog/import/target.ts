import { catalogImportPreviews } from '@tv/database/schema'
import * as v from 'valibot'

// oxlint-disable-next-line import/no-relative-parent-imports -- Target selection uses the catalog HTTP error contract.
import { CatalogHttpError } from '../errors.ts'

// oxlint-disable-next-line import/no-relative-parent-imports -- Recheck access in the target transaction.
import { hasCatalogImportPermission } from '../permissions.ts'
import { reviewSavedSources } from './preview-plan.ts'
import { findImportPreview, type StoredPreview } from './repository.ts'
import { requireImportPermission, type ImportSession } from './service.ts'

const targetSchema = v.variant('kind', [
  v.strictObject({ kind: v.literal('new') }),
  v.strictObject({
    kind: v.literal('existing'),
    catalogItemId: v.pipe(v.string(), v.uuid())
  })
])

interface TargetRequest {
  previewId: string;
  input: unknown;
  now?: Date;
}

// The saved candidate set is the only target allowlist. Never fetch provider data here.
async function selectImportTarget(session: ImportSession, { previewId, input, now = new Date() }: TargetRequest): Promise<StoredPreview> {
  await requireImportPermission(session)

  const parsed = v.safeParse(targetSchema, input)
  const validId = v.is(v.pipe(v.string(), v.uuid()), previewId)

  if (!parsed.success || !validId) {
    throw new CatalogHttpError('INVALID_REQUEST', 400)
  }

  const target = parsed.output

  return session.database.transaction(async (transaction) => {
    if (!await hasCatalogImportPermission(transaction, session.user.id)) {
      throw new CatalogHttpError('FORBIDDEN', 403)
    }

    const parent = await findImportPreview(transaction, {
      id: previewId,
      operatorId: session.user.id,
      now
    })

    if (parent === null) {
      throw new CatalogHttpError('NOT_FOUND', 404)
    }

    const { candidates } = parent.data

    if (target.kind === 'existing' && !candidates.some(candidate => candidate.id === target.catalogItemId)) {
      throw new CatalogHttpError('INVALID_REQUEST', 400)
    }

    const exact = candidates.filter(candidate => candidate.kind === 'exact_source')

    if (exact.some(candidate => target.kind !== 'existing' || candidate.id !== target.catalogItemId)) {
      throw new CatalogHttpError('INVALID_REQUEST', 409)
    }

    const data = {
      ...parent.data,
      target
    }

    const reviewed = await reviewSavedSources(transaction, parent.selection, data)

    if (reviewed.candidatesChanged) {
      throw new CatalogHttpError('INVALID_REQUEST', 409)
    }

    const status = reviewed.data.errors.length === 0 ? 'ready' : 'blocked'

    const rows = await transaction.insert(catalogImportPreviews).values({
      operatorId: session.user.id,
      selection: parent.selection,
      data: reviewed.data,
      status,
      catalogFingerprint: reviewed.fingerprint,
      posterBytes: parent.posterBytes,
      createdAt: now,
      expiresAt: parent.expiresAt
    }).returning()

    if (rows[0] === undefined) {
      throw new Error('Import target preview was not saved')
    }

    return rows[0]
  }, { isolationLevel: 'repeatable read' })
}

export { selectImportTarget }
