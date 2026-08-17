import type { BrowserContext, Page } from '@playwright/test'
import { appBaseUrl } from '../constants.ts'
import { expect, test } from '../fixtures/global.fixtures.ts'
import { longEmail } from './constants.ts'

const validPassword = 'correct horse battery staple'

const expectedAuthErrorTest = test.extend({
  expectedHttpErrorStatuses: [401, 503]
})

const expectedUnavailableErrorTest = test.extend({
  expectedHttpErrorStatuses: [503]
})

interface SignInOptions {
  email?: string;
  target?: string;
}

interface VueRouter {
  push: (target: string) => Promise<unknown>;
}

interface VueGlobalProperties {
  $router: VueRouter;
}

interface VueApplicationConfig {
  globalProperties: VueGlobalProperties;
}

interface VueApplication {
  config: VueApplicationConfig;
}

interface VueRootElement extends HTMLElement {
  __vue_app__?: VueApplication;
}

async function fillSignIn(
  page: Page,
  email = 'viewer@example.com',
  password = validPassword
): Promise<void> {
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
}

async function signIn(page: Page, options: SignInOptions = {}): Promise<void> {
  await page.goto(options.target ?? '/sign-in')
  await fillSignIn(page, options.email)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByText('Signed in as')).toBeVisible()
  await expect(page).toHaveTitle('Your catalog · TV')
}

async function addFailedSignOutCookie(context: BrowserContext): Promise<void> {
  await context.addCookies([{
    name: 'fail_sign_out',
    url: appBaseUrl,
    value: '1'
  }])
}

async function addRecoverableSessionCookies(context: BrowserContext): Promise<void> {
  await context.addCookies([{
    name: 'tv_session',
    url: appBaseUrl,
    value: 'e2e-session'
  }, {
    name: 'fail_session',
    url: appBaseUrl,
    value: '1'
  }])
}

async function navigateWithClientRouter(page: Page, target: string): Promise<void> {
  await page.evaluate(async (path) => {
    const root = globalThis.document.querySelector<VueRootElement>('#__nuxt')
    // oxlint-disable-next-line eslint/no-underscore-dangle -- Vue exposes the application instance on the root element for browser tooling.
    const router = root?.__vue_app__?.config.globalProperties.$router

    if (router === undefined) {
      throw new Error('Nuxt client router is unavailable')
    }

    await router.push(path)
  }, target)
}

test.describe('Authentication routing and SSR', () => {
  test('redirects an anonymous SSR request for the protected page', async ({ page }) => {
    await page.goto('/')

    await expect(page).toHaveURL(`${appBaseUrl}/sign-in?redirectTo=/`)
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
    await expect(page).toHaveTitle('Sign in · TV')
  })

  test('sets a distinct title after client-side guest navigation', async ({ page }) => {
    await page.goto('/sign-in')
    await page.getByRole('link', { name: 'Create an account' }).click()

    await expect(page).toHaveURL(`${appBaseUrl}/register?redirectTo=/`)
    await expect(page).toHaveTitle('Create account · TV')
  })

  test.describe('without JavaScript', () => {
    test.use({ javaScriptEnabled: false })

    test('renders both guest forms on the server', async ({ page }) => {
      await page.goto('/sign-in')
      await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
      await expect(page.getByLabel('Email')).toBeVisible()
      await expect(page.getByLabel('Password', { exact: true })).toBeVisible()

      await page.goto('/register')
      await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible()
      await expect(page.getByLabel('Confirm password')).toBeVisible()
    })
  })

  test('redirects authenticated users away from guest pages', async ({ page }) => {
    await signIn(page)

    await page.goto('/sign-in')
    await expect(page).toHaveURL(`${appBaseUrl}/`)

    await page.goto('/register')
    await expect(page).toHaveURL(`${appBaseUrl}/`)
  })
})

test.describe('Authentication forms', () => {
  test('toggles password visibility with an accessible name', async ({ page }) => {
    await page.goto('/sign-in')

    const password = page.getByLabel('Password', { exact: true })

    await expect(password).toHaveAttribute('type', 'password')

    await page.getByRole('button', { name: 'Show password' }).click()
    await expect(password).toHaveAttribute('type', 'text')
    await expect(page.getByRole('button', { name: 'Hide password' })).toBeVisible()

    await page.goto('/register')

    const passwordFields = page.locator('input[autocomplete="new-password"]')

    await page.getByRole('button', { name: 'Show passwords' }).click()
    await expect(passwordFields).toHaveCount(2)
    await expect(passwordFields.nth(0)).toHaveAttribute('type', 'text')
    await expect(passwordFields.nth(1)).toHaveAttribute('type', 'text')
  })

  test('blocks registration when password confirmation does not match', async ({ page }) => {
    let registrationRequests = 0

    page.on('request', (request) => {
      registrationRequests += Number(request.url().endsWith('/api/auth/register'))
    })

    await page.goto('/register')
    await page.getByLabel('Email').fill('viewer@example.com')
    await page.getByLabel('Password', { exact: true }).fill(validPassword)
    await page.getByLabel('Confirm password').fill('different password')
    await page.getByRole('button', { name: 'Create account' }).click()

    await expect(page.getByText('Passwords do not match.')).toBeVisible()
    expect(registrationRequests).toBe(0)
  })

  test('accepts registration without creating a session', async ({ page }) => {
    await page.goto('/register?redirectTo=%2F%3Fview%3Drecent')
    await page.getByLabel('Email').fill('  viewer@example.com  ')
    await page.getByLabel('Password', { exact: true }).fill(validPassword)
    await page.getByLabel('Confirm password').fill(validPassword)

    const registrationRequestPromise = page.waitForRequest(`${appBaseUrl}/api/auth/register`)

    await page.getByRole('button', { name: 'Create account' }).click()

    const registrationRequest = await registrationRequestPromise
    const registrationBody: unknown = registrationRequest.postDataJSON()

    expect(registrationRequest.method()).toBe('POST')
    expect(registrationBody).toStrictEqual({
      email: 'viewer@example.com',
      password: validPassword
    })

    await expect(page).toHaveURL(`${appBaseUrl}/sign-in?redirectTo=/?view=recent`)
    await expect(page.getByLabel('Email')).toHaveValue('viewer@example.com')
    await expect(page.getByText('If an account can be created for this email, you can sign in now.')).toBeVisible()

    await page.goto('/')
    await expect(page).toHaveURL(`${appBaseUrl}/sign-in?redirectTo=/`)
  })

  expectedUnavailableErrorTest('shows a safe registration service error', async ({ page }) => {
    await page.goto('/register')

    const emailInput = page.getByLabel('Email')

    await emailInput.fill('registration-unavailable@example.com')
    await expect(emailInput).toHaveValue('registration-unavailable@example.com')
    await page.getByLabel('Password', { exact: true }).fill(validPassword)
    await page.getByLabel('Confirm password').fill(validPassword)
    await page.getByRole('button', { name: 'Create account' }).click()

    const formError = page.getByRole('alert')

    await expect(formError).toHaveText('Authentication is temporarily unavailable.')
    await expect(formError).toBeFocused()
    await expect(page).toHaveURL(`${appBaseUrl}/register`)
  })

  expectedAuthErrorTest('shows safe invalid-credential and unavailable messages', async ({ page }) => {
    await page.goto('/sign-in')
    await fillSignIn(page, 'viewer@example.com', 'wrong password')
    await page.getByRole('button', { name: 'Sign in' }).click()

    const formError = page.getByRole('alert')

    await expect(formError).toHaveText('Invalid email or password.')
    await expect(formError).toBeFocused()

    await page.getByLabel('Email').fill('unavailable@example.com')
    await page.getByLabel('Password', { exact: true }).fill(validPassword)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('alert')).toHaveText('Authentication is temporarily unavailable.')
    await expect(page.getByText(/connection|stack|database/iu)).toHaveCount(0)
  })

})

test.describe('Authenticated session lifecycle', () => {
  test('returns to a safe internal target after sign-in', async ({ page }) => {
    await signIn(page, { target: '/sign-in?redirectTo=%2F%3Fview%3Drecent' })

    await expect(page).toHaveURL(`${appBaseUrl}/?view=recent`)
  })

  const unsafeRedirects = [
    'https%3A%2F%2Fexample.com%2Faccount',
    '%2F%2Fexample.com%2Faccount',
    '%2Fsign-in'
  ] as const

  for (const redirectTo of unsafeRedirects) {
    test(`falls back from unsafe redirect target ${redirectTo}`, async ({ page }) => {
      await signIn(page, { target: `/sign-in?redirectTo=${redirectTo}` })

      await expect(page).toHaveURL(`${appBaseUrl}/`)
    })
  }

  test('restores the signed-in user from the HttpOnly cookie during SSR', async ({ page }) => {
    await signIn(page)
    await page.reload()

    await expect(page).toHaveURL(`${appBaseUrl}/`)
    await expect(page.getByText('viewer@example.com')).toBeVisible()
  })

  test('revalidates the session before a client-side guest guard decision', async ({ context, page }) => {
    await signIn(page)

    const secondPage = await context.newPage()

    await secondPage.goto('/')
    await secondPage.getByRole('button', { name: 'Sign out' }).click()
    await expect(secondPage).toHaveURL(`${appBaseUrl}/sign-in`)

    await navigateWithClientRouter(page, '/sign-in')
    await expect(page).toHaveURL(`${appBaseUrl}/sign-in`)

    await secondPage.close()
  })

  test('keeps a valid long email inside the mobile viewport', async ({ page }) => {
    await page.setViewportSize({ height: 720, width: 320 })
    await signIn(page, { email: longEmail })

    await expect(page.getByText(longEmail)).toBeVisible()

    const viewportOverflow = await page.evaluate(() => (
      globalThis.document.documentElement.scrollWidth - globalThis.innerWidth
    ))

    expect(viewportOverflow).toBeLessThanOrEqual(0)
  })

  expectedUnavailableErrorTest('moves focus to authenticated content after session retry succeeds', async ({ context, page }) => {
    await addRecoverableSessionCookies(context)
    await page.goto('/')

    await expect(page.getByRole('heading', { name: 'We couldn’t verify your session.' })).toBeVisible()
    await page.getByRole('button', { name: 'Try again' }).click()

    const heading = page.getByRole('heading', { name: 'Your catalog starts here.' })

    await expect(heading).toBeVisible()
    await expect(heading).toBeFocused()
  })

  test('signs out, clears the cookie, and protects the page after reload', async ({ page }) => {
    await signIn(page)
    await page.getByRole('button', { name: 'Sign out' }).click()

    await expect(page).toHaveURL(`${appBaseUrl}/sign-in`)
    await expect(page).toHaveTitle('Sign in · TV')
    await page.goto('/')
    await expect(page).toHaveURL(`${appBaseUrl}/sign-in?redirectTo=/`)
  })

  expectedUnavailableErrorTest('keeps the user signed in when sign-out fails and allows retry', async ({ context, page }) => {
    await signIn(page)
    await addFailedSignOutCookie(context)
    await page.getByRole('button', { name: 'Sign out' }).click()

    await expect(page.getByRole('alert')).toHaveText('We couldn’t sign you out. Try again.')
    await expect(page.getByText('viewer@example.com')).toBeVisible()

    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page).toHaveURL(`${appBaseUrl}/sign-in`)
  })
})
