/* oxlint-disable eslint/max-lines -- The auth visual contract stays readable as one responsive specification. */
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

interface DesktopVisualState extends VisualState {
  marketingTitle: string;
}

interface ElementBounds {
  bottom: number;
  left: number;
  right: number;
  top: number;
}

function authCard(page: Page): Locator {
  return page
    .getByRole('main')
    .locator('section')
    .filter({ has: page.getByRole('heading', { level: 1 }) })
}

async function readElementBounds(locator: Locator): Promise<ElementBounds> {
  return locator.evaluate((element) => {
    const rectangle = element.getBoundingClientRect()

    return {
      bottom: rectangle.bottom,
      left: rectangle.left,
      right: rectangle.right,
      top: rectangle.top
    }
  })
}

async function expectNoHorizontalClipping(page: Page, locator: Locator): Promise<void> {
  const mainOverflow = await page.getByRole('main').evaluate((main) => (
    main.scrollWidth - main.clientWidth
  ))

  const documentOverflow = await page.evaluate(() => (
    globalThis.document.documentElement.scrollWidth - globalThis.innerWidth
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
  expect(documentOverflow).toBeLessThanOrEqual(0)
  expect(bounds.left).toBeGreaterThanOrEqual(0)
  expect(bounds.right).toBeLessThanOrEqual(bounds.viewportWidth)
}

async function expectNoVerticalScrolling(page: Page): Promise<void> {
  const viewportOverflow = await page.evaluate(() => (
    globalThis.document.documentElement.scrollHeight - globalThis.innerHeight
  ))

  expect(viewportOverflow).toBeLessThanOrEqual(0)
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

const desktopVisualStates: DesktopVisualState[] = [
  {
    marketingTitle: 'Every story, right on time.',
    name: 'sign-in',

    open: async (page) => {
      await page.goto('/sign-in')
    }
  },
  {
    marketingTitle: 'Your next obsession starts here.',
    name: 'register-email',

    open: async (page) => {
      await page.goto('/register')
    }
  },
  {
    marketingTitle: 'Your next obsession starts here.',
    name: 'register-password',

    open: async (page) => {
      await page.goto(`/register#token=${validVerificationToken}`)
      await expect(page.getByRole('heading', { name: 'Choose your password' })).toBeVisible()
    }
  }
]

test.describe('Authentication responsive boundaries', () => {
  const compactBoundaryWidths = [320, 639] as const
  const expandedBoundaryWidths = [640, 1023, 1024] as const

  for (const width of compactBoundaryWidths) {
    test(`keeps the password registration state inside ${width}px`, async ({ page }) => {
      await page.setViewportSize({
        height: 844,
        width
      })

      await page.goto(`/register#token=${validVerificationToken}`)

      const marketing = page.getByRole('region', { name: 'TV highlights' })
      const createAccountButton = page.getByRole('button', { name: 'Create account' })

      await expectNoHorizontalClipping(page, createAccountButton)
      await expect(marketing).toBeHidden()
    })
  }

  for (const width of expandedBoundaryWidths) {
    test(`keeps the password registration state inside ${width}px`, async ({ page }) => {
      await page.setViewportSize({
        height: 844,
        width
      })

      await page.goto(`/register#token=${validVerificationToken}`)

      const marketing = page.getByRole('region', { name: 'TV highlights' })
      const createAccountButton = page.getByRole('button', { name: 'Create account' })

      await expectNoHorizontalClipping(page, createAccountButton)
      await expect(marketing).toBeVisible()
    })
  }

  test('stacks the auth card below marketing at 1023px', async ({ page }) => {
    await page.setViewportSize({
      height: 844,
      width: 1023
    })

    await page.goto(`/register#token=${validVerificationToken}`)

    const marketingBounds = await readElementBounds(
      page.getByRole('region', { name: 'TV highlights' })
    )

    const cardBounds = await readElementBounds(authCard(page))

    expect(cardBounds.top).toBeGreaterThanOrEqual(marketingBounds.bottom)
  })

  test('splits the auth card and marketing at 1024px', async ({ page }) => {
    await page.setViewportSize({
      height: 844,
      width: 1024
    })

    await page.goto(`/register#token=${validVerificationToken}`)

    const marketingBounds = await readElementBounds(
      page.getByRole('region', { name: 'TV highlights' })
    )

    const cardBounds = await readElementBounds(authCard(page))

    expect(cardBounds.right).toBeLessThanOrEqual(marketingBounds.left)
  })

  test('reflows without horizontal scrolling at a 200% zoom-equivalent viewport', async ({ page }) => {
    await page.setViewportSize({
      height: 360,
      width: 640
    })

    await page.goto(`/register#token=${validVerificationToken}`)

    await expectNoHorizontalClipping(
      page,
      page.getByRole('button', { name: 'Create account' })
    )
  })
})

test.describe('Authentication desktop composition', () => {
  for (const visualState of desktopVisualStates) {
    test(`keeps ${visualState.name} inside a 1366x768 split layout`, async ({ page }) => {
      await page.setViewportSize({
        height: 768,
        width: 1366
      })

      await visualState.open(page)

      const marketing = page.getByRole('region', { name: 'TV highlights' })
      const card = authCard(page)

      await expect(marketing).toContainText(visualState.marketingTitle)
      await expect(page.getByRole('link', { name: 'TV home' })).toBeVisible()
      await expect(page.getByRole('link', { name: 'Back' })).toHaveCount(0)
      await expectNoVerticalScrolling(page)

      const marketingBounds = await readElementBounds(marketing)
      const cardBounds = await readElementBounds(card)

      expect(cardBounds.right).toBeLessThanOrEqual(marketingBounds.left)
    })
  }
})

test.describe('Authentication field labels', () => {
  test('floats the email label without moving the form', async ({ page }) => {
    await page.goto('/sign-in')

    const emailInput = page.getByLabel('Email')
    const passwordInput = page.getByLabel('Password', { exact: true })
    const signInButton = page.getByRole('button', { name: 'Sign in' })
    const card = authCard(page)

    await expect(emailInput).toHaveAccessibleName('Email')
    await expect(emailInput).toHaveAttribute('id', /.+/u)

    const emailInputId = await emailInput.getAttribute('id')

    expect(emailInputId).not.toBeNull()

    const emailLabel = page.locator(`label[for="${emailInputId}"]`)
    const emailLabelText = emailLabel.locator('span')

    await expect(emailLabel).toBeVisible()
    await expect(emailLabelText).toHaveCSS('transition-property', 'transform')

    const emptyInputBounds = await readElementBounds(emailInput)
    const emptyLabelBounds = await readElementBounds(emailLabelText)
    const labelContainerBoundsBeforeFocus = await readElementBounds(emailLabel)

    expect(emptyLabelBounds.top).toBeGreaterThanOrEqual(emptyInputBounds.top)
    expect(emptyLabelBounds.bottom).toBeLessThanOrEqual(emptyInputBounds.bottom)

    const cardBoundsBeforeFocus = await readElementBounds(card)
    const passwordBoundsBeforeFocus = await readElementBounds(passwordInput)
    const buttonBoundsBeforeFocus = await readElementBounds(signInButton)

    await emailInput.focus()

    await expect.poll(async () => {
      const focusedInputBounds = await readElementBounds(emailInput)
      const focusedLabelBounds = await readElementBounds(emailLabelText)
      const inputMiddle = (focusedInputBounds.top + focusedInputBounds.bottom) / 2

      return focusedLabelBounds.bottom < inputMiddle
    }).toBe(true)

    expect(await readElementBounds(emailLabel)).toEqual(labelContainerBoundsBeforeFocus)
    expect(await readElementBounds(card)).toEqual(cardBoundsBeforeFocus)
    expect(await readElementBounds(passwordInput)).toEqual(passwordBoundsBeforeFocus)
    expect(await readElementBounds(signInButton)).toEqual(buttonBoundsBeforeFocus)
    await emailInput.fill('viewer@example.com')
    await emailInput.press('Tab')

    await expect.poll(async () => {
      const filledInputBounds = await readElementBounds(emailInput)
      const filledLabelBounds = await readElementBounds(emailLabelText)

      return filledLabelBounds.top - filledInputBounds.top
    }).toBeGreaterThanOrEqual(0)

    await expect.poll(async () => {
      const filledInputBounds = await readElementBounds(emailInput)
      const filledLabelBounds = await readElementBounds(emailLabelText)
      const inputMiddle = (filledInputBounds.top + filledInputBounds.bottom) / 2

      return inputMiddle - filledLabelBounds.bottom
    }).toBeGreaterThan(0)

    expect(await readElementBounds(emailLabel)).toEqual(labelContainerBoundsBeforeFocus)
    expect(await readElementBounds(card)).toEqual(cardBoundsBeforeFocus)
    expect(await readElementBounds(passwordInput)).toEqual(passwordBoundsBeforeFocus)
    expect(await readElementBounds(signInButton)).toEqual(buttonBoundsBeforeFocus)
    await expect(emailInput).toHaveAccessibleName('Email')
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

        await expect(page).toHaveScreenshot(
          `sign-in-${viewport.name}-${colorScheme}.png`,
          {
            animations: 'disabled',
            caret: 'hide'
          }
        )
      })

      test('focused sign-in field', async ({ page }) => {
        await page.goto('/sign-in')

        const emailInput = page.getByLabel('Email')

        await emailInput.focus()
        await expect(emailInput).toBeFocused()

        await expect(page).toHaveScreenshot(
          `sign-in-focused-${viewport.name}-${colorScheme}.png`,
          {
            animations: 'disabled',
            caret: 'hide'
          }
        )
      })

      for (const visualState of cardVisualStates) {
        test(visualState.name, async ({ page }) => {
          await visualState.open(page)

          const card = authCard(page)

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
