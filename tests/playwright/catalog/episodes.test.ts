import type { Locator, Page } from '@playwright/test'
import { longEmail } from '../auth/constants.ts'
import { appBaseUrl } from '../constants.ts'
import { expect, test } from '../fixtures/global.fixtures.ts'
import { addCookie } from '../helpers.ts'
import { chernobyl, episodeEdgeSeries } from './details.fixtures.ts'
import { openEpisodes } from './helpers.ts'

const chernobylPath = `/titles/${chernobyl.id}`
const edgeCasesPath = `/titles/${episodeEdgeSeries.id}`

async function signIn(page: Page, email = 'viewer@example.com'): Promise<void> {
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

function episodeCard(page: Page, title: string): Locator {
  return page.getByRole('listitem').filter({ hasText: title })
}

function watchedButton(card: Locator): Locator {
  return card.getByRole('button', {
    name: 'Watched',
    exact: true
  })
}

test('guest opens the five episodes, returns from sign-in and confirms the watched action', async ({ page }) => {
  const response = await page.goto(chernobylPath)

  expect(response?.status()).toBe(200)

  const html = await response?.text()

  expect(html).toContain(chernobyl.description)
  await openEpisodes(page)
  await expect(page.getByRole('tab', { name: 'Episodes' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByText(/^Season 1, E[1-5]$/u)).toHaveCount(5)

  await expect(page.getByRole('link', {
    name: 'Episode data from TVMaze',
    exact: true
  })).toHaveAttribute('href', 'https://www.tvmaze.com/')

  const targetCard = episodeCard(page, 'Please Remain Calm')
  const signInLink = targetCard.getByRole('link', { name: 'Sign in to mark watched' })

  await expect(signInLink).toHaveAttribute('href', `/sign-in?redirectTo=${chernobylPath}`)
  await signInLink.click()
  await signIn(page)
  await openEpisodes(page)
  await expect(page).toHaveURL(`${appBaseUrl}${chernobylPath}`)
  await expect(page.getByRole('tab', { name: 'Episodes' })).toHaveAttribute('aria-selected', 'true')

  const returnedButton = watchedButton(episodeCard(page, 'Please Remain Calm'))

  await expect(returnedButton).toHaveAttribute('aria-pressed', 'false')
  await returnedButton.click()
  await expect(returnedButton).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('1 watched episode', { exact: true })).toBeVisible()
})

test('episode marks survive reload and sign-in but remain private to another account', async ({ context, page }) => {
  await addCookie(context, 'tv_session', 'e2e-session')
  await page.goto(chernobylPath)
  await openEpisodes(page)

  const firstCard = episodeCard(page, '1:23:45')

  await watchedButton(firstCard).click()
  await expect(watchedButton(firstCard)).toHaveAttribute('aria-pressed', 'true')
  await expect(watchedButton(firstCard)).toBeEnabled()
  await page.reload()
  await openEpisodes(page)
  await expect(watchedButton(episodeCard(page, '1:23:45'))).toHaveAttribute('aria-pressed', 'true')

  await page.getByRole('button', {
    name: 'Sign out',
    exact: true
  }).click()

  await episodeCard(page, '1:23:45').getByRole('link', { name: 'Sign in to mark watched' }).click()
  await signIn(page)
  await openEpisodes(page)
  await expect(watchedButton(episodeCard(page, '1:23:45'))).toHaveAttribute('aria-pressed', 'true')

  await page.getByRole('button', {
    name: 'Sign out',
    exact: true
  }).click()

  await episodeCard(page, '1:23:45').getByRole('link', { name: 'Sign in to mark watched' }).click()
  await signIn(page, longEmail)
  await openEpisodes(page)
  await expect(watchedButton(episodeCard(page, '1:23:45'))).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByText('0 watched episodes', { exact: true })).toBeVisible()
})

test('unmarks a loaded episode with DELETE and keeps it unmarked after reload', async ({ context, page }) => {
  const watchedUrl = `${appBaseUrl}/api/catalog/episodes/30000000-0000-7000-8000-000000000001/watched`

  await addCookie(context, 'tv_session', 'e2e-session')

  const requestId = globalThis.crypto.randomUUID()

  const response = await context.request.put(watchedUrl, { data: {
    requestId,
    currentViewingId: null,
    contextVersion: 0,
    timeZone: 'Europe/Tallinn'
  } })

  expect(response.status()).toBe(200)
  await page.goto(chernobylPath)
  await openEpisodes(page)

  const button = watchedButton(episodeCard(page, '1:23:45'))

  await expect(button).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('1 watched episode', { exact: true })).toBeVisible()

  const mutationResponse = page.waitForResponse(watchedUrl)

  await button.click()

  const result = await mutationResponse
  const request = result.request()

  expect(request.method()).toBe('DELETE')
  expect(result.status()).toBe(200)
  await expect(button).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByText('0 watched episodes', { exact: true })).toBeVisible()
  await page.reload()
  await openEpisodes(page)
  await expect(button).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByText('0 watched episodes', { exact: true })).toBeVisible()
})

test('shows private watched loading feedback while keeping public episodes visible', async ({ context, page }) => {
  const pending = Promise.withResolvers<boolean>()
  const watchedUrl = `${appBaseUrl}/api/catalog/items/${chernobyl.id}/episodes/watched`

  await addCookie(context, 'tv_session', 'e2e-session')

  await page.route(watchedUrl, async (route) => {
    await pending.promise

    await route.continue()
  })

  try {
    await page.goto(chernobylPath)
    await openEpisodes(page)

    const loading = page.getByText('Loading watched status…', { exact: true })
    const button = watchedButton(episodeCard(page, '1:23:45'))

    await expect(loading).toBeVisible()
    await expect(loading).toHaveAttribute('role', 'status')
    await expect(button).toBeDisabled()
    await expect(button).toHaveAttribute('aria-busy', 'true')
    await expect(page.getByText(/^Season 1, E[1-5]$/u)).toHaveCount(5)
    pending.resolve(true)
    await expect(loading).toHaveCount(0)
    await expect(button).toBeEnabled()
    await expect(button).not.toHaveAttribute('aria-busy')
    await expect(page.getByText('0 watched episodes', { exact: true })).toBeVisible()
  } finally {
    pending.resolve(true)
    await page.unrouteAll({ behavior: 'wait' })
  }
})

test('renders empty data and missing title, date and future-season variants', async ({ context, page }) => {
  await page.goto(`/titles/01991a00-0000-7000-8000-000000000002`)
  await openEpisodes(page)
  await expect(page.getByText('No episode data is available yet.', { exact: true })).toBeVisible()
  await addCookie(context, 'tv_session', 'e2e-session')
  await page.goto(edgeCasesPath)
  await openEpisodes(page)
  await expect(page.getByRole('link', { name: 'Episode data from TVMaze' })).toHaveAttribute('href', 'https://www.tvmaze.com/')
  await expect(page.getByText('Season 2, E1', { exact: true })).toBeVisible()

  const selector = page.getByRole('combobox', {
    name: 'Season',
    exact: true
  })

  await expect(selector).toHaveValue('2')

  await expect(page.getByRole('heading', {
    name: 'Season 2',
    exact: true
  })).toBeVisible()

  await expect(page.getByRole('heading', {
    name: 'Episode 1',
    exact: true
  })).toBeVisible()

  await expect(page.getByRole('heading', {
    name: 'A future title',
    exact: true
  })).toBeVisible()

  await expect(watchedButton(episodeCard(page, 'A future title'))).toBeEnabled()
  await selector.selectOption('1')
  await expect(page.getByText('Season 1, E1', { exact: true })).toBeVisible()
  await expect(page.getByText('Season 1, E2', { exact: true })).toBeVisible()

  await expect(page.getByRole('heading', {
    name: 'Season 1',
    exact: true
  })).toBeVisible()

  await expect(page.getByRole('heading', {
    name: 'Episode 1',
    exact: true
  })).toBeVisible()

  await expect(page.getByRole('heading', {
    name: 'Episode 2',
    exact: true
  })).toBeVisible()

  await expect(episodeCard(page, 'Episode 1').locator('time')).toHaveCount(0)
})

test.describe('independent public episode recovery', () => {
  test('keeps title metadata visible while retrying only the episode list', async ({ context, page }) => {
    await addCookie(context, 'fail_episodes', '1')
    await page.goto(chernobylPath)
    await openEpisodes(page)
    await context.clearCookies({ name: 'fail_episodes' })

    await expect(page.getByRole('heading', {
      name: 'Chernobyl',
      exact: true
    })).toBeVisible()

    await expect(page.getByText('We couldn’t load the episodes. The title details are still available.')).toBeVisible()

    const pending = Promise.withResolvers<boolean>()

    await page.route(`${appBaseUrl}/api/catalog/items/${chernobyl.id}/episodes`, async (route) => {
      await pending.promise

      await route.continue()
    })

    const retry = page.getByRole('button', {
      name: 'Try again',
      exact: true
    })

    try {
      await retry.click()
      await expect(page.getByLabel('Loading episodes')).toBeVisible()

      await expect(page.getByRole('heading', {
        name: 'Chernobyl',
        exact: true
      })).toBeVisible()

      pending.resolve(true)

      await expect(page.getByRole('heading', {
        name: 'Season 1',
        exact: true
      })).toBeVisible()
    } finally {
      pending.resolve(true)
      await page.unrouteAll({ behavior: 'wait' })
    }
  })
})

test.describe('independent private watched recovery', () => {
  test.use({ expectedHttpErrors: { values: [{
    pathname: `/api/catalog/items/${chernobyl.id}/episodes/watched`,
    status: 503
  }] } })

  test('keeps public episodes visible and retries only private state', async ({ context, page }) => {
    await addCookie(context, 'tv_session', 'e2e-session')
    await addCookie(context, 'fail_episode_watches_load', '1')
    await page.goto(chernobylPath)
    await openEpisodes(page)

    await expect(page.getByRole('heading', {
      name: 'Please Remain Calm',
      exact: true
    })).toBeVisible()

    await expect(page.getByText('We couldn’t load your watched episodes. The episode list is still available.')).toBeVisible()

    await page.getByRole('button', {
      name: 'Retry watched status',
      exact: true
    }).click()

    await expect(watchedButton(episodeCard(page, 'Please Remain Calm'))).toBeEnabled()

    await expect(page.getByRole('heading', {
      name: 'Chernobyl',
      exact: true
    })).toBeVisible()
  })
})

test.describe('confirmed episode changes', () => {
  test.use({ expectedHttpErrors: { values: [{
    pathname: '/api/catalog/episodes/30000000-0000-7000-8000-000000000001/watched',
    status: 503
  }] } })

  test('blocks other episodes during saving and keeps a failed mark unchanged', async ({ context, page }) => {
    await addCookie(context, 'tv_session', 'e2e-session')
    await addCookie(context, 'fail_episode_watched', '1')
    await page.goto(chernobylPath)
    await openEpisodes(page)

    const first = watchedButton(episodeCard(page, '1:23:45'))
    const second = watchedButton(episodeCard(page, 'Please Remain Calm'))

    await first.click()
    await expect(first).toHaveAttribute('aria-pressed', 'false')
    await expect(first).toHaveAttribute('aria-busy', 'true')
    await expect(second).toBeDisabled()
    await expect(page.getByText('0 watched episodes', { exact: true })).toBeVisible()
    await expect(first).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByText('We couldn’t save this change. Try again.', { exact: true })).toBeVisible()
    await expect(page.getByText('0 watched episodes', { exact: true })).toBeVisible()
  })
})
