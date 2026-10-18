/* oxlint-disable vitest/prefer-each -- Playwright defines separate viewport and theme cases. */
import { expect, test } from '../fixtures/global.fixtures.ts'
import { addCookie, expectNoHorizontalOverflow } from '../helpers.ts'
import { dune } from './details.fixtures.ts'
import { waitForHydration } from './helpers.ts'

const path = `/titles/${dune.id}`
const ratingApi = `/api/catalog/items/${dune.id}/rating`

test.beforeEach(async ({ context }) => {
  await addCookie(context, 'tv_session', 'e2e-session')
})

test('keeps corrections, rewatch ratings and historical edits separate from the current vote', async ({ page }) => {
  const editor = page.getByRole('region', {
    name: 'Your rating',
    exact: true
  })

  const personal = page.getByRole('region', { name: 'Personal score' })
  const history = page.getByRole('list', { name: 'Movie viewings' })

  await test.step('record and correct the first viewing', async () => {
    await page.goto(path)
    await waitForHydration(page)

    await editor.getByRole('button', {
      name: 'Rate',
      exact: true
    }).click()

    await expect(editor.getByLabel('Watched on', { exact: true })).toBeVisible()

    await editor.getByRole('button', {
      name: '8 out of 10',
      exact: true
    }).click()

    await expect(page.getByRole('list', { name: 'Movie viewings' }).getByRole('listitem')).toHaveCount(1)
    await expect(personal).toContainText('Current viewing')
    await expect(personal).toContainText('8 out of 10')
    await expect(editor.getByRole('button', { name: 'Rate, your rating: 8 out of 10' })).toBeFocused()
    await editor.getByRole('button', { name: 'Rate, your rating: 8 out of 10' }).click()
    await expect(editor.getByLabel('Watched on', { exact: true })).toHaveCount(0)

    await editor.getByRole('button', {
      name: '6 out of 10',
      exact: true
    }).click()

    await expect(page.getByRole('list', { name: 'Movie viewings' }).getByRole('listitem')).toHaveCount(1)
  })

  await test.step('start and rate a separate rewatch', async () => {
    await page.getByRole('button', {
      name: 'Mark as watched',
      exact: true
    }).click()

    await expect(page.getByRole('list', { name: 'Movie viewings' }).getByRole('listitem')).toHaveCount(2)
    await expect(personal).toContainText('Current vote: 6/10')
    await expect(personal).not.toContainText('6 out of 10')

    await editor.getByRole('button', {
      name: 'Rate',
      exact: true
    }).click()

    await expect(editor.getByRole('button', {
      name: '6 out of 10',
      exact: true
    })).toHaveAttribute('aria-pressed', 'false')

    await editor.getByRole('button', {
      name: '7 out of 10',
      exact: true
    }).click()

    await expect(personal).toContainText('7 out of 10')
  })

  await test.step('edit and add history without changing the current vote', async () => {
    await history.getByRole('button', { name: 'Past viewing rating: 6 out of 10' }).click()

    const pastEditor = history.getByRole('region', {
      name: 'Past viewing rating',
      exact: true
    })

    await expect(pastEditor.getByRole('checkbox')).toHaveCount(0)

    await pastEditor.getByRole('button', {
      name: '9 out of 10',
      exact: true
    }).click()

    await expect(history.getByRole('button', { name: 'Past viewing rating: 9 out of 10' })).toHaveText('9/10')

    await page.getByRole('button', {
      name: 'Add past viewing',
      exact: true
    }).click()

    await page.getByLabel('Watched on', { exact: true }).fill('2020-01-01')

    await page.getByRole('button', {
      name: 'Save viewing',
      exact: true
    }).click()

    await expect(page.getByRole('list', { name: 'Movie viewings' }).getByRole('listitem')).toHaveCount(3)

    const past = history.getByRole('listitem').last()

    await past.getByRole('button', {
      name: 'Rate, Past viewing rating',
      exact: true
    }).click()

    await past.getByRole('button', {
      name: '5 out of 10',
      exact: true
    }).click()

    await expect(history.getByRole('button', { name: 'Past viewing rating: 5 out of 10' })).toHaveText('5/10')
    await expect(personal).toContainText('7 out of 10')
    await expect(page.getByRole('complementary', { name: 'Title ratings' })).toContainText('1 rating')
  })

  await test.step('reload the saved scores', async () => {
    await page.reload()
    await expect(personal).toContainText('7 out of 10')
    await expect(history.getByRole('button', { name: 'Past viewing rating: 9 out of 10' })).toHaveText('9/10')
  })
})

test('removes a retained vote from an unrated rewatch without removing an older viewing score', async ({ page }) => {
  await page.goto(path)
  await waitForHydration(page)

  const editor = page.getByRole('region', {
    name: 'Your rating',
    exact: true
  })

  await editor.getByRole('button', {
    name: 'Rate',
    exact: true
  }).click()

  await expect(editor.getByLabel('Watched on', { exact: true })).toBeVisible()

  await editor.getByRole('button', {
    name: '8 out of 10',
    exact: true
  }).click()

  await page.getByRole('button', {
    name: 'Mark as watched',
    exact: true
  }).click()

  await editor.getByRole('button', {
    name: 'Rate',
    exact: true
  }).click()

  await editor.getByRole('button', {
    name: 'Remove current vote',
    exact: true
  }).click()

  await expect(page.getByRole('region', { name: 'Personal score' })).not.toContainText('Current vote')
  await expect(page.getByRole('complementary', { name: 'Title ratings' })).toContainText('0 ratings')
  await expect(page.getByRole('button', { name: 'Past viewing rating: 8 out of 10' })).toHaveText('8/10')
})

test.describe('combined save recovery', () => {
  test.use({ expectedHttpErrors: { values: [{
    pathname: ratingApi,
    status: 503
  }] } })

  for (const recovery of ['rating editor', 'watched action'] as const) {
    const testName = `retries the same combined operation from the ${recovery} after its committed response is lost`

    test(testName, async ({ page }) => {
      let first = true
      const bodies: unknown[] = []
      const routePattern = `**${ratingApi}`

      await page.route(routePattern, async route => {
        const request = route.request()
        const method = request.method()

        // oxlint-disable-next-line vitest/no-conditional-in-test -- Only creation responses are interrupted.
        if (method !== 'PUT') {
          await route.continue()

          return
        }

        const body: unknown = request.postDataJSON()

        bodies.push(body)

        const response = await route.fetch()

        // oxlint-disable-next-line vitest/no-conditional-in-test -- The first committed response is replaced by a transport failure.
        if (first) {
          first = false

          await route.fulfill({
            status: 503,
            json: { error: { code: 'SERVICE_UNAVAILABLE' } }
          })
        } else { await route.fulfill({ response }) }
      })

      await page.goto(path)
      await waitForHydration(page)

      const editor = page.getByRole('region', {
        name: 'Your rating',
        exact: true
      })

      await editor.getByRole('button', {
        name: 'Rate',
        exact: true
      }).click()

      await expect(editor.getByLabel('Watched on', { exact: true })).toBeVisible()

      await editor.getByRole('button', {
        name: '8 out of 10',
        exact: true
      }).click()

      await expect(editor.getByRole('button', {
        name: '7 out of 10',
        exact: true
      })).toBeDisabled()

      // oxlint-disable-next-line vitest/no-conditional-in-test -- Both entry points must recover the same uncertain operation.
      if (recovery === 'watched action') {
        await editor.getByRole('button', {
          name: 'Close rating',
          exact: true
        }).click()

        const watched = page.getByRole('region', { name: 'Watched action' })

        await expect(watched).toContainText('A viewing may already have been saved.')

        await watched.getByRole('button', {
          name: 'Retry viewing',
          exact: true
        }).click()
      } else {
        await editor.getByRole('button', {
          name: 'Retry rating',
          exact: true
        }).click()
      }

      await expect(page.getByRole('list', { name: 'Movie viewings' }).getByRole('listitem')).toHaveCount(1)
      expect(bodies).toHaveLength(2)
      expect(bodies[1]).toStrictEqual(bodies[0])
      await expect(page.getByRole('region', { name: 'Personal score' })).toContainText('8 out of 10')
    })
  }
})

for (const colorScheme of ['light', 'dark'] as const) {
  for (const [width, height] of [[390, 844], [768, 1024], [1440, 1024]] as const) {
    const testName = `combined movie rating supports keyboard and layout at ${width}px in ${colorScheme}`

    test(testName, async ({ page }, testInfo) => {
      await page.setViewportSize({
        width,
        height
      })

      await page.emulateMedia({ colorScheme })
      await page.goto(path)
      await waitForHydration(page)

      const editor = page.getByRole('region', {
        name: 'Your rating',
        exact: true
      })

      const trigger = editor.getByRole('button', {
        name: 'Rate',
        exact: true
      })

      await trigger.focus()
      await page.keyboard.press('Enter')

      const date = editor.getByLabel('Watched on', { exact: true })
      const scoreGroup = editor.getByRole('group', { name: 'Choose a score' })
      const firstChildTag = await scoreGroup.evaluate(element => element.firstElementChild?.tagName)

      expect(firstChildTag).toBe('LEGEND')
      await date.focus()
      await date.fill('2020-02-03')
      await expect(date).toHaveValue('2020-02-03')
      await expectNoHorizontalOverflow(page)

      const screenshotName = `rating-${width}-${colorScheme}.png`
      const screenshotPath = testInfo.outputPath(screenshotName)

      await page.screenshot({ path: screenshotPath })

      const score = editor.getByRole('button', {
        name: '8 out of 10',
        exact: true
      })

      const bounds = await score.boundingBox()

      expect(bounds?.width).toBeGreaterThanOrEqual(44)
      await score.focus()
      await page.keyboard.press('Enter')
      await expect(page.getByRole('list', { name: 'Movie viewings' }).getByRole('listitem')).toHaveCount(1)
      await expect(editor.getByRole('button', { name: 'Rate, your rating: 8 out of 10' })).toBeFocused()
      await expectNoHorizontalOverflow(page)
    })
  }
}
