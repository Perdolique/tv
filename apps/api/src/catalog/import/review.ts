import type { ImportPreviewView } from '@tv/shared/catalog-import'
import type { StoredPreview } from './repository.ts'

function createImportPreviewView(preview: StoredPreview): ImportPreviewView {
  const posterUrl = preview.data.poster === null
    ? null
    : `/api/catalog/imports/previews/${preview.id}/poster`

  return {
    id: preview.id,
    status: preview.status,
    selection: preview.selection,
    data: preview.data,
    createdAt: preview.createdAt.toISOString(),
    expiresAt: preview.expiresAt.toISOString(),
    posterUrl
  }
}

export { createImportPreviewView }
