import { expect, type APIResponse, type BrowserContext, type Locator, type Page } from '@playwright/test'
import { appBaseUrl } from './constants.ts'

async function addCookie(context: BrowserContext, name: string, value: string): Promise<void> {
  await context.addCookies([{
    name,
    url: appBaseUrl,
    value
  }])
}

// The fake service clock follows test time; a chosen viewing date never unlocks a future episode.
async function setCatalogTime(context: BrowserContext, page: Page, instant: string): Promise<void> {
  const date = new Date(instant)

  await addCookie(context, 'tv_catalog_now', instant)
  await page.clock.setFixedTime(date)
}

function getRedirectLocation(response: APIResponse): URL {
  const { location } = response.headers()

  if (location === undefined) {
    throw new Error('Expected a redirect location')
  }

  return new URL(location, appBaseUrl)
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => globalThis.document.documentElement.scrollWidth - globalThis.innerWidth)

  expect(overflow).toBeLessThanOrEqual(0)
}

async function getVisibleLineCount(locator: Locator): Promise<number> {
  return locator.evaluate((element) => {
    const styles = globalThis.getComputedStyle(element)
    const lineHeight = Number(styles.lineHeight.replace('px', ''))
    const visibleHeight = element.getBoundingClientRect().height

    return Math.round(visibleHeight / lineHeight)
  })
}

export {
  addCookie,
  expectNoHorizontalOverflow,
  getRedirectLocation,
  getVisibleLineCount,
  setCatalogTime
}
