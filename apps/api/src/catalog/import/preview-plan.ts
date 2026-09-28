import type { Database } from '@tv/database'
import type { ImportPreviewData, ImportSelection } from '@tv/shared/catalog-import'
import { inspectCatalogState, readCatalogState } from './catalog-state.ts'
import { planImportChanges } from './changes.ts'

// Rebuild only catalog decisions; source failures and evidence survive every target choice.
async function reviewSavedSources(database: Pick<Database, 'select' | 'selectDistinct'>, selection: ImportSelection, data: ImportPreviewData) {
  const state = await readCatalogState(database, selection, data)
  const inspection = inspectCatalogState(state, selection, data)

  const plan = planImportChanges(state, {
    card: data.card,
    episodes: data.episodes,
    catalogItemId: inspection.additions.catalogItemId,
    posterHash: data.poster?.sha256 ?? null
  })

  const reviewed: ImportPreviewData = {
    ...data,
    additions: inspection.additions,
    changes: data.target.kind === 'unresolved' ? [] : plan.changes,
    errors: [...data.sourceErrors, ...inspection.errors, ...plan.errors],
    warnings: [...data.sourceWarnings, ...plan.warnings]
  }

  return {
    data: reviewed,
    candidatesChanged: inspection.candidatesChanged,
    fingerprint: inspection.fingerprint
  }
}

export { reviewSavedSources }
