import { expect as playwrightExpect, test as base } from '@playwright/test'

const expect = playwrightExpect

const test = base.extend({
  page: async ({ page }, use) => {
    const browserErrors: string[] = []

    page.on('pageerror', (error) => {
      browserErrors.push(error.stack ?? error.message)
    })

    page.on('console', (message) => {
      const text = message.text()
      const isApplicationWarning = /\[Vue warn\]|hydration/iu.test(text)

      if (message.type() === 'error' || isApplicationWarning) {
        browserErrors.push(`[console.${message.type()}] ${text}`)
      }
    })

    await use(page)

    expect(browserErrors, 'browser errors').toStrictEqual([])
  }
})

export { expect, test }
