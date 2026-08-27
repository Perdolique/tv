import type { Locator, Page } from '@playwright/test'
import { expect, test } from '../fixtures/global.fixtures.ts'

const validVerificationToken = 'v'.repeat(43)

const referenceViewports = [
  {
    height: 844,
    name: 'mobile',
    width: 390
  },
  {
    height: 1024,
    name: 'tablet',
    width: 768
  },
  {
    height: 1024,
    name: 'desktop',
    width: 1440
  }
] as const

const colorSchemes = ['light', 'dark'] as const

interface VisualState {
  name: string;
  open: (page: Page) => Promise<void>;
}

async function waitForArtwork(page: Page): Promise<void> {
  const artwork = page.locator('picture img')

  await expect(artwork).toBeVisible()
  await artwork.evaluate(async (image: HTMLImageElement) => {
    await image.decode()
  })
}

async function expectArtworkOrientation(page: Page, orientation: 'landscape' | 'portrait'): Promise<void> {
  const currentSource = await page.locator('picture img').evaluate(
    (image: HTMLImageElement) => image.currentSrc
  )

  expect(currentSource).toContain(`auth-collage-${orientation}`)
}

async function expectNoHorizontalClipping(page: Page, locator: Locator): Promise<void> {
  const mainOverflow = await page.getByRole('main').evaluate((main) => (
    main.scrollWidth - main.clientWidth
  ))

  const bounds = await locator.evaluate((element) => {
    const rectangle = element.getBoundingClientRect()

    return {
      left: rectangle.left,
      right: rectangle.right,
      viewportWidth: globalThis.innerWidth
    }
  })

  expect(mainOverflow).toBeLessThanOrEqual(0)
  expect(bounds.left).toBeGreaterThanOrEqual(0)
  expect(bounds.right).toBeLessThanOrEqual(bounds.viewportWidth)
}

const cardVisualStates: VisualState[] = [
  {
    name: 'register-email',

    open: async (page) => {
      await page.goto('/register')
    }
  },
  {
    name: 'register-check-email',

    open: async (page) => {
      await page.goto('/register')
      await page.getByLabel('Email').fill('viewer@example.com')

      const submitButton = page.getByRole('button', {
        name: 'Email me a verification link'
      })

      await expect(submitButton).toBeEnabled()
      await submitButton.click()
      await expect(page.getByText(/Check your email for the next step/u)).toBeVisible()
    }
  },
  {
    name: 'register-password',

    open: async (page) => {
      await page.goto(`/register#token=${validVerificationToken}`)
      await expect(page.getByRole('heading', { name: 'Choose your password' })).toBeVisible()
    }
  },
  {
    name: 'register-invalid',

    open: async (page) => {
      await page.goto('/register#token=short')
      await expect(page.getByRole('alert')).toHaveText(
        'This verification link is invalid or has expired.'
      )
    }
  }
]

test.describe('Authentication artwork delivery', () => {
  const artworkCases = [
    {
      expectedOrientation: 'portrait',
      height: 844,
      name: 'mobile',
      width: 390
    },
    {
      expectedOrientation: 'landscape',
      height: 1024,
      name: 'desktop',
      width: 1440
    }
  ] as const

  for (const artworkCase of artworkCases) {
    test(`loads one optimized ${artworkCase.expectedOrientation} source on ${artworkCase.name}`, async ({ page }) => {
      await page.setViewportSize({
        height: artworkCase.height,
        width: artworkCase.width
      })

      await page.goto('/sign-in')
      await waitForArtwork(page)
      await expect(page.getByRole('link', { name: 'TV home' })).toHaveCSS(
        'color',
        'rgb(247, 248, 244)'
      )

      const currentSource = await page.locator('picture img').evaluate(
        (image: HTMLImageElement) => image.currentSrc
      )

      expect(currentSource).toContain(`auth-collage-${artworkCase.expectedOrientation}`)
      expect(currentSource).toMatch(/\.avif$/u)

      const artworkRequests = await page.evaluate(() => performance
        .getEntriesByType('resource')
        .map(entry => entry.name)
        .filter(url => url.includes('auth-collage-')))

      expect(artworkRequests).toStrictEqual([currentSource])
    })
  }

  test('uses a dark fallback beneath slow or missing artwork', async ({ page }) => {
    await page.goto('/sign-in')

    await expect(page.locator('picture')).toHaveCSS(
      'background-color',
      'rgb(11, 13, 18)'
    )
  })
})

test.describe('Authentication responsive boundaries', () => {
  const compactBoundaryWidths = [320, 639] as const

  const expandedBoundaryCases = [
    {
      artworkOrientation: 'portrait',
      width: 640
    },
    {
      artworkOrientation: 'portrait',
      width: 1023
    },
    {
      artworkOrientation: 'landscape',
      width: 1024
    }
  ] as const

  for (const width of compactBoundaryWidths) {
    test(`keeps the password registration state inside ${width}px`, async ({ page }) => {
      await page.setViewportSize({
        height: 844,
        width
      })
      await page.goto(`/register#token=${validVerificationToken}`)
      await waitForArtwork(page)

      const marketing = page.getByRole('region', { name: 'TV highlights' })
      const createAccountButton = page.getByRole('button', { name: 'Create account' })

      await expectNoHorizontalClipping(page, createAccountButton)
      await expectArtworkOrientation(page, 'portrait')
      await expect(marketing).toBeHidden()
    })
  }

  for (const boundaryCase of expandedBoundaryCases) {
    test(`keeps the password registration state inside ${boundaryCase.width}px`, async ({ page }) => {
      await page.setViewportSize({
        height: 844,
        width: boundaryCase.width
      })
      await page.goto(`/register#token=${validVerificationToken}`)
      await waitForArtwork(page)

      const marketing = page.getByRole('region', { name: 'TV highlights' })
      const createAccountButton = page.getByRole('button', { name: 'Create account' })

      await expectNoHorizontalClipping(page, createAccountButton)
      await expectArtworkOrientation(page, boundaryCase.artworkOrientation)
      await expect(marketing).toBeVisible()
    })
  }

  test('reflows without horizontal scrolling at a 200% zoom-equivalent viewport', async ({ page }) => {
    await page.setViewportSize({
      height: 360,
      width: 640
    })
    await page.goto(`/register#token=${validVerificationToken}`)
    await waitForArtwork(page)

    await expectNoHorizontalClipping(
      page,
      page.getByRole('button', { name: 'Create account' })
    )
  })
})

for (const viewport of referenceViewports) {
  for (const colorScheme of colorSchemes) {
    test.describe(`${viewport.name} ${colorScheme} authentication visuals`, () => {
      test.use({
        colorScheme,

        viewport: {
          height: viewport.height,
          width: viewport.width
        }
      })

      test('sign-in', async ({ page }) => {
        await page.goto('/sign-in')
        await waitForArtwork(page)

        await expect(page).toHaveScreenshot(
          `sign-in-${viewport.name}-${colorScheme}.png`,
          {
            animations: 'disabled',
            caret: 'hide'
          }
        )
      })

      for (const visualState of cardVisualStates) {
        test(visualState.name, async ({ page }) => {
          await visualState.open(page)
          await waitForArtwork(page)

          const card = page
            .getByRole('main')
            .locator('section')
            .filter({ has: page.getByRole('heading', { level: 1 }) })

          await expect(card).toHaveScreenshot(
            `${visualState.name}-${viewport.name}-${colorScheme}-card.png`,
            {
              animations: 'disabled',
              caret: 'hide'
            }
          )
        })
      }
    })
  }
}
