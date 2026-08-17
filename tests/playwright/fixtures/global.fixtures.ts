import { expect as playwrightExpect, test as base } from '@playwright/test'

interface TestOptions {
  expectedHttpErrorStatuses: number[];
}

const expect = playwrightExpect

const test = base.extend<TestOptions>({
  expectedHttpErrorStatuses: [[], { option: true }],

  page: async ({ expectedHttpErrorStatuses, page }, use) => {
    const browserErrors: string[] = []

    page.on('pageerror', (error) => {
      browserErrors.push(error.stack ?? error.message)
    })

    page.on('console', (message) => {
      const text = message.text()
      const isApplicationWarning = /\[Vue warn\]|hydration/iu.test(text)
      const httpErrorMatch = /Failed to load resource: the server responded with a status of (?<status>\d+)/u.exec(text)
      const httpErrorStatus = httpErrorMatch?.groups?.status

      const isExpectedHttpError = httpErrorStatus !== undefined
        && expectedHttpErrorStatuses.includes(Number(httpErrorStatus))

      if ((message.type() === 'error' && !isExpectedHttpError) || isApplicationWarning) {
        browserErrors.push(`[console.${message.type()}] ${text}`)
      }
    })

    await use(page)

    expect(browserErrors, 'browser errors').toStrictEqual([])
  }
})

export { expect, test }
