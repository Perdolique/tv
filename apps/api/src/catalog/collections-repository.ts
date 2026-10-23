import type { Database } from '@tv/database'
import { catalogCollections, catalogCollectionItems, catalogItems, catalogItemTitles } from '@tv/database/schema'

import {
  DISCOVERY_PAGE_SIZE,
  type CatalogCollection,
  type CatalogCollectionInput,
  type CatalogCollectionPage,
  type CatalogCollectionUpdate
} from '@tv/shared/catalog-discovery'

import { and, eq, inArray, sql } from 'drizzle-orm'
import { CatalogHttpError } from './errors.ts'
import { findDiscoveryCards } from './discovery-repository.ts'

interface CollectionPageOptions {
  locale: string;
  page?: number;
  editor?: boolean;
}

async function findCollectionPage(database: Pick<Database, 'select'>, id: string, { locale, page = 1, editor = false }: CollectionPageOptions): Promise<CatalogCollectionPage> {
  const rows = await database.select().from(catalogCollections)
    .where(
      eq(catalogCollections.id, id)
    )

  const [collection] = rows

  if (collection === undefined) { throw new CatalogHttpError('NOT_FOUND', 404, { message: 'This collection could not be found.' }) }

  const size = editor ? 500 : DISCOVERY_PAGE_SIZE
  const offset = (page - 1) * size

  const members = await database.select({ id: catalogCollectionItems.catalogItemId }).from(catalogCollectionItems)
    .where(
      eq(catalogCollectionItems.collectionId, id)
    )
    .orderBy(catalogCollectionItems.position)
    .offset(offset)
    .limit(size + 1)

  const visibleMembers = members.slice(0, size)
  const ids = visibleMembers.map(member => member.id)
  const items = await findDiscoveryCards(database, ids, locale)
  const nextPage = members.length > size ? page + 1 : null

  return {
    collection,
    items,
    nextPage
  }
}

async function listCollections(database: Pick<Database, 'select'>, page: number) {
  const offset = (page - 1) * DISCOVERY_PAGE_SIZE

  const rows = await database.select().from(catalogCollections)
    .orderBy(catalogCollections.title, catalogCollections.id)
    .offset(offset)
    .limit(DISCOVERY_PAGE_SIZE + 1)

  const collections = rows.slice(0, DISCOVERY_PAGE_SIZE)
  const nextPage = rows.length > DISCOVERY_PAGE_SIZE ? page + 1 : null

  return {
    collections,
    nextPage
  }
}

async function saveCollection(database: Database, input: CatalogCollectionInput | CatalogCollectionUpdate, id?: string) {
  return database.transaction(async (transaction) => {
    // Lock catalog parents before inserting memberships so a concurrent deletion cannot leave a partial save.
    if (input.itemIds.length > 0) {
      const members = await transaction.select({ id: catalogItems.id }).from(catalogItems)
        .innerJoin(catalogItemTitles, and(eq(catalogItemTitles.catalogItemId, catalogItems.id), eq(catalogItemTitles.isOriginal, true)))
        .where(
          inArray(catalogItems.id, input.itemIds)
        )
        .orderBy(catalogItems.id)
        .for('key share', { of: catalogItems })

      if (members.length !== input.itemIds.length) {
        throw new CatalogHttpError('INVALID_REQUEST', 400, { fields: { itemIds: 'Choose titles that exist in the catalog.' } })
      }
    }

    const fields = {
      title: input.title,
      description: input.description,
      isFeatured: input.isFeatured
    }

    // oxlint-disable-next-line eslint/init-declarations -- Both write branches assign the returned row.
    let collection: CatalogCollection | null

    if (id === undefined) {
      const created = await transaction.insert(catalogCollections).values(fields).returning()
      const [inserted] = created

      collection = inserted ?? null
    } else {
      if (!('revision' in input)) { throw new CatalogHttpError('INVALID_REQUEST', 400) }

      const updated = await transaction.update(catalogCollections)
        .set({
          title: input.title,
          description: input.description,
          isFeatured: input.isFeatured,
          revision: sql`${catalogCollections.revision} + 1`
        })
        .where(
          and(eq(catalogCollections.id, id), eq(catalogCollections.revision, input.revision))
        )
        .returning()

      const [saved] = updated

      collection = saved ?? null

      if (collection === null) { throw new CatalogHttpError('CONFLICT', 409, { message: 'This collection changed. Reload it and try again.' }) }

      await transaction.delete(catalogCollectionItems)
        .where(
          eq(catalogCollectionItems.collectionId, id)
        )
    }

    if (collection === null) { throw new Error('Collection insert returned no row') }

    if (input.itemIds.length > 0) {
      const collectionId = collection.id

      const members = input.itemIds.map((catalogItemId, position) => {
        return {
          collectionId,
          catalogItemId,
          position
        }
      })

      await transaction.insert(catalogCollectionItems).values(members)
    }

    return collection
  })
}

async function deleteCollection(database: Database, id: string, revision: number): Promise<void> {
  const rows = await database.delete(catalogCollections)
    .where(
      and(eq(catalogCollections.id, id), eq(catalogCollections.revision, revision))
    )
    .returning({ id: catalogCollections.id })

  if (rows.length === 0) { throw new CatalogHttpError('CONFLICT', 409, { message: 'This collection changed. Reload it and try again.' }) }
}

export { findCollectionPage, listCollections, saveCollection, deleteCollection }
