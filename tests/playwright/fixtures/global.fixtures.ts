import { expect as playwrightExpect, test as base } from '@playwright/test'

interface ExpectedHttpError {
  pathname: string;
  status: number;
}

interface ExpectedHttpErrors {
  values: ExpectedHttpError[];
}

interface TestOptions {
  expectedHttpErrors: ExpectedHttpErrors;
}

const expect = playwrightExpect

function getPathname(url: string): string | undefined {
  if (url === '') {
    return undefined
  }

  try {
    return new URL(url).pathname
  } catch {
    return undefined
  }
}

const test = base.extend<TestOptions>({
  expectedHttpErrors: [{ values: [] }, { option: true }],

  page: async ({ expectedHttpErrors, page }, use) => {
    const browserErrors: string[] = []
    const pendingHttpErrors = [...expectedHttpErrors.values]

    page.on('pageerror', (error) => {
      browserErrors.push(error.stack ?? error.message)
    })

    page.on('console', (message) => {
      const text = message.text()
      const isApplicationWarning = /\[Vue warn\]|hydration/iu.test(text)
      const httpErrorMatch = /Failed to load resource: the server responded with a status of (?<status>\d+)/u.exec(text)
      const httpErrorStatus = httpErrorMatch?.groups?.status
      const locationUrl = message.location().url
      const locationPathname = getPathname(locationUrl)

      const expectedHttpErrorIndex = pendingHttpErrors.findIndex((expectedError) => (
        httpErrorStatus !== undefined
        && expectedError.status === Number(httpErrorStatus)
        && expectedError.pathname === locationPathname
      ))

      const isExpectedHttpError = expectedHttpErrorIndex !== -1

      if (isExpectedHttpError) {
        pendingHttpErrors.splice(expectedHttpErrorIndex, 1)
      }

      if ((message.type() === 'error' && !isExpectedHttpError) || isApplicationWarning) {
        browserErrors.push(`[console.${message.type()}] ${text} (${locationUrl})`)
      }
    })

    await use(page)

    expect(browserErrors, 'browser errors').toStrictEqual([])
    expect(pendingHttpErrors, 'expected HTTP errors').toStrictEqual([])
  }
})

export { expect, test }
