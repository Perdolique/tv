/* oxlint-disable vitest/prefer-each -- Themes and viewport modes exercise the same edge geometry. */
import type { Locator, Page } from '@playwright/test'
import { expect, test } from '../fixtures/global.fixtures.ts'
import { appBaseUrl } from '../constants.ts'
import { chernobyl } from '../catalog/details.fixtures.ts'
import { waitForHydration } from '../catalog/helpers.ts'
import { expectNoHorizontalOverflow } from '../helpers.ts'

test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } })

async function expectEdgePaint(surface: Locator, top: number): Promise<void> {
  const paintsEdge = await surface.evaluate((element, vertical) => {
    const hit = globalThis.document.elementFromPoint(globalThis.innerWidth - 1, vertical)

    return hit !== null && element.contains(hit)
  }, top)

  expect(paintsEdge).toBe(true)
}

async function readInlineBox(locator: Locator) {
  return locator.evaluate(element => {
    const { left, width } = element.getBoundingClientRect()

    return {
      left,
      width
    }
  })
}

async function hasVerticalScrollbar(page: Page): Promise<boolean> {
  return page.evaluate(() => globalThis.document.documentElement.scrollHeight > globalThis.innerHeight)
}

async function prepareTitle(page: Page): Promise<void> {
  await page.goto(`/titles/${chernobyl.id}`)
  await waitForHydration(page)
  await page.evaluate(async () => globalThis.document.fonts.ready)
  await page.addStyleTag({ content: '::-webkit-scrollbar { width: 16px; }' })

  await expect.poll(async () => page.getByRole('main').evaluate(element => (
    element.getBoundingClientRect().right - globalThis.document.documentElement.clientWidth
  ))).toBeLessThanOrEqual(0)

  await page.getByRole('tab', { name: 'Overview' }).click()
}

async function fitViewportBetweenTabs(page: Page, width: number): Promise<number> {
  const timeline = page.getByRole('region', { name: 'Your timeline' })

  await expect(timeline.getByText('Your activity for this title will appear here.', { exact: true })).toBeVisible()

  const overviewHeight = await page.evaluate(() => globalThis.document.documentElement.scrollHeight)

  await page.getByRole('tab', { name: 'Episodes' }).click()

  await expect(page.getByRole('button', {
    name: 'Mark all episodes watched',
    exact: true
  })).toBeVisible()

  await expect(page.getByRole('region', {
    name: 'Episodes',
    exact: true
  }).getByRole('listitem')).toHaveCount(5)

  const episodesHeight = await page.evaluate(() => globalThis.document.documentElement.scrollHeight)

  expect(episodesHeight).toBeGreaterThan(overviewHeight)

  const midpoint = (overviewHeight + episodesHeight) / 2
  const height = Math.floor(midpoint)

  await page.setViewportSize({
    width,
    height
  })

  await page.getByRole('tab', { name: 'Overview' }).click()

  return height
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`keeps the signed-in catalog aligned with mobile navigation in ${colorScheme}`, async ({ context, page }) => {
    await context.addCookies([{
      name: 'tv_session',
      value: 'e2e-session',
      url: appBaseUrl
    }])

    await page.setViewportSize({
      width: 390,
      height: 844
    })

    await page.emulateMedia({ colorScheme })
    await page.goto('/?query=arrival')
    await waitForHydration(page)
    await page.evaluate(async () => globalThis.document.fonts.ready)
    await page.addStyleTag({ content: '::-webkit-scrollbar { width: 16px; }' })

    const header = page.getByRole('banner')
    const navigation = page.getByRole('navigation', { name: 'Main navigation' })

    await expect.poll(async () => readInlineBox(header)).toEqual({
      left: 0,
      width: 374
    })

    const headerBox = await readInlineBox(header)
    const navigationBox = await readInlineBox(navigation)

    expect(navigationBox).toEqual(headerBox)
    await expectNoHorizontalOverflow(page)
  })

  test(`keeps mobile chrome at the edges through scrolling and rating in ${colorScheme}`, async ({ context, page }) => {
    await context.addCookies([{
      name: 'tv_session',
      value: 'e2e-session',
      url: appBaseUrl
    }])

    await page.setViewportSize({
      width: 390,
      height: 900
    })

    await page.emulateMedia({ colorScheme })
    await prepareTitle(page)

    const viewportHeight = await fitViewportBetweenTabs(page, 390)
    const bottomEdge = viewportHeight - 10
    const header = page.getByRole('banner')
    const navigation = page.getByRole('navigation', { name: 'Main navigation' })

    const heading = page.getByRole('heading', {
      name: 'Chernobyl',
      exact: true
    })

    const dashboard = navigation.getByRole('link', {
      name: 'Dashboard',
      exact: true
    })

    const rate = page.getByRole('button', {
      name: 'Rate',
      exact: true
    })

    await expect.poll(async () => hasVerticalScrollbar(page)).toBe(false)
    await expectEdgePaint(header, 40)
    await expectEdgePaint(navigation, bottomEdge)

    const before = await Promise.all([readInlineBox(heading), readInlineBox(dashboard)])

    await page.getByRole('tab', { name: 'Episodes' }).click()
    await expect.poll(async () => hasVerticalScrollbar(page)).toBe(true)

    const withScrollbar = await Promise.all([readInlineBox(heading), readInlineBox(dashboard)])

    expect(withScrollbar).toEqual(before)

    await page.evaluate(() => {
      globalThis.scrollTo({
        left: 100,
        top: 100
      })
    })

    const scrollX = await page.evaluate(() => globalThis.scrollX)

    expect(scrollX).toBe(0)

    const scrollY = await page.evaluate(() => globalThis.scrollY)

    expect(scrollY).toBe(100)

    const navigationBottom = await navigation.evaluate(element => element.getBoundingClientRect().bottom)

    expect(navigationBottom).toBe(viewportHeight)
    await page.evaluate(() => { globalThis.scrollTo(0, 0) })
    await rate.click()

    const sheet = page.getByRole('dialog', { name: 'Your rating' })

    await expect(sheet).toBeVisible()
    await expect(page.locator('html')).toHaveCSS('overflow', 'hidden')

    const sheetBox = await readInlineBox(sheet)

    expect(sheetBox).toEqual({
      left: 0,
      width: 390
    })

    const headingWithSheet = await readInlineBox(heading)

    expect(headingWithSheet).toEqual(before[0])
    await expectEdgePaint(sheet, bottomEdge)
    await page.mouse.move(200, 200)
    await page.mouse.wheel(0, 400)
    await expect.poll(async () => page.evaluate(() => globalThis.scrollY)).toBe(0)
    await sheet.getByRole('button', { name: 'Close rating' }).click()
    await expect(page.locator('html')).not.toHaveCSS('overflow', 'hidden')
    await expect(rate).toBeFocused()

    const afterSheet = await Promise.all([readInlineBox(heading), readInlineBox(dashboard)])

    expect(afterSheet).toEqual(before)
    await page.getByRole('tab', { name: 'Overview' }).click()
    await expectEdgePaint(header, 40)
    await expectEdgePaint(navigation, bottomEdge)
    await expectNoHorizontalOverflow(page)
  })

  test(`fills the guest header across a short desktop title in ${colorScheme}`, async ({ page }) => {
    await page.setViewportSize({
      width: 1440,
      height: 1000
    })

    await page.emulateMedia({ colorScheme })
    await prepareTitle(page)

    const hasScrollbar = await hasVerticalScrollbar(page)

    expect(hasScrollbar).toBe(false)
    await expectEdgePaint(page.getByRole('banner'), 30)
    await expectNoHorizontalOverflow(page)
  })

  for (const width of [768, 1440]) {
    test(`fills the authentication background at ${width}px in ${colorScheme}`, async ({ page }) => {
      await page.setViewportSize({
        width,
        height: 1024
      })

      await page.emulateMedia({ colorScheme })
      await page.goto('/sign-in')
      await page.addStyleTag({ content: '::-webkit-scrollbar { width: 16px; }' })
      await expectEdgePaint(page.getByRole('main'), 500)
      await expectNoHorizontalOverflow(page)
    })
  }
}

test('uses the full width when scrollbars take no space', async ({ context, page }) => {
  await context.addCookies([{
    name: 'tv_session',
    value: 'e2e-session',
    url: appBaseUrl
  }])

  await page.setViewportSize({
    width: 390,
    height: 900
  })

  await page.goto(`/titles/${chernobyl.id}`)
  await waitForHydration(page)
  await page.addStyleTag({ content: '* { scrollbar-width: none; }' })
  await page.getByRole('tab', { name: 'Overview' }).click()

  const navigation = page.getByRole('navigation', { name: 'Main navigation' })
  const before = await readInlineBox(navigation)

  expect(before).toEqual({
    left: 0,
    width: 390
  })

  await expectEdgePaint(page.getByRole('banner'), 40)
  await expectEdgePaint(navigation, 890)
  await page.getByRole('tab', { name: 'Episodes' }).click()

  const after = await readInlineBox(navigation)

  expect(after).toEqual(before)
  await expectNoHorizontalOverflow(page)
})

test('keeps the sidebar and calendar agenda attached to the viewport', async ({ context, page }) => {
  await context.addCookies([{
    name: 'tv_session',
    value: 'e2e-session',
    url: appBaseUrl
  }])

  await page.clock.setFixedTime(new Date('2026-09-12T10:00:00.000Z'))

  await page.setViewportSize({
    width: 1440,
    height: 600
  })

  await page.goto('/calendar?date=2026-09-13')
  await waitForHydration(page)
  await expect(page.getByRole('list', { name: 'Releases for selected day' })).toBeVisible()

  const agenda = page.getByRole('region').filter({ has: page.getByRole('list', { name: 'Releases for selected day' }) })
  const sidebar = page.getByRole('banner')
  const before = await sidebar.boundingBox()
  const sidebarLeft = await sidebar.evaluate(element => element.getBoundingClientRect().left)

  expect(sidebarLeft).toBe(0)

  const desktopSidebarHeight = await sidebar.evaluate(element => element.getBoundingClientRect().height)

  expect(desktopSidebarHeight).toBe(600)
  await page.evaluate(() => { globalThis.scrollTo(0, 200) })

  const scrollY = await page.evaluate(() => globalThis.scrollY)

  expect(scrollY).toBe(200)

  const afterScroll = await sidebar.boundingBox()

  expect(afterScroll).toEqual(before)

  const agendaTop = await agenda.evaluate(element => element.getBoundingClientRect().top)

  expect(agendaTop).toBe(24)

  await page.setViewportSize({
    width: 768,
    height: 600
  })

  const compactSidebarBox = await readInlineBox(sidebar)

  expect(compactSidebarBox).toEqual({
    left: 0,
    width: 80
  })

  const compactSidebarHeight = await sidebar.evaluate(element => element.getBoundingClientRect().height)

  expect(compactSidebarHeight).toBe(600)
  await expectNoHorizontalOverflow(page)
})
