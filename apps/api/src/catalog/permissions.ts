import type { Database } from '@tv/database'
import { userPermissions } from '@tv/database/schema'
import { and, eq } from 'drizzle-orm'

const CATALOG_IMPORT_PERMISSION = 'catalog.manage'

async function hasCatalogImportPermission(database: Database, userId: string): Promise<boolean> {
  const rows = await database
    .select({ permission: userPermissions.permission })
    .from(userPermissions)
    .where(
      and(
        eq(userPermissions.userId, userId),
        eq(userPermissions.permission, CATALOG_IMPORT_PERMISSION)
      )
    )
    .limit(1)

  return rows.length > 0
}

export { hasCatalogImportPermission }
