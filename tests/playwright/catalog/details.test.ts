/* oxlint-disable eslint/max-lines -- Public title, follow, recovery and navigation flows share one browser contract. */
import type { Locator, Page } from '@playwright/test'
import { appBaseUrl } from '../constants.ts'
import { expect, test } from '../fixtures/global.fixtures.ts'
import { catalogItems } from './fixtures.ts'
import { dune } from './details.fixtures.ts'
import { waitForHydration } from './helpers.ts'

const dunePath = `/titles/${dune.id}`
const arrivalPath = `/titles/${catalogItems[0].id}`
const missingPath = '/titles/01991a00-0000-7000-8000-999999999999'

async function signIn(
  page: Page,
  email = 'viewer@example.com'
): Promise<void> {
  await page.getByRole('textbox', {
    name: 'Email',
    exact: true
  }).fill(email)

  await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple')

  await page.getByRole('button', {
    name: 'Sign in',
    exact: true
  }).click()
}

function observeWatchedRequestCount(page: Page): () => number {
  let count = 0

  page.on('request', (request) => {
    const { pathname } = new URL(request.url())

    if (pathname.endsWith('/watched')) {
      count += 1
    }
  })

  return () => count
}

function observeWatchedMutationCount(page: Page): () => number {
  let count = 0

  page.on('request', (request) => {
    const { pathname } = new URL(request.url())

    if (pathname.endsWith('/watched') && request.method() !== 'GET') {
      count += 1
    }
  })

  return () => count
}

function watchedButton(page: Page): Locator {
  return page.getByRole('button', {
    name: 'Watched',
    exact: true
  })
}

function loadingIndicator(button: Locator): Locator {
  return button.locator('[data-loading-indicator]')
}

function observeFollowMutationCount(page: Page): () => number {
  let count = 0

  page.on('request', (request) => {
    const { pathname } = new URL(request.url())

    if (pathname.endsWith('/follow') && request.method() !== 'GET') {
      count += 1
    }
  })

  return () => count
}

test('serves a public title in SSR and after reload without requiring an account', async ({ page }) => {
  const response = await page.goto(dunePath)

  expect(response?.status()).toBe(200)

  const html = await response?.text()

  expect(html).toContain(dune.description)
  expect(response?.headers()['cache-control']).toBe('private, no-store')

  await expect(page.getByRole('heading', {
    name: 'Dune',
    exact: true
  })).toBeVisible()

  await expect(page.getByRole('link', {
    name: 'Sign in',
    exact: true
  })).toBeVisible()

  const catalogLink = page.getByRole('link', {
    name: 'Catalog',
    exact: true
  })

  await expect(catalogLink).toHaveAttribute('aria-current', 'page')
  await expect(catalogLink).toHaveCSS('font-weight', '700')
  await expect(catalogLink).toHaveCSS('text-decoration-line', 'underline')

  await expect(page.getByRole('link', {
    name: 'Follow',
    exact: true
  })).toHaveAttribute('href', `/sign-in?redirectTo=${dunePath}`)

  await expect(page.getByRole('img', { name: 'Dune poster' })).toHaveAttribute('data-loaded', 'true')
  await page.reload()

  await expect(page.getByRole('heading', {
    name: 'Dune',
    exact: true
  })).toBeVisible()

  await expect(page.getByRole('img', { name: 'Dune poster' })).toHaveAttribute('data-loaded', 'true')
})

test('opens search results with the keyboard and returns to the displayed query', async ({ context, page }) => {
  await context.addCookies([{
    name: 'tv_session',
    value: 'e2e-session',
    url: appBaseUrl
  }])

  await page.goto('/?query=Arrival')
  await waitForHydration(page)

  const result = page.getByRole('link', {
    name: 'Arrival Movie · 2016',
    exact: true
  })

  await result.focus()

  const outline = await result.evaluate(element => globalThis.getComputedStyle(element).outlineStyle)

  expect(outline).not.toBe('none')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(`${appBaseUrl}${arrivalPath}?query=Arrival`)

  await expect(page.getByRole('heading', {
    name: 'Arrival',
    exact: true
  })).toBeVisible()

  await expect(page.getByRole('link', {
    name: 'Calendar',
    exact: true
  })).not.toHaveAttribute('aria-current')

  await expect(page.getByText('No poster available', { exact: true })).toBeVisible()
  await expect(page.getByText('No description available yet.', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Back to results' }).click()
  await expect(page).toHaveURL(`${appBaseUrl}/?query=Arrival`)
  await expect(page.getByRole('textbox')).toHaveValue('Arrival')
  await expect(result).toBeVisible()
})

test('loads a public title before delayed account restoration finishes', async ({ context, page }) => {
  await context.addCookies([{
    name: 'tv_session',
    value: 'e2e-session',
    url: appBaseUrl
  }])

  await page.goto('/?query=Arrival')
  await waitForHydration(page)

  const sessionResponse = Promise.withResolvers<boolean>()
  const titleResponse = Promise.withResolvers<boolean>()

  await page.route(`${appBaseUrl}/api/auth/session`, async (route) => {
    await sessionResponse.promise

    await route.fulfill({ json: { user: null } })
  })

  await page.route(`${appBaseUrl}/api/catalog/items/${catalogItems[0].id}?*`, async (route) => {
    await titleResponse.promise

    await route.continue()
  })

  const sessionRequest = page.waitForRequest(`${appBaseUrl}/api/auth/session`)

  try {
    await page.getByRole('link', {
      name: 'Arrival Movie · 2016',
      exact: true
    }).click()

    await sessionRequest

    await expect(page.getByRole('heading', { name: 'Loading title…' })).toBeVisible()
    titleResponse.resolve(true)

    const title = page.getByRole('heading', {
      name: 'Arrival',
      exact: true
    })

    await expect(title).toBeVisible()

    await expect(page.getByRole('button', {
      name: 'Sign out',
      exact: true
    })).toBeVisible()

    sessionResponse.resolve(true)

    await expect(page.getByRole('link', {
      name: 'Sign in',
      exact: true
    })).toBeVisible()

    await expect(title).toBeVisible()
  } finally {
    sessionResponse.resolve(true)
    titleResponse.resolve(true)
    await page.unrouteAll({ behavior: 'wait' })
  }
})

test.describe('previous search navigation after an error', () => {
  test.use({ expectedHttpErrors: { values: [{
    pathname: '/api/catalog/search',
    status: 503
  }] } })

test('uses the previous successful query when the next search fails', async ({ context, page }) => {
  await context.addCookies([{
    name: 'tv_session',
    value: 'e2e-session',
    url: appBaseUrl
  }])

  await page.goto('/?query=Arrival')
  await waitForHydration(page)

  await context.addCookies([{
    name: 'fail_catalog',
    value: '1',
    url: appBaseUrl
  }])

  await page.getByRole('textbox').fill('Dark')
  await page.getByRole('textbox').press('Enter')
  await expect(page.getByRole('alert')).toContainText('previous results')

  await page.getByRole('link', {
    name: 'Arrival Movie · 2016',
    exact: true
  }).click()

  await expect(page).toHaveURL(`${appBaseUrl}${arrivalPath}?query=Arrival`)
  await page.getByRole('link', { name: 'Back to results' }).click()
  await expect(page.getByRole('textbox')).toHaveValue('Arrival')
})

})

test('follows from the public title, persists across reload and sign-in, then unfollows', async ({ page }) => {
  await test.step('return from guest Follow without subscribing automatically', async () => {
    await page.goto(dunePath)
    await waitForHydration(page)

    await page.getByRole('link', {
      name: 'Follow',
      exact: true
    }).click()

    await signIn(page)
    await expect(page).toHaveURL(`${appBaseUrl}${dunePath}`)

    await expect(page.getByRole('heading', {
      name: 'Dune',
      exact: true
    })).toBeVisible()

    await expect(page.getByRole('button', {
      name: 'Follow',
      exact: true
    })).toHaveAttribute('aria-pressed', 'false')
  })

  await test.step('follow and keep the saved state after reload', async () => {
    await page.getByRole('button', {
      name: 'Follow',
      exact: true
    }).click()

    await expect(page.getByRole('button', {
      name: 'Following',
      exact: true
    })).toHaveAttribute('aria-pressed', 'true')

    await page.reload()

    await expect(page.getByRole('button', {
      name: 'Following',
      exact: true
    })).toBeVisible()
  })

  await test.step('sign out and restore the same account state', async () => {
    await page.getByRole('button', {
      name: 'Sign out',
      exact: true
    }).click()

    await expect(page).toHaveURL(`${appBaseUrl}${dunePath}`)

    await expect(page.getByRole('heading', {
      name: 'Dune',
      exact: true
    })).toBeVisible()

    await page.getByRole('link', {
      name: 'Follow',
      exact: true
    }).click()

    await signIn(page)
    await expect(page).toHaveURL(`${appBaseUrl}${dunePath}`)

    await expect(page.getByRole('button', {
      name: 'Following',
      exact: true
    })).toBeVisible()
  })

  await test.step('unfollow and keep the saved state after reload', async () => {
    await page.getByRole('button', {
      name: 'Following',
      exact: true
    }).click()

    await expect(page.getByRole('button', {
      name: 'Follow',
      exact: true
    })).toHaveAttribute('aria-pressed', 'false')

    await page.reload()

    await expect(page.getByRole('button', {
      name: 'Follow',
      exact: true
    })).toBeVisible()
  })
})

test('marks a movie after sign-in, preserves the full return URL and restores the state across sessions', async ({ page }) => {
  const returnPath = `${dunePath}?query=Arrival`

  await test.step('return from guest watched action without marking automatically', async () => {
    await page.goto(returnPath)
    await waitForHydration(page)

    await page.getByRole('link', {
      name: 'Mark as watched',
      exact: true
    }).click()

    await signIn(page)
    await expect(page).toHaveURL(`${appBaseUrl}${returnPath}`)
    await expect(watchedButton(page)).toHaveAttribute('aria-pressed', 'false')
  })

  await test.step('mark the movie without following it and keep the state after reload', async () => {
    await watchedButton(page).click()
    await expect(watchedButton(page)).toHaveAttribute('aria-pressed', 'true')

    await expect(page.getByRole('button', {
      name: 'Follow',
      exact: true
    })).toHaveAttribute('aria-pressed', 'false')

    await page.reload()
    await expect(watchedButton(page)).toHaveAttribute('aria-pressed', 'true')
  })

  await test.step('sign out and restore the same account state', async () => {
    await page.getByRole('button', {
      name: 'Sign out',
      exact: true
    }).click()

    await page.getByRole('link', {
      name: 'Mark as watched',
      exact: true
    }).click()

    await signIn(page)
    await expect(page).toHaveURL(`${appBaseUrl}${returnPath}`)
    await expect(watchedButton(page)).toHaveAttribute('aria-pressed', 'true')
  })

  await test.step('unmark and keep the saved state after reload', async () => {
    await watchedButton(page).click()
    await expect(watchedButton(page)).toHaveAttribute('aria-pressed', 'false')
    await page.reload()
    await expect(watchedButton(page)).toHaveAttribute('aria-pressed', 'false')
  })
})

test('keeps watched state private to the signed-in account', async ({ context, page }) => {
  await context.addCookies([
    {
      name: 'tv_session',
      value: 'e2e-session',
      url: appBaseUrl
    },
    {
      name: 'tv_watched_item',
      value: dune.id,
      url: appBaseUrl
    }
  ])

  await page.goto(dunePath)
  await expect(watchedButton(page)).toHaveAttribute('aria-pressed', 'true')

  await context.addCookies([{
    name: 'tv_session',
    value: 'e2e-long-email-session',
    url: appBaseUrl
  }])

  await page.reload()
  await expect(watchedButton(page)).toHaveAttribute('aria-pressed', 'false')
  await watchedButton(page).click()
  await expect(watchedButton(page)).toHaveAttribute('aria-pressed', 'true')
})

test('keeps Follow and Watched independent in both directions', async ({ context, page }) => {
  await context.addCookies([{
    name: 'tv_session',
    value: 'e2e-session',
    url: appBaseUrl
  }])

  await page.goto(dunePath)

  const follow = page.getByRole('button', {
    name: 'Follow',
    exact: true
  })

  await follow.click()

  const following = page.getByRole('button', {
    name: 'Following',
    exact: true
  })

  await expect(following).toHaveAttribute('aria-pressed', 'true')
  await watchedButton(page).click()
  await expect(watchedButton(page)).toHaveAttribute('aria-pressed', 'true')
  await expect(following).toHaveAttribute('aria-pressed', 'true')
  await watchedButton(page).click()
  await expect(watchedButton(page)).toHaveAttribute('aria-pressed', 'false')
  await expect(following).toHaveAttribute('aria-pressed', 'true')
  await watchedButton(page).click()
  await following.click()
  await expect(follow).toHaveAttribute('aria-pressed', 'false')
  await expect(watchedButton(page)).toHaveAttribute('aria-pressed', 'true')
  await follow.click()
  await expect(following).toHaveAttribute('aria-pressed', 'true')
  await expect(watchedButton(page)).toHaveAttribute('aria-pressed', 'true')
})

test('keeps separate watched marks for two movies', async ({ context, page }) => {
  await context.addCookies([{
    name: 'tv_session',
    value: 'e2e-session',
    url: appBaseUrl
  }])

  await page.goto(dunePath)
  await watchedButton(page).click()
  await expect(watchedButton(page)).toHaveAttribute('aria-pressed', 'true')
  await page.goto(arrivalPath)
  await watchedButton(page).click()
  await expect(watchedButton(page)).toHaveAttribute('aria-pressed', 'true')
  await page.goto(dunePath)
  await expect(watchedButton(page)).toHaveAttribute('aria-pressed', 'true')
  await watchedButton(page).click()
  await expect(watchedButton(page)).toHaveAttribute('aria-pressed', 'false')
  await page.goto(arrivalPath)
  await expect(watchedButton(page)).toHaveAttribute('aria-pressed', 'true')
})

test('does not expose or request watched state for a series as a guest or account', async ({ context, page }) => {
  const getWatchedRequestCount = observeWatchedRequestCount(page)

  await page.goto(`/titles/${catalogItems[1].id}`)

  await expect(page.getByRole('heading', {
    name: catalogItems[1].title,
    exact: true
  })).toBeVisible()

  await expect(watchedButton(page)).toHaveCount(0)

  await expect(page.getByRole('link', {
    name: 'Mark as watched',
    exact: true
  })).toHaveCount(0)

  expect(getWatchedRequestCount()).toBe(0)

  await context.addCookies([{
    name: 'tv_session',
    value: 'e2e-session',
    url: appBaseUrl
  }])

  await page.reload()
  await expect(watchedButton(page)).toHaveCount(0)

  await expect(page.getByRole('link', {
    name: 'Mark as watched',
    exact: true
  })).toHaveCount(0)

  expect(getWatchedRequestCount()).toBe(0)
})

test('returns the production invalid UUID contract from the watched browser API', async ({ context, page }) => {
  await context.addCookies([{
    name: 'tv_session',
    value: 'e2e-session',
    url: appBaseUrl
  }])

  const response = await page.request.get(`${appBaseUrl}/api/catalog/items/not-a-uuid/watched`)

  expect(response.status()).toBe(400)
})

test('keeps public title details visible while the initial watched status loads', async ({ context, page }) => {
  const response = Promise.withResolvers<boolean>()

  await context.addCookies([{
    name: 'tv_session',
    value: 'e2e-session',
    url: appBaseUrl
  }])

  await page.route(`${appBaseUrl}/api/catalog/items/${dune.id}/watched`, async (route) => {
    await response.promise

    await route.continue()
  })

  try {
    await page.goto(dunePath)
    await waitForHydration(page)

    await expect(page.getByRole('heading', {
      name: 'Dune',
      exact: true
    })).toBeVisible()

    await expect(page.getByText(dune.description, { exact: true })).toBeVisible()

    const checking = page.getByRole('button', {
      name: 'Checking watched status…',
      exact: true
    })

    await expect(checking).toHaveAttribute('aria-busy', 'true')
    await expect(checking).toBeDisabled()
    response.resolve(true)
    await expect(watchedButton(page)).toHaveAttribute('aria-pressed', 'false')
  } finally {
    response.resolve(true)
    await page.unrouteAll({ behavior: 'wait' })
  }
})

test('delays in-button progress without changing personal action names', async ({ context, page }) => {
  const followResponse = Promise.withResolvers<boolean>()
  const watchedResponse = Promise.withResolvers<boolean>()

  await context.addCookies([{
    name: 'tv_session',
    value: 'e2e-session',
    url: appBaseUrl
  }])

  await page.goto(dunePath)
  await waitForHydration(page)

  await page.route(`${appBaseUrl}/api/catalog/items/${dune.id}/follow`, async (route) => {
    await followResponse.promise

    await route.fulfill({ json: { followed: true } })
  })

  await page.route(`${appBaseUrl}/api/catalog/items/${dune.id}/watched`, async (route) => {
    await watchedResponse.promise

    await route.fulfill({ json: { watched: true } })
  })

  try {
    const follow = page.getByRole('button', {
      name: 'Follow',
      exact: true
    })

    await follow.click()

    const following = page.getByRole('button', {
      name: 'Following',
      exact: true
    })

    const followProgress = loadingIndicator(following)

    await expect(following).toHaveAttribute('aria-busy', 'true')
    await expect(following).toBeDisabled()
    await expect(following).toHaveAccessibleName('Following')
    await expect(followProgress).toHaveCSS('visibility', 'hidden')

    const followProgressDelays = await followProgress.evaluate(element => element.getAnimations().map(
      animation => animation.effect?.getTiming().delay
    ))

    expect(followProgressDelays).toHaveLength(2)
    expect(followProgressDelays.every(delay => delay === 1000)).toBe(true)
    await expect(followProgress).toHaveCSS('opacity', '1', { timeout: 2000 })
    followResponse.resolve(true)
    await expect(following).not.toHaveAttribute('aria-busy')
    await expect(followProgress).toHaveCSS('visibility', 'hidden')
    await expect(following).toBeEnabled()
    await expect(following).toBeFocused()

    const watched = watchedButton(page)

    await watched.click()

    const watchedProgress = loadingIndicator(watched)

    await expect(watched).toHaveAttribute('aria-busy', 'true')
    await expect(watched).toHaveAttribute('aria-pressed', 'true')
    await expect(watched).toBeDisabled()
    await expect(watched).toHaveAccessibleName('Watched')
    await expect(watchedProgress).toHaveCSS('visibility', 'hidden')

    const watchedProgressDelays = await watchedProgress.evaluate(element => element.getAnimations().map(
      animation => animation.effect?.getTiming().delay
    ))

    expect(watchedProgressDelays).toHaveLength(2)
    expect(watchedProgressDelays.every(delay => delay === 1000)).toBe(true)
    await expect(watchedProgress).toHaveCSS('opacity', '1', { timeout: 2000 })
    watchedResponse.resolve(true)
    await expect(watched).not.toHaveAttribute('aria-busy')
    await expect(watchedProgress).toHaveCSS('visibility', 'hidden')
    await expect(watched).toBeEnabled()
    await expect(watched).toBeFocused()
  } finally {
    followResponse.resolve(true)
    watchedResponse.resolve(true)
    await page.unrouteAll({ behavior: 'wait' })
  }
})

test.describe('personal action read failures', () => {
  test.use({ expectedHttpErrors: { values: [
    {
      pathname: `/api/catalog/items/${dune.id}/follow`,
      status: 503
    },
    {
      pathname: `/api/catalog/items/${dune.id}/watched`,
      status: 503
    }
  ] } })

  test('gives Follow and Watched recovery controls distinct accessible names', async ({ context, page }) => {
    await context.addCookies([
      {
        name: 'tv_session',
        value: 'e2e-session',
        url: appBaseUrl
      },
      {
        name: 'fail_follow_load',
        value: '1',
        url: appBaseUrl
      },
      {
        name: 'fail_watched_load',
        value: '1',
        url: appBaseUrl
      }
    ])

    await page.goto(dunePath)

    await expect(page.getByRole('button', {
      name: 'Retry follow status',
      exact: true
    })).toBeVisible()

    await expect(page.getByRole('button', {
      name: 'Retry watched status',
      exact: true
    })).toBeVisible()
  })
})

test.describe('watched service recovery', () => {
  test.use({ expectedHttpErrors: { values: [
    {
      pathname: `/api/catalog/items/${dune.id}/watched`,
      status: 503
    },
    {
      pathname: `/api/catalog/items/${dune.id}/watched`,
      status: 503
    },
    {
      pathname: `/api/catalog/items/${dune.id}/watched`,
      status: 503
    }
  ] } })

  test('keeps public metadata and visibly recovers failed watched changes', async ({ context, page }) => {
    await context.addCookies([
      {
        name: 'tv_session',
        value: 'e2e-session',
        url: appBaseUrl
      },
      {
        name: 'fail_watched_load',
        value: '1',
        url: appBaseUrl
      }
    ])

    await page.goto(dunePath)

    await expect(page.getByRole('heading', {
      name: 'Dune',
      exact: true
    })).toBeVisible()

    await expect(page.getByText(dune.description, { exact: true })).toBeVisible()
    await expect(page.getByText('We couldn’t check whether you watched this movie. Try again.')).toBeVisible()
    await expect(page.getByText('private database connection details')).toHaveCount(0)

    await page.getByRole('button', {
      name: 'Retry watched status',
      exact: true
    }).click()

    const watched = watchedButton(page)

    await expect(watched).toHaveAttribute('aria-pressed', 'false')
    await expect(watched).toBeFocused()

    await context.addCookies([{
      name: 'fail_watched',
      value: '1',
      url: appBaseUrl
    }])

    const mutationRequestCount = observeWatchedMutationCount(page)

    await watched.click()
    await expect(watched).toHaveAttribute('aria-pressed', 'true')
    await expect(watched).toHaveAttribute('aria-busy', 'true')
    await expect(watched).toBeDisabled()
    await expect(loadingIndicator(watched)).toHaveCSS('visibility', 'hidden')
    await expect(page.getByText('Saving…', { exact: true })).toHaveCount(0)
    await page.keyboard.press('Enter')
    await expect(page.getByRole('alert')).toContainText('couldn’t update your watched status')
    await expect(page.getByText('private database connection details')).toHaveCount(0)
    await expect(watched).toHaveAttribute('aria-pressed', 'false')
    await expect(watched).toBeEnabled()
    await expect(watched).toBeFocused()
    await expect(loadingIndicator(watched)).toHaveCSS('visibility', 'hidden')
    expect(mutationRequestCount()).toBe(1)
    await watched.click()
    await expect(watched).toHaveAttribute('aria-pressed', 'true')
    await expect(watched).toBeEnabled()
    await expect(watched).toBeFocused()
    expect(mutationRequestCount()).toBe(2)

    await context.addCookies([{
      name: 'fail_watched',
      value: '1',
      url: appBaseUrl
    }])

    await watched.click()
    await expect(watched).toHaveAttribute('aria-pressed', 'false')
    await expect(watched).toHaveAttribute('aria-busy', 'true')
    await expect(watched).toBeDisabled()
    await page.keyboard.press('Enter')

    const follow = page.getByRole('button', {
      name: 'Follow',
      exact: true
    })

    await follow.focus()
    await expect(page.getByRole('alert')).toContainText('couldn’t update your watched status')
    await expect(watched).toHaveAttribute('aria-pressed', 'true')
    await expect(watched).toBeEnabled()
    await expect(follow).toBeFocused()
    expect(mutationRequestCount()).toBe(3)
    await watched.click()
    await expect(watched).toHaveAttribute('aria-pressed', 'false')
    await expect(watched).toBeFocused()
    expect(mutationRequestCount()).toBe(4)
  })
})

test.describe('watched retry focus', () => {
  test.use({ expectedHttpErrors: { values: [{
    pathname: `/api/catalog/items/${dune.id}/watched`,
    status: 503
  }] } })

  test('does not restore watched focus after the user moves to another control', async ({ context, page }) => {
    const response = Promise.withResolvers<boolean>()

    await context.addCookies([
      {
        name: 'tv_session',
        value: 'e2e-session',
        url: appBaseUrl
      },
      {
        name: 'fail_watched_load',
        value: '1',
        url: appBaseUrl
      }
    ])

    await page.goto(dunePath)
    await waitForHydration(page)

    await page.route(`${appBaseUrl}/api/catalog/items/${dune.id}/watched`, async (route) => {
      await response.promise

      await route.continue()
    })

    try {
      await page.getByRole('button', {
        name: 'Retry watched status',
        exact: true
      }).click()

      await expect(page.getByRole('button', {
        name: 'Checking watched status…',
        exact: true
      })).toBeVisible()

      const back = page.getByRole('link', {
        name: 'Back to catalog',
        exact: true
      })

      await back.focus()
      response.resolve(true)
      await expect(watchedButton(page)).toBeVisible()
      await expect(back).toBeFocused()
    } finally {
      response.resolve(true)
      await page.unrouteAll({ behavior: 'wait' })
    }
  })
})

test.describe('watched session expiry', () => {
  test.use({ expectedHttpErrors: { values: [
    {
      pathname: `/api/catalog/items/${dune.id}/watched`,
      status: 401
    },
    {
      pathname: `/api/catalog/items/${dune.id}/watched`,
      status: 401
    }
  ] } })

  test('becomes a guest after a background 401 and sends a clicked watched mutation to sign-in', async ({ context, page }) => {
    await context.addCookies([
      {
        name: 'tv_session',
        value: 'e2e-session',
        url: appBaseUrl
      },
      {
        name: 'expire_watched',
        value: '1',
        url: appBaseUrl
      }
    ])

    await page.goto(dunePath)
    await waitForHydration(page)

    await expect(page.getByRole('link', {
      name: 'Mark as watched',
      exact: true
    })).toBeVisible()

    await expect(page.getByRole('heading', {
      name: 'Dune',
      exact: true
    })).toBeVisible()

    await context.clearCookies()

    await context.addCookies([
      {
        name: 'tv_session',
        value: 'e2e-session',
        url: appBaseUrl
      },
      {
        name: 'expire_watched_mutation',
        value: '1',
        url: appBaseUrl
      }
    ])

    await page.reload()
    await watchedButton(page).click()
    await expect(page).toHaveURL(`${appBaseUrl}/sign-in?redirectTo=${dunePath}`)
  })
})

test.describe('follow service recovery', () => {
  test.use({ expectedHttpErrors: { values: [
    {
      pathname: `/api/catalog/items/${dune.id}/follow`,
      status: 503
    },
    {
      pathname: `/api/catalog/items/${dune.id}/follow`,
      status: 503
    },
    {
      pathname: `/api/catalog/items/${dune.id}/follow`,
      status: 503
    }
  ] } })

  test('keeps public metadata and visibly recovers failed follow changes', async ({ context, page }) => {
    await context.addCookies([
      {
        name: 'tv_session',
        value: 'e2e-session',
        url: appBaseUrl
      },
      {
        name: 'fail_follow_load',
        value: '1',
        url: appBaseUrl
      }
    ])

    await page.goto(dunePath)
    await waitForHydration(page)

    await expect(page.getByRole('heading', {
      name: 'Dune',
      exact: true
    })).toBeVisible()

    await expect(page.getByText(dune.description, { exact: true })).toBeVisible()
    await expect(page.getByRole('alert')).toContainText('check your follow status')
    await expect(page.getByText('private database connection details')).toHaveCount(0)

    await page.getByRole('button', {
      name: 'Retry follow status',
      exact: true
    }).click()

    const follow = page.getByRole('button', {
      name: 'Follow',
      exact: true
    })

    await expect(follow).toBeFocused()

    await context.addCookies([{
      name: 'fail_follow',
      value: '1',
      url: appBaseUrl
    }])

    const mutationRequestCount = observeFollowMutationCount(page)

    await follow.click()

    const optimistic = page.getByRole('button', {
      name: 'Following',
      exact: true
    })

    await expect(optimistic).toBeVisible()
    await expect(optimistic).toHaveAttribute('aria-busy', 'true')
    await expect(optimistic).toBeDisabled()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('alert')).toContainText('couldn’t save this change')

    const rolledBackFollow = page.getByRole('button', {
      name: 'Follow',
      exact: true
    })

    await expect(rolledBackFollow).toBeEnabled()
    await expect(rolledBackFollow).toBeFocused()
    expect(mutationRequestCount()).toBe(1)
    await rolledBackFollow.click()

    const following = page.getByRole('button', {
      name: 'Following',
      exact: true
    })

    await expect(following).toBeEnabled()
    await expect(following).toBeFocused()
    expect(mutationRequestCount()).toBe(2)

    await context.addCookies([{
      name: 'fail_follow',
      value: '1',
      url: appBaseUrl
    }])

    await following.click()

    const optimisticUnfollow = page.getByRole('button', {
      name: 'Follow',
      exact: true
    })

    await expect(optimisticUnfollow).toHaveAttribute('aria-busy', 'true')
    await expect(optimisticUnfollow).toBeDisabled()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('alert')).toContainText('couldn’t save this change')
    await expect(following).toBeEnabled()
    await expect(following).toBeFocused()
    expect(mutationRequestCount()).toBe(3)
    await following.click()
    await expect(follow).toBeEnabled()
    await expect(follow).toBeFocused()
    expect(mutationRequestCount()).toBe(4)
  })
})

test.describe('follow session expiry', () => {
  test.use({ expectedHttpErrors: { values: [
    {
      pathname: `/api/catalog/items/${dune.id}/follow`,
      status: 401
    },
    {
      pathname: `/api/catalog/items/${dune.id}/follow`,
      status: 401
    }
  ] } })

  test('becomes a guest after a background 401 and sends a clicked mutation to sign-in', async ({ context, page }) => {
    await context.addCookies([
      {
        name: 'tv_session',
        value: 'e2e-session',
        url: appBaseUrl
      },
      {
        name: 'expire_follow',
        value: '1',
        url: appBaseUrl
      }
    ])

    await page.goto(dunePath)
    await waitForHydration(page)

    await expect(page.getByRole('link', {
      name: 'Follow',
      exact: true
    })).toBeVisible()

    await expect(page.getByRole('heading', {
      name: 'Dune',
      exact: true
    })).toBeVisible()

    await context.clearCookies()

    await context.addCookies([
      {
        name: 'tv_session',
        value: 'e2e-session',
        url: appBaseUrl
      },
      {
        name: 'expire_follow_mutation',
        value: '1',
        url: appBaseUrl
      }
    ])

    await page.reload()

    await page.getByRole('button', {
      name: 'Follow',
      exact: true
    }).click()

    await expect(page).toHaveURL(`${appBaseUrl}/sign-in?redirectTo=${dunePath}`)
  })
})

test.describe('follow retry session expiry', () => {
  test.use({ expectedHttpErrors: { values: [
    {
      pathname: `/api/catalog/items/${dune.id}/follow`,
      status: 503
    },
    {
      pathname: `/api/catalog/items/${dune.id}/follow`,
      status: 401
    }
  ] } })

  test('moves focus to the title when Retry becomes a guest Follow link', async ({ context, page }) => {
    await context.addCookies([
      {
        name: 'tv_session',
        value: 'e2e-session',
        url: appBaseUrl
      },
      {
        name: 'fail_follow_load',
        value: '1',
        url: appBaseUrl
      }
    ])

    await page.goto(dunePath)
    await waitForHydration(page)

    const retry = page.getByRole('button', {
      name: 'Retry follow status',
      exact: true
    })

    await expect(retry).toBeVisible()

    await context.addCookies([{
      name: 'expire_follow',
      value: '1',
      url: appBaseUrl
    }])

    await retry.click()

    await expect(page.getByRole('link', {
      name: 'Follow',
      exact: true
    })).toBeVisible()

    await expect(page.getByRole('heading', {
      name: 'Dune',
      exact: true
    })).toBeFocused()
  })
})

test('keeps public metadata available when session restoration fails', async ({ context, page }) => {
  await context.addCookies([{
    name: 'fail_session',
    value: '2',
    url: appBaseUrl
  }])

  const response = await page.goto(dunePath)

  expect(response?.status()).toBe(200)

  await expect(page.getByRole('heading', {
    name: 'Dune',
    exact: true
  })).toBeVisible()

  await expect(page.getByRole('button', { name: 'Retry account' })).toBeVisible()
  await expect(page.getByText('You can still read this title.', { exact: false })).toBeVisible()

  const unavailableFollow = page.getByRole('button', {
    name: 'Follow unavailable',
    exact: true
  })

  await expect(unavailableFollow).toBeDisabled()
  await expect(unavailableFollow).not.toHaveAttribute('aria-busy')
})

test('renders Russian metadata with its language and original title', async ({ page }) => {
  await page.goto(`${dunePath}?titleLocale=ru-RU`)

  await expect(page.getByRole('heading', {
    name: 'Дюна',
    exact: true
  })).toHaveAttribute('lang', 'ru')

  await expect(page.getByText('Dune', { exact: true })).toHaveAttribute('lang', 'en')
  await expect(page.getByText('Пол Атрейдес прибывает', { exact: false })).toHaveAttribute('lang', 'ru')
})

test.describe('missing and unavailable titles', () => {
  test.use({ expectedHttpErrors: { values: [{
    pathname: missingPath,
    status: 404
  }] } })

  test('renders a real SSR 404 for an unknown title', async ({ page }) => {
    const response = await page.goto(missingPath)

    expect(response?.status()).toBe(404)
    await expect(page.getByRole('heading', { name: 'Title not found' })).toBeVisible()
  })
})

test.describe('invalid title identifier', () => {
  test.use({ expectedHttpErrors: { values: [{
    pathname: '/titles/not-a-uuid',
    status: 404
  }] } })

  test('renders a real SSR 404 without requesting a malformed ID from the API', async ({ page }) => {
    const requests: string[] = []

    page.on('request', request => { requests.push(request.url()) })

    const response = await page.goto('/titles/not-a-uuid')

    expect(response?.status()).toBe(404)
    await expect(page.getByRole('heading', { name: 'Title not found' })).toBeVisible()
    expect(requests.some(url => url.includes('/api/catalog/items/not-a-uuid'))).toBe(false)
  })
})

test.describe('title service recovery', () => {
  test.use({ expectedHttpErrors: { values: [{
    pathname: dunePath,
    status: 503
  }] } })

  test('shows a safe error and retries successfully with focus on the loaded title', async ({ context, page }) => {
    await context.addCookies([{
      name: 'fail_details',
      value: '1',
      url: appBaseUrl
    }])

    const response = await page.goto(dunePath)

    expect(response?.status()).toBe(503)
    await waitForHydration(page)
    await expect(page.getByRole('alert')).toContainText('temporarily unavailable')
    await expect(page.getByText('private database connection details')).toHaveCount(0)
    await context.clearCookies({ name: 'fail_details' })

    await page.getByRole('button', {
      name: 'Try again',
      exact: true
    }).click()

    await expect(page.getByRole('heading', {
      name: 'Dune',
      exact: true
    })).toBeFocused()
  })
})

test('shows loading and aborts an abandoned title request before displaying another title', async ({ context, page }) => {
  await context.addCookies([{
    name: 'tv_session',
    value: 'e2e-session',
    url: appBaseUrl
  }])

  await page.goto('/?query=a')
  await waitForHydration(page)

  await context.addCookies([{
    name: 'slow_details',
    value: '1',
    url: appBaseUrl
  }])

  const path = `/api/catalog/items/${catalogItems[0].id}`
  const started = page.waitForRequest(request => new URL(request.url()).pathname === path)
  const failed = page.waitForEvent('requestfailed', request => new URL(request.url()).pathname === path)

  await page.getByRole('link', {
    name: 'Arrival Movie · 2016',
    exact: true
  }).click()

  await started

  await expect(page.getByRole('heading', { name: 'Loading title…' })).toBeVisible()
  await page.getByRole('link', { name: 'Back to results' }).click()

  const cancelled = await failed

  expect(cancelled.failure()?.errorText).toBe('net::ERR_ABORTED')

  await page.getByRole('link', {
    name: 'Dark Series · 2017',
    exact: true
  }).click()

  await expect(page.getByRole('heading', {
    name: 'Dark',
    exact: true
  })).toBeVisible()

  await expect(page.getByRole('heading', {
    name: 'Arrival',
    exact: true
  })).toHaveCount(0)
})
