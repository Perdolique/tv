import { appBaseUrl } from '../constants.ts'
import { expect, test } from '../fixtures/global.fixtures.ts'
import { navigateWithClientRouter, waitForHydration } from '../catalog/helpers.ts'

const verificationToken = 'v'.repeat(43)
const verificationFragment = `token=${verificationToken}`
const returnTarget = '/titles/example?view=all'
const registrationPath = `/register?redirectTo=%2Ftitles%2Fexample%3Fview%3Dall&discard=1#${verificationFragment}`
const signInLocation = `${appBaseUrl}/sign-in?redirectTo=/titles/example?view=all#`

test.describe('Disabled registration', () => {
  test('hides account-creation links in the public catalog', async ({ page }) => {
    await page.goto('/')
    await waitForHydration(page)
    await expect(page.getByRole('link', { name: 'Create an account' })).toHaveCount(0)

    await expect(page.getByRole('link', {
      name: 'Sign in',
      exact: true
    })).toBeVisible()
  })

  test('keeps sign-in available without account-creation links', async ({ page }) => {
    await page.goto('/sign-in')
    await waitForHydration(page)

    await expect(page.getByRole('heading', {
      name: 'Welcome back',
      exact: true
    })).toBeVisible()

    await expect(page.getByRole('link', { name: 'Create an account' })).toHaveCount(0)
    await expect(page.getByLabel('Email')).toBeVisible()
  })

  test('clears native verification fragments and preserves a safe return target', async ({ page, request }) => {
    const response = await request.get(registrationPath, {
      maxRedirects: 0,
      headers: { 'X-Forwarded-Host': 'outside.example' }
    })

    const status = response.status()
    const headers = response.headers()

    expect(status).toBe(302)
    expect(headers.location).toBe(signInLocation)
    await page.goto(registrationPath)
    await waitForHydration(page)

    const pageUrl = page.url()
    const location = new URL(pageUrl)
    const redirectTo = location.searchParams.get('redirectTo')
    const hasDiscardedQuery = location.searchParams.has('discard')

    expect(location.pathname).toBe('/sign-in')
    expect(location.hash).toBe('')
    expect(redirectTo).toBe(returnTarget)
    expect(pageUrl).not.toContain(verificationToken)
    expect(hasDiscardedQuery).toBe(false)
  })

  test('redirects client registration navigation to sign-in without a token', async ({ page }) => {
    await page.goto('/')
    await waitForHydration(page)
    await navigateWithClientRouter(page, registrationPath)

    const pageUrl = page.url()
    const location = new URL(pageUrl)
    const redirectTo = location.searchParams.get('redirectTo')

    expect(location.pathname).toBe('/sign-in')
    expect(location.hash).toBe('')
    expect(redirectTo).toBe(returnTarget)
    expect(pageUrl).not.toContain(verificationToken)
  })

  test('clears native verification fragments before authenticated guest redirects', async ({ context, page }) => {
    await context.addCookies([{
      httpOnly: true,
      name: 'tv_session',
      url: appBaseUrl,
      value: 'e2e-session'
    }])

    const path = `/register?redirectTo=%2F%3Fview%3Drecent#${verificationFragment}`

    await page.goto(path)
    await waitForHydration(page)

    const pageUrl = page.url()
    const location = new URL(pageUrl)
    const view = location.searchParams.get('view')

    expect(location.pathname).toBe('/')
    expect(location.hash).toBe('')
    expect(view).toBe('recent')
    expect(pageUrl).not.toContain(verificationToken)
    await expect(page.getByText('viewer@example.com')).toBeVisible()
  })

  test.describe('Without JavaScript', () => {
    test.use({ javaScriptEnabled: false })

    const fragmentCases = [
      {
        label: 'valid token',
        fragment: verificationFragment
      },
      {
        label: 'malformed duplicate token',
        fragment: 'token=%ZZ&token=second'
      }
    ]

    for (const { label, fragment } of fragmentCases) {
      const testName = `clears the native registration fragment for ${label}`

      test(testName, async ({ page }) => {
        const path = `/register?redirectTo=https%3A%2F%2Foutside.example#${fragment}`

        await page.goto(path)

        const pageUrl = page.url()
        const location = new URL(pageUrl)
        const redirectTo = location.searchParams.get('redirectTo')

        expect(location.pathname).toBe('/sign-in')
        expect(location.hash).toBe('')
        expect(redirectTo).toBe('/')
        expect(pageUrl).not.toContain(fragment)

        await expect(page.getByRole('heading', {
          name: 'Welcome back',
          exact: true
        })).toBeVisible()
      })
    }
  })
})
