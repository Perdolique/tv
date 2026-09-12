/* oxlint-disable eslint/max-lines -- Public title, follow, recovery and navigation flows share one browser contract. */
import type { Page } from '@playwright/test'
import { appBaseUrl } from '../constants.ts'
import { expect, test } from '../fixtures/global.fixtures.ts'
import { catalogItems } from './fixtures.ts'
import { dune } from './details.fixtures.ts'
import { waitForHydration } from './helpers.ts'

const dunePath = `/titles/${dune.id}`
const arrivalPath = `/titles/${catalogItems[0].id}`
const missingPath = '/titles/01991a00-0000-7000-8000-999999999999'

async function signIn(page: Page): Promise<void> {
  await page.getByRole('textbox', {
    name: 'Email',
    exact: true
  }).fill('viewer@example.com')

  await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple')

  await page.getByRole('button', {
    name: 'Sign in',
    exact: true
  }).click()
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
      name: 'Retry',
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
      name: 'Retry',
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
