/* oxlint-disable vitest/prefer-each -- Playwright uses generated tests for title and viewport variants. */
import { expect, test } from '../fixtures/global.fixtures.ts'
import { appBaseUrl } from '../constants.ts'
import { chernobyl, dune } from './details.fixtures.ts'
import { waitForHydration } from './helpers.ts'

const ratingPath = `/api/catalog/items/${dune.id}/rating`
const titlePath = `/titles/${dune.id}`
const ratingRoute = `**${ratingPath}`

test.beforeEach(async ({ context }) => {
  await context.addCookies([{
    name: 'tv_session',
    value: 'e2e-session',
    url: appBaseUrl
  }])
})

for (const item of [dune, chernobyl]) {
  test(`rates ${item.type}, preserves the score across sessions and removes it`, async ({ context, page }) => {
    const path = `/titles/${item.id}`
    const panel = page.getByRole('region', { name: 'Your rating' })
    const rate = page.getByRole('button', { name: /^(?:Rate|Rate, your rating: \d+ out of 10)$/u })
    const scoreCard = page.getByRole('region', { name: 'Personal score' })

    await test.step('save the first score', async () => {
      await page.goto(path)
      await waitForHydration(page)

      await expect(panel.getByRole('button', {
        name: 'Rate',
        exact: true
      })).toBeVisible()

      await rate.click()
      await expect(panel.getByRole('button', { name: 'Save rating' })).toHaveCount(0)

      await panel.getByRole('button', {
        name: '7 out of 10',
        exact: true
      }).click()

      await expect(panel.getByRole('button', {
        name: 'Rate, your rating: 7 out of 10',
        exact: true
      })).toHaveText('Rate')

      await expect(rate).toBeFocused()
      await expect(panel.getByRole('status')).toHaveText('Rating saved.')
      await expect(scoreCard).toContainText('7 out of 10')
    })

    await test.step('close without changing the score and save a correction immediately', async () => {
      await rate.click()

      await panel.getByRole('button', {
        name: 'Close rating',
        exact: true
      }).click()

      await expect(panel.getByRole('button', {
        name: 'Rate, your rating: 7 out of 10',
        exact: true
      })).toHaveText('Rate')

      await rate.click()

      await expect(panel.getByRole('button', {
        name: '7 out of 10',
        exact: true
      })).toHaveAttribute('aria-pressed', 'true')

      await panel.getByRole('button', {
        name: '9 out of 10',
        exact: true
      }).click()

      await expect(panel.getByRole('button', {
        name: 'Rate, your rating: 9 out of 10',
        exact: true
      })).toHaveText('Rate')

      await expect(scoreCard).toContainText('9 out of 10')
    })

    await test.step('reload and isolate scores across sessions', async () => {
      await page.reload()

      await expect(panel.getByRole('button', {
        name: 'Rate, your rating: 9 out of 10',
        exact: true
      })).toHaveText('Rate')

      await context.clearCookies({ name: 'tv_session' })
      await page.reload()

      await expect(page.getByRole('link', {
        name: 'Rate',
        exact: true
      })).toBeVisible()

      await expect(panel.getByRole('button', {
        name: 'Rate, your rating: 9 out of 10',
        exact: true
      })).toHaveCount(0)

      await expect(scoreCard).toHaveText(/^Your rating\s*—\s*$/u)

      await context.addCookies([{
        name: 'tv_session',
        value: 'e2e-long-email-session',
        url: appBaseUrl
      }])

      await page.reload()

      await expect(panel.getByRole('button', {
        name: 'Rate',
        exact: true
      })).toBeVisible()

      await context.addCookies([{
        name: 'tv_session',
        value: 'e2e-session',
        url: appBaseUrl
      }])

      await page.reload()

      await expect(panel.getByRole('button', {
        name: 'Rate, your rating: 9 out of 10',
        exact: true
      })).toHaveText('Rate')
    })

    await test.step('remove the restored account score', async () => {
      await rate.click()
      await panel.getByRole('button', { name: 'Remove rating' }).click()

      await expect(panel.getByRole('button', {
        name: 'Rate',
        exact: true
      })).toBeVisible()

      await expect(rate).toBeFocused()
      await expect(scoreCard).toHaveText(/^Your rating\s*—\s*$/u)
    })

    await expect(page.getByRole('button', {
      name: 'Follow',
      exact: true
    })).toHaveAttribute('aria-pressed', 'false')
  })
}

for (const [width, nextWidth] of [[400, 640], [1440, 390]] as const) {
  test(`shows loading and blocks overlapping writes and dismissal at ${width}px`, async ({ page }) => {
    await page.setViewportSize({
      width,
      height: 844
    })

    const read = Promise.withResolvers<boolean>()
    const write = Promise.withResolvers<boolean>()
    const panel = page.getByRole('region', { name: 'Your rating' })
    const rate = page.getByRole('button', { name: /^(?:Rate|Rate, your rating: \d+ out of 10)$/u })

    await page.route(ratingRoute, async route => {
      await read.promise

      await route.continue()
    }, { times: 1 })

    const chosenScore = panel.getByRole('button', {
      name: '8 out of 10',
      exact: true
    })

    try {
      await test.step('load the rating without moving the personal actions', async () => {
        await page.goto(titlePath)
        await waitForHydration(page)
        await expect(page.getByRole('region', { name: 'Personal score' })).toContainText('Loading…')

        const ratingAction = panel.getByRole('button', { name: 'Rate, loading rating…' })

        const follow = page.getByRole('button', {
          name: 'Follow',
          exact: true
        })

        await expect(ratingAction).toBeDisabled()
        await expect(follow).toBeEnabled()

        await page.evaluate(async () => {
          await globalThis.document.fonts.ready
        })

        const loadingRatingBox = await ratingAction.boundingBox()
        const loadingFollowBox = await follow.boundingBox()

        expect(loadingRatingBox).not.toBeNull()
        expect(loadingFollowBox).not.toBeNull()
        read.resolve(true)
        await expect(rate).toBeEnabled()

        const loadedRatingBox = await rate.boundingBox()
        const loadedFollowBox = await follow.boundingBox()

        expect(loadedRatingBox).toEqual(loadingRatingBox)
        expect(loadedFollowBox).toEqual(loadingFollowBox)
        await rate.click()
      })

      await test.step('keep the confirmed score and block dismissal during a write', async () => {
        await page.route(ratingRoute, async route => {
          await write.promise

          await route.continue()
        }, { times: 1 })

        await chosenScore.click()

        await expect(panel.getByRole('button', {
          name: 'Rate',
          exact: true
        })).toBeVisible()

        await expect(chosenScore).toBeDisabled()
        await expect(chosenScore).toHaveAttribute('aria-pressed', 'false')
        await page.keyboard.press('Escape')
        await page.mouse.click(8, 8)
        await expect(panel.getByRole('dialog')).toBeVisible()
        await expect(panel.getByRole('dialog').getByRole('status')).toHaveText('Updating rating…')

        await expect(panel.getByRole('button', {
          name: 'Close rating',
          exact: true
        })).toBeDisabled()

        await expect(panel.getByRole('button', {
          name: '9 out of 10',
          exact: true
        })).toBeDisabled()
      })

      await test.step('preserve the pending write across the breakpoint', async () => {
        await page.setViewportSize({
          width: nextWidth,
          height: 844
        })

        await expect(panel.getByRole('dialog')).toBeVisible()
        await expect(chosenScore).toBeDisabled()
      })

      await test.step('finish the write and restore focus and scrolling', async () => {
        write.resolve(true)

        await expect(panel.getByRole('button', {
          name: 'Rate, your rating: 8 out of 10',
          exact: true
        })).toHaveText('Rate')

        await expect(rate).toBeFocused()
        await expect(panel.getByRole('dialog')).toHaveCount(0)
        await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden')

        await expect(page.getByRole('button', {
          name: 'Mark as watched',
          exact: true
        })).toBeVisible()
      })
    } finally {
      read.resolve(true)
      write.resolve(true)
    }
  })
}

test.describe('expired rating session', () => {
  test.use({ expectedHttpErrors: { values: [{
    pathname: ratingPath,
    status: 401
  }] } })

  test('sends a failed write to sign-in with a return path', async ({ context, page }) => {
    await page.goto(titlePath)

    await page.getByRole('button', {
      name: 'Rate',
      exact: true
    }).click()

    await context.clearCookies({ name: 'tv_session' })

    await page.route(ratingRoute, async route => {
      await route.fulfill({
        status: 401,
        json: { error: { code: 'AUTHENTICATION_REQUIRED' } }
      })
    }, { times: 1 })

    await page.getByRole('button', {
      name: '7 out of 10',
      exact: true
    }).click()

    await expect(page).toHaveURL(/\/sign-in\?redirectTo=/u)

    const currentUrl = page.url()
    const location = new URL(currentUrl)

    expect(location.searchParams.get('redirectTo')).toBe(titlePath)
  })
})
