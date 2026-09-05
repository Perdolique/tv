import { describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { isCatalogQueryOnlyNavigation } from '../catalog-navigation.ts'

const router = createRouter({
  history: createMemoryHistory(),

  routes: [{
    path: '/',
    component: {}
  }, {
    path: '/sign-in',
    component: {}
  }]
})

describe(isCatalogQueryOnlyNavigation, () => {
  it.each([
    ['/?query=Dark', '/', true],
    ['/', '/?query=Dark', true],
    ['/?query=Arrival&source=home', '/?query=Dark&source=home', true],
    ['/?query=Dark&source=new', '/?query=Dark&source=home', false],
    ['/?query=Dark&source=home', '/?query=Dark', false],
    ['/?query=Dark#catalog', '/?query=Dark', false],
    ['/?query=Dark', '/sign-in?query=Dark', false],
    ['/', '/', false]
  ])('compares %s with %s', (target, previous, expected) => {
    const to = router.resolve(target)
    const from = router.resolve(previous)

    expect(isCatalogQueryOnlyNavigation(to, from)).toBe(expected)
  })
})
