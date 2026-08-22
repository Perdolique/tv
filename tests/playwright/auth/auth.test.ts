/* oxlint-disable eslint/max-lines -- The auth browser contract stays readable as one lifecycle specification. */
import type { BrowserContext, Page } from '@playwright/test'
import { appBaseUrl } from '../constants.ts'
import { expect, test } from '../fixtures/global.fixtures.ts'
import { longEmail } from './constants.ts'

const validPassword = 'correct horse battery staple'

const registrationUnavailableError = {
  pathname: '/api/auth/register',
  status: 503
}

const registrationValidationError = {
  pathname: '/api/auth/register',
  status: 400
}

const invalidCredentialsError = {
  pathname: '/api/auth/sign-in',
  status: 401
}

const signInUnavailableError = {
  pathname: '/api/auth/sign-in',
  status: 503
}

const sessionUnavailableError = {
  pathname: '/api/auth/session',
  status: 503
}

const signOutUnavailableError = {
  pathname: '/api/auth/sign-out',
  status: 503
}

const expectedRegistrationUnavailableTest = test.extend({
  expectedHttpErrors: { values: [registrationUnavailableError] }
})

const expectedRegistrationValidationTest = test.extend({
  expectedHttpErrors: { values: [registrationValidationError] }
})

const expectedSignInErrorsTest = test.extend({
  expectedHttpErrors: {
    values: [
      invalidCredentialsError,
      signInUnavailableError
    ]
  }
})

const expectedSessionUnavailableTest = test.extend({
  expectedHttpErrors: { values: [sessionUnavailableError] }
})

const expectedRepeatedSessionUnavailableTest = test.extend({
  expectedHttpErrors: {
    values: [
      sessionUnavailableError,
      sessionUnavailableError
    ]
  }
})

const expectedSignOutUnavailableTest = test.extend({
  expectedHttpErrors: { values: [signOutUnavailableError] }
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

  const signInResponsePromise = page.waitForResponse((response) => (
    response.url() === `${appBaseUrl}/api/auth/sign-in`
  ))

  await page.getByRole('button', { name: 'Sign in' }).click()

  const signInResponse = await signInResponsePromise

  expect(signInResponse.status()).toBe(200)
  expect(signInResponse.headers()['cache-control']).toBe('no-store')
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

async function addRecoverableSessionCookies(
  context: BrowserContext,
  options: { authenticated?: boolean; failures?: 1 | 2; } = {}
): Promise<void> {
  const cookies = [{
    name: 'fail_session',
    url: appBaseUrl,
    value: String(options.failures ?? 1)
  }]

  if (options.authenticated !== false) {
    cookies.push({
      name: 'tv_session',
      url: appBaseUrl,
      value: 'e2e-session'
    })
  }

  await context.addCookies(cookies)
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
  test('sets a distinct title after client-side guest navigation', async ({ page }) => {
    await page.goto('/sign-in')
    await page.getByRole('link', { name: 'Create an account' }).click()

    await expect(page).toHaveURL(`${appBaseUrl}/register?redirectTo=/`)
    await expect(page).toHaveTitle('Create account · TV')
  })

  test.describe('without JavaScript', () => {
    test.use({ javaScriptEnabled: false })

    test('redirects an anonymous SSR request for the protected page', async ({ page }) => {
      await page.goto('/')

      await expect(page).toHaveURL(`${appBaseUrl}/sign-in?redirectTo=/`)
      await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
      await expect(page).toHaveTitle('Sign in · TV')
    })

    test('renders an authenticated protected page from an HttpOnly cookie', async ({ context, page }) => {
      await context.addCookies([{
        httpOnly: true,
        name: 'tv_session',
        url: appBaseUrl,
        value: 'e2e-session'
      }])

      const response = await page.goto('/')

      expect(response).not.toBeNull()
      expect(response?.headers()['cache-control']).toBe('private, no-store')
      await expect(page).toHaveURL(`${appBaseUrl}/`)
      await expect(page.getByText('viewer@example.com')).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Your catalog starts here.' })).toBeVisible()
    })

    test('renders both guest forms on the server', async ({ page }) => {
      await page.goto('/sign-in')
      await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
      await expect(page.getByLabel('Email')).toBeVisible()
      await expect(page.getByLabel('Password', { exact: true })).toBeVisible()
      await expect(page.getByText('TV', { exact: true })).toHaveCount(0)
      await expect(page.getByText('Sign in to search and save your TV catalog.')).toHaveCount(0)

      await page.goto('/register')
      await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible()
      await expect(page.locator('input[autocomplete="new-password"]')).toHaveCount(1)
      await expect(page.getByText('TV', { exact: true })).toHaveCount(0)
      await expect(page.getByText('Create an account to start building your TV experience.')).toHaveCount(0)
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

    const signInPassword = page.getByLabel('Password', { exact: true })

    await expect(signInPassword).toHaveAttribute('type', 'password')

    await page.getByRole('button', { name: 'Show password' }).click()
    await expect(signInPassword).toHaveAttribute('type', 'text')
    await expect(page.getByRole('button', { name: 'Hide password' })).toBeVisible()

    await page.goto('/register')

    const registrationPassword = page.getByLabel('Password', { exact: true })

    await page.getByRole('button', { name: 'Show password' }).click()
    await expect(registrationPassword).toHaveAttribute('type', 'text')
    await expect(page.getByRole('button', { name: 'Hide password' })).toBeVisible()
  })

  test('validates the email before submitting credentials', async ({ page }) => {
    let signInRequestCount = 0

    await page.route(`${appBaseUrl}/api/auth/sign-in`, async (route) => {
      signInRequestCount += 1
      await route.continue()
    })

    await page.goto('/sign-in')

    const emailInput = page.getByLabel('Email')

    await emailInput.fill('person@example.c')
    await page.getByLabel('Password', { exact: true }).fill(validPassword)
    await page.getByRole('button', { name: 'Sign in' }).click()

    await expect(page.getByText('Enter a valid email address.')).toBeVisible()
    await expect(emailInput).toBeFocused()
    expect(signInRequestCount).toBe(0)
  })

  test('accepts registration without creating a session', async ({ page }) => {
    await page.goto('/register?redirectTo=%2F%3Fview%3Drecent')
    await page.getByLabel('Email').fill('  viewer@example.com  ')
    await page.getByLabel('Password', { exact: true }).fill(validPassword)

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

  expectedRegistrationUnavailableTest('shows a safe registration service error', async ({ page }) => {
    await page.goto('/register')

    const emailInput = page.getByLabel('Email')

    await emailInput.fill('registration-unavailable@example.com')
    await expect(emailInput).toHaveValue('registration-unavailable@example.com')
    await page.getByLabel('Password', { exact: true }).fill(validPassword)
    await page.getByRole('button', { name: 'Create account' }).click()

    const formError = page.getByRole('alert')

    await expect(formError).toHaveText('Authentication is temporarily unavailable.')
    await expect(formError).toBeFocused()
    await expect(page).toHaveURL(`${appBaseUrl}/register`)
  })

  expectedRegistrationValidationTest('shows a compromised-password field error', async ({ page }) => {
    await page.goto('/register')
    await page.getByLabel('Email').fill('compromised@example.com')
    await page.getByLabel('Password', { exact: true }).fill(validPassword)
    await page.getByRole('button', { name: 'Create account' }).click()

    const passwordInput = page.getByLabel('Password', { exact: true })

    await expect(page.getByRole('alert')).toHaveText(
      'Choose a password that has not appeared in a known data breach.'
    )
    await expect(passwordInput).toHaveAttribute('aria-invalid', 'true')
    await expect(passwordInput).toHaveAccessibleDescription(
      'Use between 15 and 128 characters. Choose a password that has not appeared in a known data breach.'
    )
    await expect(passwordInput).toBeFocused()
  })

  expectedSignInErrorsTest('shows safe invalid-credential and unavailable messages', async ({ page }) => {
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

  test('keeps the signed-in user after a full-page reload', async ({ page }) => {
    await signIn(page)

    const response = await page.reload()

    expect(response).not.toBeNull()
    expect(response?.headers()['cache-control']).toBe('private, no-store')

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

  test('revalidates the session before a client-side protected guard decision', async ({ context, page }) => {
    await signIn(page)

    const secondPage = await context.newPage()

    await secondPage.goto('/')
    await secondPage.getByRole('button', { name: 'Sign out' }).click()
    await expect(secondPage).toHaveURL(`${appBaseUrl}/sign-in`)

    await navigateWithClientRouter(page, '/?view=recent')

    const redirectedUrl = new URL(page.url())

    expect(redirectedUrl.pathname).toBe('/sign-in')
    expect(redirectedUrl.searchParams.get('redirectTo')).toBe('/?view=recent')

    await secondPage.close()
  })

  test('keeps a valid long email inside the mobile viewport', async ({ page }) => {
    await page.setViewportSize({
      height: 720,
      width: 320
    })
    await signIn(page, { email: longEmail })

    await expect(page.getByText(longEmail)).toBeVisible()

    const viewportOverflow = await page.evaluate(() => (
      globalThis.document.documentElement.scrollWidth - globalThis.innerWidth
    ))

    expect(viewportOverflow).toBeLessThanOrEqual(0)
  })

  expectedSessionUnavailableTest('moves focus to authenticated content after session retry succeeds', async ({ context, page }) => {
    await addRecoverableSessionCookies(context)
    await page.goto('/')

    await expect(page.getByRole('heading', { name: 'We couldn’t verify your session.' })).toBeVisible()
    await page.getByRole('button', { name: 'Try again' }).click()

    const heading = page.getByRole('heading', { name: 'Your catalog starts here.' })

    await expect(heading).toBeVisible()
    await expect(heading).toBeFocused()
  })

  expectedSessionUnavailableTest('redirects an anonymous user after session retry succeeds', async ({ context, page }) => {
    await addRecoverableSessionCookies(context, { authenticated: false })
    await page.goto('/')

    await expect(page.getByRole('heading', { name: 'We couldn’t verify your session.' })).toBeVisible()
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect(page).toHaveURL(`${appBaseUrl}/sign-in?redirectTo=/`)

    const redirectedUrl = new URL(page.url())

    expect(redirectedUrl.pathname).toBe('/sign-in')
    expect(redirectedUrl.searchParams.get('redirectTo')).toBe('/')
  })

  expectedRepeatedSessionUnavailableTest('returns focus to retry after another session failure', async ({ context, page }) => {
    await addRecoverableSessionCookies(context, { failures: 2 })
    await page.goto('/')

    const retryButton = page.getByRole('button', { name: 'Try again' })

    await retryButton.click()
    await expect(retryButton).toBeFocused()

    await retryButton.click()
    await expect(page.getByRole('heading', { name: 'Your catalog starts here.' })).toBeFocused()
  })

  expectedSessionUnavailableTest('does not retain a registration notice after an authenticated redirect', async ({ context, page }) => {
    await signIn(page)
    await addRecoverableSessionCookies(context)
    await page.goto('/register')

    await page.getByLabel('Email').fill('new-viewer@example.com')
    await page.getByLabel('Password', { exact: true }).fill(validPassword)
    await page.getByRole('button', { name: 'Create account' }).click()
    await expect(page).toHaveURL(`${appBaseUrl}/`)

    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page).toHaveURL(`${appBaseUrl}/sign-in`)
    await expect(page.getByText('If an account can be created for this email, you can sign in now.')).toHaveCount(0)
    await expect(page.getByLabel('Email')).toHaveValue('')
  })

  test('signs out, clears the cookie, and protects the page after reload', async ({ page }) => {
    await signIn(page)
    await page.getByRole('button', { name: 'Sign out' }).click()

    await expect(page).toHaveURL(`${appBaseUrl}/sign-in`)
    await expect(page).toHaveTitle('Sign in · TV')
    await page.goto('/')
    await expect(page).toHaveURL(`${appBaseUrl}/sign-in?redirectTo=/`)
  })

  expectedSignOutUnavailableTest('keeps the user signed in when sign-out fails and allows retry', async ({ context, page }) => {
    await signIn(page)
    await addFailedSignOutCookie(context)
    await page.getByRole('button', { name: 'Sign out' }).click()

    await expect(page.getByRole('alert')).toHaveText('We couldn’t sign you out. Try again.')
    await expect(page.getByText('viewer@example.com')).toBeVisible()

    const signOutButton = page.getByRole('button', { name: 'Sign out' })

    await expect(signOutButton).toBeFocused()

    await signOutButton.click()
    await expect(page).toHaveURL(`${appBaseUrl}/sign-in`)
  })
})
