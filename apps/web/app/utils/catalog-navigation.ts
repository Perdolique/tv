import type { RouteLocationNormalized } from 'vue-router'
import { normalizeSearchQuery } from '~/utils/catalog-response.ts'

type CatalogLocation = Pick<RouteLocationNormalized, 'path' | 'hash' | 'query'>

function isCatalogQueryOnlyNavigation(to: CatalogLocation, from: CatalogLocation): boolean {
  if (to.path !== '/' || from.path !== '/' || to.hash !== from.hash) {
    return false
  }

  if (normalizeSearchQuery(to.query.query) === '') {
    return false
  }

  const keys = new Set([...Object.keys(to.query), ...Object.keys(from.query)])

  for (const key of keys) {
    if (key !== 'query' && JSON.stringify(to.query[key]) !== JSON.stringify(from.query[key])) {
      return false
    }
  }

  return JSON.stringify(to.query.query) !== JSON.stringify(from.query.query)
}

export { isCatalogQueryOnlyNavigation }
