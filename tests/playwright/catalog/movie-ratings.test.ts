/* oxlint-disable vitest/prefer-each -- Playwright defines separate viewport and theme cases. */
import { expect, test } from '../fixtures/global.fixtures.ts'
import { addCookie, expectNoHorizontalOverflow } from '../helpers.ts'
import { dune } from './details.fixtures.ts'
import { waitForHydration } from './helpers.ts'

const path = `/titles/${dune.id}`
const viewingsApi = `/api/catalog/items/${dune.id}/viewings`

test.beforeEach(async ({ context }) => {
  await addCookie(context, 'tv_session', 'e2e-session')
})

test('keeps corrections, rewatch ratings and historical edits separate from the current vote', async ({ page }) => {
  await page.goto(path)
  await waitForHydration(page)

  const editor = page.getByRole('region', {
    name: 'Your rating',
    exact: true
  })

  const personal = page.getByRole('region', { name: 'Personal score' })
  const history = page.getByRole('list', { name: 'Movie viewings' })

  await editor.getByRole('button', {
    name: 'Rate',
    exact: true
  }).click()

  await editor.getByRole('checkbox', { name: 'Record a new viewing' }).check()

  await editor.getByRole('button', {
    name: '8 out of 10',
    exact: true
  }).click()

  await expect(page.getByText('1 viewing', { exact: true })).toBeVisible()
  await expect(personal).toContainText('This viewing')
  await expect(personal).toContainText('8 out of 10')
  await expect(editor.getByRole('button', { name: 'Rate, your rating: 8 out of 10' })).toBeFocused()
  await editor.getByRole('button', { name: 'Rate, your rating: 8 out of 10' }).click()
  await expect(editor.getByRole('checkbox', { name: 'Record a new viewing' })).not.toBeChecked()

  await editor.getByRole('button', {
    name: '6 out of 10',
    exact: true
  }).click()

  await expect(page.getByText('1 viewing', { exact: true })).toBeVisible()

  await page.getByRole('button', {
    name: 'Watched again',
    exact: true
  }).click()

  await expect(page.getByText('2 viewings', { exact: true })).toBeVisible()
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

  await page.getByLabel('Viewing rating (optional)', { exact: true }).selectOption('5')

  await page.getByRole('button', {
    name: 'Save viewing',
    exact: true
  }).click()

  await expect(page.getByText('3 viewings', { exact: true })).toBeVisible()
  await expect(history.getByRole('button', { name: 'Past viewing rating: 5 out of 10' })).toHaveText('5/10')
  await expect(personal).toContainText('7 out of 10')
  await expect(personal).toContainText('7 out of 10')
  await expect(page.getByRole('complementary', { name: 'Title ratings' })).toContainText('1 rating')
  await page.reload()
  await expect(personal).toContainText('7 out of 10')
  await expect(history.getByRole('button', { name: 'Past viewing rating: 9 out of 10' })).toHaveText('9/10')
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

  await editor.getByRole('checkbox', { name: 'Record a new viewing' }).check()

  await editor.getByRole('button', {
    name: '8 out of 10',
    exact: true
  }).click()

  await page.getByRole('button', {
    name: 'Watched again',
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
    pathname: viewingsApi,
    status: 503
  }] } })

  test('retries the same combined operation after its committed response is lost', async ({ page }) => {
    let first = true
    const bodies: unknown[] = []

    await page.route(`**${viewingsApi}`, async route => {
      // oxlint-disable-next-line vitest/no-conditional-in-test -- Only creation responses are interrupted.
      if (route.request().method() !== 'POST') {
        await route.continue()

        return
      }

      bodies.push(route.request().postDataJSON())

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

    await editor.getByRole('checkbox', { name: 'Record a new viewing' }).check()

    await editor.getByRole('button', {
      name: '8 out of 10',
      exact: true
    }).click()

    await expect(editor.getByRole('button', {
      name: '7 out of 10',
      exact: true
    })).toBeDisabled()

    await editor.getByRole('button', {
      name: 'Retry viewing',
      exact: true
    }).click()

    await expect(page.getByText('1 viewing', { exact: true })).toBeVisible()
    expect(bodies).toHaveLength(2)
    expect(bodies[1]).toStrictEqual(bodies[0])
    await expect(page.getByRole('region', { name: 'Personal score' })).toContainText('8 out of 10')
    await expect(page.getByRole('list', { name: 'Movie viewings' }).getByRole('listitem')).toHaveCount(1)
  })
})

for (const colorScheme of ['light', 'dark'] as const) {
  for (const [width, height] of [[390, 844], [768, 1024], [1440, 1024]] as const) {
    test(`combined movie rating supports keyboard and layout at ${width}px in ${colorScheme}`, async ({ page }, testInfo) => {
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

      const checkbox = editor.getByRole('checkbox', { name: 'Record a new viewing' })

      await checkbox.focus()
      await page.keyboard.press('Space')
      await expect(checkbox).toBeChecked()
      await expectNoHorizontalOverflow(page)
      await page.screenshot({ path: testInfo.outputPath(`rating-${width}-${colorScheme}.png`) })

      const score = editor.getByRole('button', {
        name: '8 out of 10',
        exact: true
      })

      const bounds = await score.boundingBox()

      expect(bounds?.width).toBeGreaterThanOrEqual(44)
      await score.focus()
      await page.keyboard.press('Enter')
      await expect(page.getByText('1 viewing', { exact: true })).toBeVisible()
      await expect(editor.getByRole('button', { name: 'Rate, your rating: 8 out of 10' })).toBeFocused()
      await expectNoHorizontalOverflow(page)
    })
  }
}
