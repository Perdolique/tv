/* oxlint-disable vitest/prefer-each -- Viewport cases share the authentication control contract. */
import type { Locator } from '@playwright/test'
import { expect, test } from '../fixtures/global.fixtures.ts'
import { appBaseUrl } from '../constants.ts'
import { dune } from '../catalog/details.fixtures.ts'
import { waitForHydration } from '../catalog/helpers.ts'

const validVerificationToken = 'v'.repeat(43)

const referenceViewports = [
  {
    width: 390,
    height: 844,
    name: 'mobile'
  },
  {
    width: 768,
    height: 1024,
    name: 'tablet'
  },
  {
    width: 1440,
    height: 1024,
    name: 'desktop'
  }
] as const

async function expectCenteredLabel(control: Locator): Promise<void> {
  const offsets = await control.evaluate(element => {
    const controlBox = element.getBoundingClientRect()
    const range = globalThis.document.createRange()
    const textNodes = globalThis.document.createTreeWalker(element, globalThis.NodeFilter.SHOW_TEXT)
    const icons = element.querySelectorAll('svg')
    const rectangles = Array.from(icons, icon => icon.getBoundingClientRect())
    let node = textNodes.nextNode()

    while (node !== null) {
      const parent = node.parentElement
      const textContent = node.textContent ?? ''
      const text = textContent.trim()

      if (text !== '' && parent !== null) {
        const parentStyle = globalThis.getComputedStyle(parent)
        const isVisible = parentStyle.visibility === 'visible'

        if (isVisible) {
          range.selectNodeContents(node)

          const textRectangles = range.getClientRects()

          rectangles.push(...textRectangles)
        }
      }

      node = textNodes.nextNode()
    }

    const leftEdges = rectangles.map(rectangle => rectangle.left)
    const rightEdges = rectangles.map(rectangle => rectangle.right)
    const topEdges = rectangles.map(rectangle => rectangle.top)
    const bottomEdges = rectangles.map(rectangle => rectangle.bottom)
    const left = Math.min(...leftEdges)
    const right = Math.max(...rightEdges)
    const top = Math.min(...topEdges)
    const bottom = Math.max(...bottomEdges)
    const horizontalDistance = (left + right) / 2 - controlBox.x - controlBox.width / 2
    const verticalDistance = (top + bottom) / 2 - controlBox.y - controlBox.height / 2
    const horizontal = Math.abs(horizontalDistance)
    const vertical = Math.abs(verticalDistance)

    return {
      horizontal,
      vertical
    }
  })

  expect(offsets.horizontal).toBeLessThanOrEqual(1)
  expect(offsets.vertical).toBeLessThanOrEqual(1)
}

for (const viewport of referenceViewports) {
  test(`centers authentication link and button labels at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('/')
    await page.evaluate(async () => globalThis.document.fonts.ready)

    const navigation = page.getByRole('navigation', { name: 'Authentication' })

    await expectCenteredLabel(navigation.getByRole('link', {
      name: 'Sign in',
      exact: true
    }))

    await expectCenteredLabel(navigation.getByRole('link', {
      name: 'Create an account',
      exact: true
    }))

    await navigation.getByRole('link', {
      name: 'Sign in',
      exact: true
    }).click()

    await expectCenteredLabel(page.getByRole('button', {
      name: 'Sign in',
      exact: true
    }))

    await page.getByRole('link', {
      name: 'Create an account',
      exact: true
    }).click()

    await expectCenteredLabel(page.getByRole('button', {
      name: 'Email me a verification link',
      exact: true
    }))

    await page.goto(`/register#token=${validVerificationToken}`)

    await expectCenteredLabel(page.getByRole('button', {
      name: 'Create account',
      exact: true
    }))
  })
}

test('centers visible icons and labels in title actions before and after selection', async ({ context, page }) => {
  await context.addCookies([{
    name: 'tv_session',
    value: 'e2e-session',
    url: appBaseUrl
  }])

  await page.setViewportSize({
    width: 1440,
    height: 1024
  })

  await page.goto(`/titles/${dune.id}`)
  await waitForHydration(page)
  await page.evaluate(async () => globalThis.document.fonts.ready)

  const rate = page.getByRole('button', {
    name: 'Rate',
    exact: true
  })

  const follow = page.getByRole('button', {
    name: 'Follow',
    exact: true
  })

  const watched = page.getByRole('region', { name: 'Watched action' }).getByRole('button')

  await expect(follow).toBeEnabled()
  await expect(watched).toBeEnabled()
  await expect(watched.locator('svg path').first()).toBeVisible()
  await expectCenteredLabel(rate)
  await expectCenteredLabel(follow)
  await expectCenteredLabel(watched)
  await follow.click()
  await watched.click()
  await expect(watched).toBeEnabled()
  await expect(watched.locator('svg path').first()).toBeVisible()
  await expectCenteredLabel(follow)
  await expectCenteredLabel(watched)
})
