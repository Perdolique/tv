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

const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

const TURNSTILE_SCRIPT = `
(() => {
  const widgets = new Map()

  function createToken(action) {
    return \`test-turnstile-\${action}-\${globalThis.crypto.randomUUID()}\`
  }

  globalThis.turnstile = {
    render(container, options) {
      const widgetId = globalThis.crypto.randomUUID()

      widgets.set(widgetId, { container, options })
      container.dataset.turnstileWidget = widgetId
      globalThis.queueMicrotask(() => options.callback(createToken(options.action)))

      return widgetId
    },

    remove(widgetId) {
      const widget = widgets.get(widgetId)

      widget?.container.removeAttribute('data-turnstile-widget')
      widgets.delete(widgetId)
    },

    reset(widgetId) {
      const widget = widgets.get(widgetId)

      if (widget !== undefined) {
        globalThis.queueMicrotask(() => widget.options.callback(createToken(widget.options.action)))
      }
    }
  }
})()
`

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

    await page.route(TURNSTILE_SCRIPT_URL, async (route) => {
      await route.fulfill({
        body: TURNSTILE_SCRIPT,
        contentType: 'application/javascript',
        status: 200
      })
    })

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
