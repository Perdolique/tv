/* oxlint-disable vitest/prefer-each -- Named viewport and theme cases stay explicit in browser reports. */
import type { Locator, Page } from '@playwright/test'
import { expect, test } from '../fixtures/global.fixtures.ts'
import { expectNoHorizontalOverflow } from '../helpers.ts'
import { chernobyl } from './details.fixtures.ts'

const chernobylPath = `/titles/${chernobyl.id}`

interface EpisodeCardGeometry {
  height: number;
  left: number;
  top: number;
  width: number;
}

async function readGeometry(locator: Locator): Promise<EpisodeCardGeometry> {
  return locator.evaluate((element) => {
    const { height, left, top, width } = element.getBoundingClientRect()

    return {
      height,
      left,
      top,
      width
    }
  })
}

async function expectEpisodeLayout(page: Page, expectedColumns: number): Promise<void> {
  const cards = page.getByRole('listitem')

  await expect(cards).toHaveCount(5)

  const first = await readGeometry(cards.nth(0))
  const second = await readGeometry(cards.nth(1))

  if (expectedColumns === 1) {
    expect(Math.abs(first.left - second.left)).toBeLessThanOrEqual(1)
    expect(second.top).toBeGreaterThan(first.top + first.height - 1)
  } else {
    expect(second.left).toBeGreaterThan(first.left + first.width - 1)
    expect(Math.abs(first.top - second.top)).toBeLessThanOrEqual(1)
  }

  const credit = page.getByRole('link', { name: 'Episode data from TVMaze' })

  await credit.scrollIntoViewIfNeeded()
  await expect(credit).toBeVisible()
  await expectNoHorizontalOverflow(page)
}

const referenceViewports = [
  {
    height: 844,
    name: 'mobile',
    width: 390,
    columns: 1
  },
  {
    height: 1024,
    name: 'tablet',
    width: 768,
    columns: 2
  },
  {
    height: 1024,
    name: 'desktop',
    width: 1440,
    columns: 2
  }
] as const

for (const colorScheme of ['light', 'dark'] as const) {
  for (const viewport of referenceViewports) {
    test(`episode grid at ${viewport.name} in ${colorScheme}`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.emulateMedia({ colorScheme })
      await page.goto(chernobylPath)
      await expectEpisodeLayout(page, viewport.columns)

      const episodesTab = page.getByRole('tab', { name: 'Episodes' })

      await episodesTab.focus()

      const outlineStyle = await episodesTab.evaluate(
        element => globalThis.getComputedStyle(element).outlineStyle
      )

      expect(outlineStyle).not.toBe('none')
    })
  }
}

const boundaryViewports = [
  {
    height: 844,
    name: 'narrow 320px',
    width: 320,
    columns: 1
  },
  {
    height: 900,
    name: 'below tablet breakpoint',
    width: 639,
    columns: 1
  },
  {
    height: 900,
    name: 'at tablet breakpoint',
    width: 640,
    columns: 1
  },
  {
    height: 900,
    name: 'below desktop breakpoint',
    width: 1023,
    columns: 2
  },
  {
    height: 900,
    name: 'at desktop breakpoint',
    width: 1024,
    columns: 2
  }
] as const

for (const viewport of boundaryViewports) {
  test(`episode layout has no overflow at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto(chernobylPath)
    await expectEpisodeLayout(page, viewport.columns)
  })
}
