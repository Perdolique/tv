import type { Locator, Page, Request } from '@playwright/test'
import { expect, test } from '../fixtures/global.fixtures.ts'
import { waitForHydration } from '../catalog/helpers.ts'

interface HeldResponse {
  started: Promise<Request>;
  release: () => void;
}

async function openRequestForm(page: Page, pathname = '/request-title'): Promise<void> {
  await page.goto(pathname)
  await waitForHydration(page)
}

async function searchRequestSource(page: Page, query = 'Requested title', type = 'Movie'): Promise<void> {
  await test.step('search TV before the missing-title source', async () => {
    await page.getByRole('radio', {
      name: type,
      exact: true
    }).check()

    const input = page.getByRole('searchbox', { name: 'Title name' })

    await input.fill(query)
    await expect(page.getByRole('button', { name: 'Search TMDB for a missing title' })).toHaveCount(0)
    await input.press('Enter')
    await page.getByRole('button', { name: 'Search TMDB for a missing title' }).click()
  })
}

async function reviewRequest(page: Page, title = 'Requested movie'): Promise<void> {
  await test.step('review the selected source card', async () => {
    const reviewName = `Review ${title}`

    await page.getByRole('button', {
      name: reviewName,
      exact: true
    }).click()

    const review = page.getByRole('region', { name: 'Review title request' })

    await expect(review.getByRole('heading', {
      name: title,
      exact: true
    })).toBeVisible()
  })
}

async function submitRequest(page: Page): Promise<void> {
  await test.step('wait for the confirmed request', async () => {
    await page.getByRole('button', {
      name: 'Submit request',
      exact: true
    }).click()

    const review = page.getByRole('region', { name: 'Review title request' })

    await expect(review.getByRole('status')).toContainText('Request submitted. Pending')
  })
}

async function holdResponse(page: Page, pattern: string | RegExp, response: unknown): Promise<HeldResponse> {
  const started = Promise.withResolvers<Request>()
  const gate = Promise.withResolvers<null>()
  let heldRequest: Request | null = null
  let aborted = false

  const recordFailure = (request: Request): void => {
    if (request === heldRequest) { aborted = true }
  }

  page.on('requestfailed', recordFailure)

  await page.route(pattern, async route => {
    heldRequest = route.request()

    started.resolve(heldRequest)

    await gate.promise

    try {
      if (!aborted) { await route.fulfill({ json: response }) }
    } finally {
      page.off('requestfailed', recordFailure)
    }
  }, { times: 1 })

  return {
    started: started.promise,
    release: () => { gate.resolve(null) }
  }
}

async function expectRequestCancelled(page: Page, request: Request, transition: () => Promise<void>): Promise<void> {
  const failed = page.waitForEvent('requestfailed', {
    predicate: candidate => candidate === request,
    timeout: 5000
  })

  await transition()

  const cancelled = await failed
  const failure = cancelled.failure()

  expect(failure?.errorText).toBe('net::ERR_ABORTED')
}

async function readBox(locator: Locator) {
  await locator.evaluate(async element => {
    await globalThis.document.fonts.ready

    const animations = element.getAnimations()

    const finiteAnimations = animations.filter(animation => {
      const iterations = animation.effect?.getComputedTiming().iterations

      return iterations !== Infinity
    })

    const pending = finiteAnimations.map(async animation => animation.finished)

    await Promise.all(pending)
  })

  const box = await locator.boundingBox()

  expect(box).not.toBeNull()

  if (box === null) { throw new Error('Expected a rendered element with geometry') }

  return box
}

async function expectContained(child: Locator, container: Locator): Promise<void> {
  const childMeasurement = readBox(child)
  const containerMeasurement = readBox(container)
  const [childBox, containerBox] = await Promise.all([childMeasurement, containerMeasurement])
  const childRight = childBox.x + childBox.width
  const childBottom = childBox.y + childBox.height
  const containerRight = containerBox.x + containerBox.width + 1
  const containerBottom = containerBox.y + containerBox.height + 1

  expect(childBox.width).toBeGreaterThan(0)
  expect(childBox.height).toBeGreaterThan(0)
  expect(childBox.x).toBeGreaterThanOrEqual(containerBox.x - 1)
  expect(childRight).toBeLessThanOrEqual(containerRight)
  expect(childBox.y).toBeGreaterThanOrEqual(containerBox.y - 1)
  expect(childBottom).toBeLessThanOrEqual(containerBottom)
}

async function expectReadableText(locator: Locator): Promise<void> {
  const overflow = await locator.evaluate(element => {
    const horizontal = element.scrollWidth - element.clientWidth
    const vertical = element.scrollHeight - element.clientHeight

    return {
      horizontal,
      vertical
    }
  })

  expect(overflow.horizontal).toBeLessThanOrEqual(1)
  expect(overflow.vertical).toBeLessThanOrEqual(1)
}

async function expectInsideViewport(page: Page, locator: Locator): Promise<void> {
  await locator.scrollIntoViewIfNeeded()

  const box = await readBox(locator)
  const viewport = page.viewportSize()

  if (viewport === null) { throw new Error('Expected a fixed browser viewport') }

  const right = box.x + box.width
  const bottom = box.y + box.height

  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(right).toBeLessThanOrEqual(viewport.width + 1)
  expect(bottom).toBeLessThanOrEqual(viewport.height + 1)
}

export { openRequestForm, searchRequestSource, reviewRequest, submitRequest, holdResponse, expectRequestCancelled, expectContained, expectInsideViewport, expectReadableText, readBox }
