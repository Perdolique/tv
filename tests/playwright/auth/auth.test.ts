/* oxlint-disable eslint/max-lines -- The auth browser contract stays readable as one lifecycle specification. */
import type { BrowserContext, Page, Route } from '@playwright/test'
import { TURNSTILE_RESPONSE_FIELD } from '../../../packages/shared/src/turnstile.ts'
import { isRecord } from '../../../packages/shared/src/type-guards.ts'
import { appBaseUrl } from '../constants.ts'
import { expect, test } from '../fixtures/global.fixtures.ts'
import { longEmail } from './constants.ts'

const validPassword = 'correct horse battery staple'
const validVerificationToken = 'v'.repeat(43)
const expiredVerificationToken = 'e'.repeat(43)
const compromisedVerificationToken = 'c'.repeat(43)
const unavailableVerificationToken = 'u'.repeat(43)

const registrationUnavailableError = {
  pathname: '/api/auth/register',
  status: 503
}

const registrationValidationError = {
  pathname: '/api/auth/register/complete',
  status: 400
}

const invalidVerificationError = {
  pathname: '/api/auth/register/complete',
  status: 400
}

const registrationCompletionUnavailableError = {
  pathname: '/api/auth/register/complete',
  status: 503
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

const expectedInvalidVerificationTest = test.extend({
  expectedHttpErrors: { values: [invalidVerificationError] }
})

const expectedRegistrationCompletionUnavailableTest = test.extend({
  expectedHttpErrors: { values: [registrationCompletionUnavailableError] }
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

interface PausedRequest {
  readonly count: number;
  release: () => Promise<void>;
}

function readTurnstileToken(value: unknown): string {
  if (!isRecord(value) || typeof value[TURNSTILE_RESPONSE_FIELD] !== 'string') {
    throw new Error('Expected a Turnstile token in the auth request')
  }

  return value[TURNSTILE_RESPONSE_FIELD]
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

  const signInRequestPromise = page.waitForRequest((request) => (
    request.url() === `${appBaseUrl}/api/auth/sign-in`
  ))

  await page.getByRole('button', { name: 'Sign in' }).click()

  const signInResponse = await signInResponsePromise
  const signInRequest = await signInRequestPromise
  const signInBody: unknown = signInRequest.postDataJSON()
  const turnstileToken = readTurnstileToken(signInBody)

  expect(signInBody).toStrictEqual({
    [TURNSTILE_RESPONSE_FIELD]: turnstileToken,
    email: options.email ?? 'viewer@example.com',
    password: validPassword
  })

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

async function pauseFirstRequest(page: Page, url: string): Promise<PausedRequest> {
  let firstRoute: Route | null = null
  let requestCount = 0

  await page.route(url, async (route) => {
    requestCount += 1

    if (firstRoute === null) {
      firstRoute = route

      return
    }

    await route.continue()
  })

  return {
    get count() {
      return requestCount
    },

    async release() {
      if (firstRoute === null) {
        throw new Error('Expected a paused request')
      }

      try {
        await firstRoute.continue()
      } catch {
        // The application may have already aborted the obsolete request.
      }
    }
  }
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

    test('renders the public home for an anonymous SSR request', async ({ page }) => {
      await page.goto('/')

      await expect(page).toHaveURL(`${appBaseUrl}/`)
      await expect(page.getByRole('heading', { name: 'TV' })).toBeVisible()
      await expect(page.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/sign-in')
      await expect(page.getByRole('link', { name: 'Create an account' })).toHaveAttribute('href', '/register')
      await expect(page).toHaveTitle('TV')
    })

    test('preserves a deep public target in guest links', async ({ page }) => {
      await page.goto('/?view=recent')

      await expect(page.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
        'href',
        '/sign-in?redirectTo=/?view=recent'
      )

      await expect(page.getByRole('link', { name: 'Create an account' })).toHaveAttribute(
        'href',
        '/register?redirectTo=/?view=recent'
      )
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
      await expect(page.getByRole('link', { name: 'TV home' })).toBeVisible()
      await expect(page.getByText('Sign in to track every story.')).toBeVisible()

      await page.goto('/register')
      await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible()
      await expect(page.getByLabel('Email')).toBeVisible()
      await expect(page.locator('input[autocomplete="new-password"]')).toHaveCount(0)
      await expect(page.getByRole('link', { name: 'TV home' })).toBeVisible()
      await expect(page.getByText('Build your watchlist in a minute.')).toBeVisible()
    })
  })

  test('redirects authenticated users away from guest pages', async ({ page }) => {
    await signIn(page)

    await page.goto('/sign-in')
    await expect(page).toHaveURL(`${appBaseUrl}/`)

    await page.goto(`/register#token=${validVerificationToken}`)
    await expect(page).toHaveURL(`${appBaseUrl}/`)
  })
})

test.describe('Authentication forms', () => {
  test('blocks repeated registration submissions while the request is pending', async ({ page }) => {
    const pendingRequest = await pauseFirstRequest(
      page,
      `${appBaseUrl}/api/auth/register`
    )

    await page.goto('/register')
    await page.getByLabel('Email').fill('viewer@example.com')

    const submitButton = page.getByRole('button', {
      name: 'Email me a verification link'
    })

    await expect(submitButton).toBeEnabled()
    await submitButton.click()
    await expect.poll(() => pendingRequest.count).toBe(1)
    await expect(submitButton).toBeDisabled()

    await submitButton.evaluate((button: HTMLButtonElement) => {
      button.click()
    })

    await page.waitForTimeout(50)
    expect(pendingRequest.count).toBe(1)

    await pendingRequest.release()
    await expect(page.getByText(/Check your email for the next step/u)).toBeVisible()
  })

  test('cancels an obsolete sign-in before a newer account can be overwritten', async ({ page }) => {
    const pendingRequest = await pauseFirstRequest(
      page,
      `${appBaseUrl}/api/auth/sign-in`
    )

    await page.goto('/sign-in')
    await fillSignIn(page, longEmail)

    const firstSubmitButton = page.getByRole('button', { name: 'Sign in' })

    await firstSubmitButton.click()
    await expect.poll(() => pendingRequest.count).toBe(1)
    await expect(firstSubmitButton).toBeDisabled()
    await page.getByRole('link', { name: 'TV home' }).click()
    await expect(page).toHaveURL(`${appBaseUrl}/`)

    await page.getByRole('link', { name: 'Sign in' }).click()
    await fillSignIn(page)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect.poll(() => pendingRequest.count).toBe(2)
    await expect(page.getByText('viewer@example.com')).toBeVisible()

    await pendingRequest.release()
    await page.waitForTimeout(100)
    await page.reload()

    await expect(page.getByText('viewer@example.com')).toBeVisible()
    await expect(page.getByText(longEmail)).toHaveCount(0)
  })

  test('toggles password visibility with an accessible name', async ({ page }) => {
    await page.goto('/sign-in')

    const signInPassword = page.getByLabel('Password', { exact: true })
    const showPasswordButton = page.getByRole('button', { name: 'Show password' })
    const shownIcon = showPasswordButton.locator('svg')

    await expect(signInPassword).toHaveAttribute('type', 'password')
    await expect(shownIcon).toHaveAttribute('viewBox', '0 0 24 24')
    expect(await shownIcon.locator('path').count()).toBeGreaterThan(0)

    const buttonBoundsBeforeToggle = await showPasswordButton.boundingBox()
    const iconBoundsBeforeToggle = await shownIcon.boundingBox()

    await showPasswordButton.click()

    const hidePasswordButton = page.getByRole('button', { name: 'Hide password' })
    const hiddenIcon = hidePasswordButton.locator('svg')

    await expect(signInPassword).toHaveAttribute('type', 'text')
    await expect(hiddenIcon).toHaveAttribute('viewBox', '0 0 24 24')
    expect(await hiddenIcon.locator('path').count()).toBeGreaterThan(0)
    expect(await hidePasswordButton.boundingBox()).toStrictEqual(buttonBoundsBeforeToggle)
    expect(await hiddenIcon.boundingBox()).toStrictEqual(iconBoundsBeforeToggle)

    await page.goto(`/register#token=${validVerificationToken}`)

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
    await expect(emailInput).toHaveAttribute('aria-invalid', 'true')
    await expect(emailInput).toHaveAccessibleDescription('Enter a valid email address.')
    await expect(emailInput).toHaveCSS('outline-offset', '2px')
    await expect(emailInput).toHaveCSS('outline-width', '2px')
    expect(signInRequestCount).toBe(0)
  })

  test('exposes an accessible registration email error before requesting verification', async ({ page }) => {
    let registrationRequestCount = 0

    await page.route(`${appBaseUrl}/api/auth/register`, async (route) => {
      registrationRequestCount += 1
      await route.continue()
    })

    await page.goto('/register')

    const emailInput = page.getByLabel('Email')

    await emailInput.fill('person@example.c')
    await page.getByRole('button', { name: 'Email me a verification link' }).click()

    await expect(page.getByText('Enter a valid email address.')).toBeVisible()
    await expect(emailInput).toBeFocused()
    await expect(emailInput).toHaveAttribute('aria-invalid', 'true')
    await expect(emailInput).toHaveAccessibleDescription('Enter a valid email address.')
    expect(registrationRequestCount).toBe(0)
  })

  test('verifies email, creates an account, and returns through ordinary sign-in', async ({ page }) => {
    await page.goto('/register?redirectTo=%2F%3Fview%3Drecent')
    await page.getByLabel('Email').fill('  viewer@example.com  ')

    const registrationRequestPromise = page.waitForRequest(`${appBaseUrl}/api/auth/register`)

    await page.getByRole('button', { name: 'Email me a verification link' }).click()

    const registrationRequest = await registrationRequestPromise
    const registrationBody: unknown = registrationRequest.postDataJSON()
    const turnstileToken = readTurnstileToken(registrationBody)

    expect(registrationRequest.method()).toBe('POST')
    expect(registrationBody).toStrictEqual({
      [TURNSTILE_RESPONSE_FIELD]: turnstileToken,
      email: 'viewer@example.com',
      redirectTo: '/?view=recent'
    })

    await expect(page.getByText(/Check your email for the next step/u)).toBeVisible()
    await expect(page).toHaveURL(`${appBaseUrl}/register?redirectTo=/?view=recent`)

    await page.goto(`/register?redirectTo=%2F%3Fview%3Drecent#token=${validVerificationToken}`)
    await expect(page.getByRole('heading', { name: 'Choose your password' })).toBeVisible()
    await expect(page).toHaveURL(`${appBaseUrl}/register?redirectTo=/?view=recent`)
    await expect(page.getByLabel('Password', { exact: true })).toBeFocused()
    await page.getByLabel('Password', { exact: true }).fill(validPassword)

    const completionRequestPromise = page.waitForRequest(
      `${appBaseUrl}/api/auth/register/complete`
    )

    await page.getByRole('button', { name: 'Create account' }).click()

    const completionRequest = await completionRequestPromise
    const completionBody: unknown = completionRequest.postDataJSON()

    expect(completionBody).toStrictEqual({
      password: validPassword,
      token: validVerificationToken
    })

    await expect(page).toHaveURL(`${appBaseUrl}/sign-in?redirectTo=/?view=recent`)
    await expect(page.getByLabel('Email')).toHaveValue('viewer@example.com')
    await expect(page.getByText('Account created. Sign in to continue.')).toBeVisible()

    const sessionCookies = await page.context().cookies()

    expect(sessionCookies.some(cookie => cookie.name === 'tv_session')).toBe(false)

    await fillSignIn(page)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page).toHaveURL(`${appBaseUrl}/?view=recent`)
  })

  test('returns focus to the email field when choosing a different address', async ({ page }) => {
    await page.goto('/register')
    await page.getByLabel('Email').fill('viewer@example.com')
    await page.getByRole('button', { name: 'Email me a verification link' }).click()
    await page.getByRole('button', { name: 'Use a different email' }).click()

    await expect(page.getByLabel('Email')).toBeFocused()
    await expect(page.getByLabel('Email')).toHaveValue('viewer@example.com')
  })

  test('replaces a malformed fragment with a fresh link in the same tab', async ({ page }) => {
    await page.goto('/register#token=short')

    const invalidAlert = page.getByRole('alert')

    await expect(page).toHaveURL(`${appBaseUrl}/register`)
    await expect(invalidAlert).toHaveText('This verification link is invalid or has expired.')
    await expect(invalidAlert).toBeFocused()
    await expect(page.getByLabel('Email')).toHaveCount(0)
    await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0)

    await navigateWithClientRouter(page, `/register#token=${validVerificationToken}`)

    const passwordInput = page.getByLabel('Password', { exact: true })

    await expect(page).toHaveURL(`${appBaseUrl}/register`)
    await expect(page.getByRole('heading', { name: 'Choose your password' })).toBeVisible()
    await expect(passwordInput).toBeFocused()

    const completionRequestPromise = page.waitForRequest(
      `${appBaseUrl}/api/auth/register/complete`
    )

    await passwordInput.fill(validPassword)
    await page.getByRole('button', { name: 'Create account' }).click()

    const completionRequest = await completionRequestPromise
    const completionBody: unknown = completionRequest.postDataJSON()

    expect(completionBody).toStrictEqual({
      password: validPassword,
      token: validVerificationToken
    })
  })

  expectedRegistrationUnavailableTest('shows a safe registration service error', async ({ page }) => {
    const turnstileTokens: string[] = []

    page.on('request', (request) => {
      if (request.url() === `${appBaseUrl}/api/auth/register`) {
        const body: unknown = request.postDataJSON()

        turnstileTokens.push(readTurnstileToken(body))
      }
    })

    await page.goto('/register')

    const emailInput = page.getByLabel('Email')

    await emailInput.fill('registration-unavailable@example.com')
    await expect(emailInput).toHaveValue('registration-unavailable@example.com')
    await page.getByRole('button', { name: 'Email me a verification link' }).click()

    const formError = page.getByRole('alert')

    await expect(formError).toHaveText('Authentication is temporarily unavailable.')
    await expect(formError).toBeFocused()
    await expect(page).toHaveURL(`${appBaseUrl}/register`)

    await emailInput.fill('viewer@example.com')
    await page.getByRole('button', { name: 'Email me a verification link' }).click()
    await expect(page.getByText(/Check your email for the next step/u)).toBeVisible()

    expect(turnstileTokens).toHaveLength(2)
    expect(turnstileTokens[1]).not.toBe(turnstileTokens[0])
  })

  expectedRegistrationValidationTest('shows a compromised-password field error', async ({ page }) => {
    await page.goto(`/register#token=${compromisedVerificationToken}`)
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
    await expect(page).toHaveURL(`${appBaseUrl}/register`)
  })

  expectedInvalidVerificationTest('focuses an expired-link alert and offers a restart', async ({ page }) => {
    await page.goto(`/register?redirectTo=%2F%3Fview%3Drecent#token=${expiredVerificationToken}`)
    await page.getByLabel('Password', { exact: true }).fill(validPassword)
    await page.getByRole('button', { name: 'Create account' }).click()

    const alert = page.getByRole('alert')

    await expect(alert).toHaveText('This verification link is invalid or has expired.')
    await expect(alert).toBeFocused()

    const restartLink = page.getByRole('link', { name: 'Start registration again' })

    await expect(restartLink).toBeVisible()
    await restartLink.click()
    await expect(page.getByRole('alert')).toHaveCount(0)
    await expect(page.getByLabel('Email')).toBeFocused()
    await expect(page).toHaveURL(`${appBaseUrl}/register?redirectTo=/?view=recent`)
  })

  expectedRegistrationCompletionUnavailableTest('shows a safe activation service error', async ({ page }) => {
    await page.goto(`/register#token=${unavailableVerificationToken}`)
    await page.getByLabel('Password', { exact: true }).fill(validPassword)
    await page.getByRole('button', { name: 'Create account' }).click()

    const alert = page.getByRole('alert')

    await expect(alert).toHaveText('Authentication is temporarily unavailable.')
    await expect(alert).toBeFocused()
    await expect(page.getByText(/connection|stack|database/iu)).toHaveCount(0)
    await expect(page).toHaveURL(`${appBaseUrl}/register`)
  })

  expectedSignInErrorsTest('shows safe invalid-credential and unavailable messages', async ({ page }) => {
    const turnstileTokens: string[] = []

    page.on('request', (request) => {
      if (request.url() === `${appBaseUrl}/api/auth/sign-in`) {
        const body: unknown = request.postDataJSON()

        turnstileTokens.push(readTurnstileToken(body))
      }
    })

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

    expect(turnstileTokens).toHaveLength(2)
    expect(turnstileTokens[1]).not.toBe(turnstileTokens[0])
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
    await expect(secondPage).toHaveURL(`${appBaseUrl}/`)
    await expect(secondPage.getByRole('heading', { name: 'TV' })).toBeFocused()

    await navigateWithClientRouter(page, '/sign-in')
    await expect(page).toHaveURL(`${appBaseUrl}/sign-in`)

    await secondPage.close()
  })

  test('revalidates the session before rendering the public home after client navigation', async ({ context, page }) => {
    await signIn(page)

    const secondPage = await context.newPage()

    await secondPage.goto('/')
    await secondPage.getByRole('button', { name: 'Sign out' }).click()
    await expect(secondPage).toHaveURL(`${appBaseUrl}/`)
    await expect(secondPage.getByRole('heading', { name: 'TV' })).toBeFocused()

    let sessionRequestCount = 0

    await page.route(`${appBaseUrl}/api/auth/session`, async (route) => {
      sessionRequestCount += 1
      await route.continue()
    })

    await navigateWithClientRouter(page, '/?view=recent')
    await expect(page).toHaveURL(`${appBaseUrl}/?view=recent`)
    await expect(page.getByRole('heading', { name: 'TV' })).toBeVisible()
    expect(sessionRequestCount).toBe(1)

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

  expectedSessionUnavailableTest('focuses the public home after an anonymous session retry succeeds', async ({ context, page }) => {
    await addRecoverableSessionCookies(context, { authenticated: false })
    await page.goto('/')

    await expect(page.getByRole('heading', { name: 'We couldn’t verify your session.' })).toBeVisible()
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect(page).toHaveURL(`${appBaseUrl}/`)
    await expect(page.getByRole('heading', { name: 'TV' })).toBeFocused()
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
    await page.goto(`/register#token=${validVerificationToken}`)
    await page.getByLabel('Password', { exact: true }).fill(validPassword)
    await page.getByRole('button', { name: 'Create account' }).click()
    await expect(page).toHaveURL(`${appBaseUrl}/?view=recent`)

    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page).toHaveURL(`${appBaseUrl}/?view=recent`)

    await expect.poll(async () => {
      const sessionCookies = await context.cookies()

      return sessionCookies.some(cookie => cookie.name === 'tv_session')
    }).toBe(false)

    await page.goto('/sign-in')
    await expect(page).toHaveURL(`${appBaseUrl}/sign-in`)
    await expect(page.getByText('Account created. Sign in to continue.')).toHaveCount(0)
    await expect(page.getByLabel('Email')).toHaveValue('')
  })

  test('signs out, clears the cookie, and keeps the public home after reload', async ({ page }) => {
    await signIn(page)
    await page.getByRole('button', { name: 'Sign out' }).click()

    await expect(page).toHaveURL(`${appBaseUrl}/`)
    await expect(page).toHaveTitle('TV')
    await expect(page.getByRole('heading', { name: 'TV' })).toBeFocused()
    await page.reload()
    await expect(page).toHaveURL(`${appBaseUrl}/`)
    await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible()
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
    await expect(page).toHaveURL(`${appBaseUrl}/`)
    await expect(page.getByRole('heading', { name: 'TV' })).toBeFocused()
  })
})
