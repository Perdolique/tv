import type { Database } from '@tv/database'
import { catalogItems, catalogItemTitles, catalogViewingContexts } from '@tv/database/schema'
import { and, eq } from 'drizzle-orm'

type CatalogTransaction = Parameters<Parameters<Database['transaction']>[0]>[0]

// Serializes personal changes, including first ratings, before their previous state is read.
async function lockPersonalCatalogContext(transaction: CatalogTransaction, userId: string, catalogItemId: string) {
  const items = await transaction
    .select({ type: catalogItems.type })
    .from(catalogItems)
    .innerJoin(catalogItemTitles, and(eq(catalogItemTitles.catalogItemId, catalogItems.id), eq(catalogItemTitles.isOriginal, true)))
    .where(
      eq(catalogItems.id, catalogItemId)
    )
    .limit(1)
    .for('no key update', { of: [catalogItems, catalogItemTitles] })

  const [item] = items

  if (item === undefined) {
    return null
  }

  await transaction.insert(catalogViewingContexts).values({
    userId,
    catalogItemId
  }).onConflictDoNothing()

  const contexts = await transaction.select({ version: catalogViewingContexts.contextVersion })
    .from(catalogViewingContexts)
    .where(
      and(eq(catalogViewingContexts.userId, userId), eq(catalogViewingContexts.catalogItemId, catalogItemId))
    )
    .for('update')

  if (contexts[0] === undefined) {
    throw new Error('Personal catalog context is missing')
  }

  return item
}

export { lockPersonalCatalogContext }
