import type { BrowserContext, Locator, Page } from '@playwright/test'
import { expect, test } from '../fixtures/global.fixtures.ts'
import { addCookie } from '../helpers.ts'
import { chernobyl, dune } from './details.fixtures.ts'
import { openEpisodes, waitForHydration } from './helpers.ts'
import { firstEpisodeId } from './timeline.fixtures.ts'

const movieTitlePath = `/titles/${dune.id}`
const seriesTitlePath = `/titles/${chernobyl.id}`
const movieRatingPath = `/api/catalog/items/${dune.id}/rating`
const movieViewingsPath = `/api/catalog/items/${dune.id}/viewings`
const seriesViewingsPath = `/api/catalog/items/${chernobyl.id}/viewings`
const seriesRewatchPath = `/api/catalog/items/${chernobyl.id}/rewatch`

interface PreparedMutation {
  submit: Locator;
  retry: Locator;
  afterDefinitiveFailure: Locator;
}

interface MutationTarget {
  name: string;
  path: string;
  prepare: (context: BrowserContext, page: Page) => Promise<PreparedMutation>;
}

async function prepareRating(_context: BrowserContext, page: Page): Promise<PreparedMutation> {
  await page.goto(movieTitlePath)
  await waitForHydration(page)

  const panel = page.getByRole('region', {
    name: 'Your rating',
    exact: true
  })

  await panel.getByRole('button', {
    name: 'Rate',
    exact: true
  }).click()

  return {
    submit: panel.getByRole('button', {
      name: '7 out of 10',
      exact: true
    }),

    retry: panel.getByRole('button', {
      name: 'Retry rating',
      exact: true
    }),

    afterDefinitiveFailure: panel.getByRole('button', {
      name: '1 out of 10',
      exact: true
    })
  }
}

async function prepareHistory(_context: BrowserContext, page: Page): Promise<PreparedMutation> {
  await page.goto(movieTitlePath)
  await waitForHydration(page)

  const panel = page.getByRole('region', {
    name: 'Your viewings',
    exact: true
  })

  await panel.getByRole('button', {
    name: 'Add past viewing',
    exact: true
  }).click()

  await panel.getByLabel('Watched on', { exact: true }).fill('2020-01-01')

  return {
    submit: panel.getByRole('button', {
      name: 'Save viewing',
      exact: true
    }),

    retry: panel.getByRole('button', {
      name: 'Retry viewing',
      exact: true
    }),

    afterDefinitiveFailure: panel.getByRole('button', {
      name: 'Refresh viewings',
      exact: true
    })
  }
}

async function prepareRewatch(context: BrowserContext, page: Page): Promise<PreparedMutation> {
  await addCookie(context, 'tv_watched_episode', firstEpisodeId)
  await page.goto(seriesTitlePath)
  await openEpisodes(page)

  await page.getByRole('button', {
    name: 'Start rewatch',
    exact: true
  }).click()

  const dialog = page.getByRole('dialog', {
    name: 'Start a rewatch',
    exact: true
  })

  const submit = dialog.getByRole('button', {
    name: 'Complete current viewing and start rewatch',
    exact: true
  })

  return {
    submit,

    retry: dialog.getByRole('button', {
      name: 'Retry rewatch',
      exact: true
    }),

    afterDefinitiveFailure: submit
  }
}

async function prepareRewatchCancellation(context: BrowserContext, page: Page): Promise<PreparedMutation> {
  const creation = await prepareRewatch(context, page)

  await creation.submit.click()

  const panel = page.getByRole('region', {
    name: 'Current series viewing',
    exact: true
  })

  const submit = panel.getByRole('button', {
    name: 'Cancel rewatch',
    exact: true
  })

  await expect(submit).toBeEnabled()

  return {
    submit,

    retry: panel.getByRole('button', {
      name: 'Retry canceling rewatch',
      exact: true
    }),

    afterDefinitiveFailure: submit
  }
}

async function holdFailure(page: Page, path: string, status: number) {
  const release = Promise.withResolvers<null>()
  const routePattern = `**${path}`

  await page.route(routePattern, async route => {
    await release.promise

    const code = status === 400 ? 'INVALID_REQUEST' : 'SERVICE_UNAVAILABLE'

    await route.fulfill({
      status,
      json: { error: { code } }
    })
  }, { times: 1 })

  return () => { release.resolve(null) }
}

const targets: MutationTarget[] = [{
  name: 'rating',
  path: movieRatingPath,
  prepare: prepareRating
}, {
  name: 'history creation',
  path: movieViewingsPath,
  prepare: prepareHistory
}, {
  name: 'rewatch creation',
  path: seriesViewingsPath,
  prepare: prepareRewatch
}, {
  name: 'rewatch cancellation',
  path: seriesRewatchPath,
  prepare: prepareRewatchCancellation
}]

test.beforeEach(async ({ context, page }) => {
  const now = new Date('2026-10-17T12:00:00Z')

  await addCookie(context, 'tv_session', 'e2e-session')
  await page.clock.setFixedTime(now)
})

for (const target of targets) {
  test.describe(`${target.name} retry focus`, () => {
    test.use({ expectedHttpErrors: { values: [{
      pathname: target.path,
      status: 503
    }, {
      pathname: target.path,
      status: 503
    }, {
      pathname: target.path,
      status: 400
    }] } })

    test('keeps keyboard focus useful after uncertain and definitive retry failures', async ({ context, page }) => {
      const mutation = await target.prepare(context, page)
      const firstRelease = await holdFailure(page, target.path, 503)

      firstRelease()
      await mutation.submit.click()
      await expect(mutation.retry).toBeEnabled()

      const repeatRelease = await holdFailure(page, target.path, 503)

      try {
        await mutation.retry.focus()
        await page.keyboard.press('Enter')
        await expect(mutation.retry).toHaveCount(0)
        repeatRelease()
        await expect(mutation.retry).toBeEnabled()
        await expect(mutation.retry).toBeFocused()
      } finally {
        repeatRelease()
      }

      const definitiveRelease = await holdFailure(page, target.path, 400)

      try {
        await page.keyboard.press('Enter')
        await expect(mutation.retry).toHaveCount(0)
        definitiveRelease()
        await expect(mutation.retry).toHaveCount(0)
        await expect(mutation.afterDefinitiveFailure).toBeEnabled()
        await expect(mutation.afterDefinitiveFailure).toBeFocused()
      } finally {
        definitiveRelease()
      }
    })
  })
}

// A modal rewatch editor keeps focus inside its dialog; cancellation exercises its independent outside-focus path.
const outsideTargets = targets.filter(target => target.name !== 'rewatch creation')

for (const target of outsideTargets) {
  test.describe(`${target.name} retry outside focus`, () => {
    test.use({ expectedHttpErrors: { values: [{
      pathname: target.path,
      status: 503
    }, {
      pathname: target.path,
      status: 503
    }] } })

    test('keeps a newer outside focus owner after another uncertain retry failure', async ({ context, page }) => {
      const mutation = await target.prepare(context, page)
      const firstRelease = await holdFailure(page, target.path, 503)

      firstRelease()
      await mutation.submit.click()
      await expect(mutation.retry).toBeEnabled()

      const repeatRelease = await holdFailure(page, target.path, 503)

      const outside = page.getByRole('link', {
        name: 'Catalog',
        exact: true
      })

      try {
        await mutation.retry.focus()
        await page.keyboard.press('Enter')
        await expect(mutation.retry).toHaveCount(0)
        await outside.focus()
        await expect(outside).toBeFocused()
        repeatRelease()
        await expect(mutation.retry).toBeEnabled()
        await expect(outside).toBeFocused()
      } finally {
        repeatRelease()
      }
    })
  })
}
