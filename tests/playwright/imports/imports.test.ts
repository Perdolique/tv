/* oxlint-disable eslint/max-lines -- Import browser contracts share the same saved-preview workflow and service fixture. */
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import type { BrowserContext, Locator, Page, Request } from '@playwright/test'
import { expect, test } from '../fixtures/global.fixtures.ts'
import { addCookie, expectNoHorizontalOverflow } from '../helpers.ts'
import { waitForHydration } from '../catalog/helpers.ts'
import { dune } from '../catalog/details.fixtures.ts'
import { PREVIEW_ID } from './worker.ts'

async function asOperator(context: BrowserContext): Promise<void> {
  const caseId = randomUUID()
  const posterFile = new URL('../../../apps/web/public/posters/dune-2021.webp', import.meta.url)
  const posterPath = fileURLToPath(posterFile)

  await context.route('https://image.tmdb.org/t/p/w500/**', async (route) => {
    await route.fulfill({
      path: posterPath,
      contentType: 'image/webp'
    })
  })

  await addCookie(context, 'tv_session', 'e2e-session')
  await addCookie(context, 'catalog_manager', '1')
  await addCookie(context, 'import_case', caseId)
}

async function holdFirstResponse(page: Page, url: string) {
  const started = Promise.withResolvers<Request>()
  const release = Promise.withResolvers<null>()
  const finished = Promise.withResolvers<null>()

  await page.route(url, async (route) => {
    const request = route.request()
    const response = await route.fetch()

    started.resolve(request)

    await release.promise

    try {
      if (request.failure() === null) {
        await route.fulfill({ response })
      }
    } finally {
      finished.resolve(null)
    }
  }, { times: 1 })

  return {
    started: started.promise,

    async release() {
      release.resolve(null)

      await finished.promise
    }
  }
}

function observeRequestFailure(page: Page, staleRequest: Request) {
  let error: string | null = null

  page.on('requestfailed', (request) => {
    if (request === staleRequest) {
      error = request.failure()?.errorText ?? null
    }
  })

  return () => error
}

async function observeAbandonedSave(page: Page, staleRequest: Request): Promise<string> {
  const previewPattern = `/manage/imports/previews/${PREVIEW_ID}$`
  const previewUrl = new RegExp(previewPattern, 'u')
  const outcome = Promise.withResolvers<string>()

  page.on('requestfailed', (request) => {
    if (request === staleRequest) {
      const errorText = request.failure()?.errorText ?? 'unknown request failure'

      outcome.resolve(errorText)
    }
  })

  page.on('framenavigated', (frame) => {
    const isMainFrame = frame === page.mainFrame()
    const frameUrl = frame.url()
    const isPreview = previewUrl.test(frameUrl)

    if (isMainFrame && isPreview) {
      outcome.resolve('stale preview navigation')
    }
  })

  return outcome.promise
}

type ElementBounds = NonNullable<Awaited<ReturnType<Locator['boundingBox']>>>

function expectNoOverlap(hasRail: boolean, card: ElementBounds, confirmation: ElementBounds): void {
  if (hasRail) {
    expect(confirmation.x).toBeGreaterThanOrEqual(card.x + card.width)
  } else {
    expect(confirmation.y).toBeGreaterThanOrEqual(card.y + card.height)
  }
}

async function expectLoadedPoster(poster: Locator): Promise<void> {
  await expect.poll(async () => poster.evaluate(image => image instanceof globalThis.HTMLImageElement && image.naturalWidth > 0)).toBe(true)
}

function expectReviewOrder(width: number, confirmation: ElementBounds, [changes, result]: [ElementBounds, ElementBounds]): void {
  if (width < 1024) {
    expect(confirmation.y).toBeGreaterThan(changes.y)
  }

  if (width === 768) {
    expect(result.width).toBeGreaterThan(600)
  }
}

async function bounds(locator: Locator) {
  const box = await locator.boundingBox()

  if (box === null) { throw new Error('The import control has no visible bounds.') }

  return box
}

async function documentTop(locator: Locator): Promise<number> {
  return locator.evaluate((element) => {
    const box = element.getBoundingClientRect()

    return box.top + globalThis.scrollY
  })
}

async function selectMovie(page: Page): Promise<void> {
  await page.getByRole('searchbox', { name: 'Title name' }).fill('The Return')
  await page.getByRole('button', { name: 'Search titles' }).click()

  const results = page.getByRole('list', { name: 'TMDB search results' })

  await expect(results.getByRole('listitem')).toHaveCount(2)
  await expect(results.getByText('TMDB #603')).toBeVisible()
  await expect(results.getByText('TMDB #604')).toBeVisible()

  const choose = results.getByRole('listitem').first().getByRole('button', { name: 'Use this' })

  await choose.click()
  await expect(choose).toHaveAttribute('aria-pressed', 'true')
}

async function findMovie(page: Page): Promise<void> {
  await selectMovie(page)
  await page.getByRole('button', { name: 'Review import' }).click()

  const previewPattern = `/manage/imports/previews/${PREVIEW_ID}$`
  const previewUrl = new RegExp(previewPattern, 'u')

  await expect(page).toHaveURL(previewUrl)
}

test('imports a movie through a saved review and shows the result in shared history', async ({ page, context }) => {
  await asOperator(context)
  await page.goto('/manage/imports')
  await waitForHydration(page)

  await expect(page.getByRole('link', {
    name: 'Add title',
    exact: true
  })).toBeVisible()

  await findMovie(page)
  await expect(page.getByRole('heading', { name: 'Planned changes' })).toBeVisible()
  await expect(page.getByRole('img', { name: 'The Return poster' })).toBeVisible()
  await expect(page.getByText('Possible name match')).toBeVisible()
  await expect(page.getByText('Name matches are hints.')).toBeVisible()

  const matches = page.getByRole('region', {
    name: 'Catalog matches',
    exact: true
  })

  const matchesId = await matches.getAttribute('id')

  const matchLink = page.getByRole('link', {
    name: 'catalog match',
    exact: true
  })

  expect(matchesId).toBeTruthy()
  await expect(matchLink).toHaveAttribute('href', `#${matchesId}`)
  await matchLink.click()
  await expect(matches).toBeInViewport()
  await page.getByRole('button', { name: 'Confirm import' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Import complete' })).toBeFocused()
  await expect(page.getByRole('link', { name: 'Open catalog card' })).toBeVisible()
  await page.getByRole('link', { name: 'View shared history' }).click()
  await expect(page.getByRole('heading', { name: 'Import history' })).toBeVisible()
  await expect(page.getByRole('listitem').filter({ hasText: 'TMDB #603' })).toContainText('viewer@example.com')
})

test('changes the title type with native radio keyboard controls', async ({ page, context }) => {
  await asOperator(context)
  await page.goto('/manage/imports')
  await waitForHydration(page)

  const movie = page.getByRole('radio', {
    name: 'Movie',
    exact: true
  })

  const series = page.getByRole('radio', { name: 'Series' })
  const groupName = await movie.getAttribute('name')

  await expect(movie).toHaveAttribute('name', /.+/u)

  const expectedName = String(groupName)

  await expect(series).toHaveAttribute('name', expectedName)
  await movie.focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('radio', { name: 'Series' })).toBeChecked()
  await expect(page.getByRole('radio', { name: 'Series' })).toBeFocused()

  await expect(page.getByRole('radio', {
    name: 'Movie',
    exact: true
  })).not.toBeChecked()
})

test('keeps focus and scroll on the movie chosen with a pointer', async ({ page, context }) => {
  await asOperator(context)
  await page.goto('/manage/imports')
  await waitForHydration(page)
  await page.getByRole('searchbox', { name: 'Title name' }).fill('The Return')
  await page.getByRole('button', { name: 'Search titles' }).click()

  const result = page.getByRole('list', { name: 'TMDB search results' }).getByRole('listitem').filter({ hasText: 'TMDB #603' })
  const choose = result.getByRole('button', { name: 'Use this' })

  await choose.scrollIntoViewIfNeeded()

  const scrollBefore = await page.evaluate(() => globalThis.scrollY)

  await choose.click()
  await expect(choose).toHaveAttribute('aria-pressed', 'true')
  await expect(choose).toBeFocused()
  await expect.poll(async () => page.evaluate(() => globalThis.scrollY)).toBe(scrollBefore)
})

test('selects the exact TVMaze show and reviews regular episodes before a series import', async ({ page, context }) => {
  await asOperator(context)
  await page.goto('/manage/imports')
  await waitForHydration(page)

  const titles = page.getByRole('list', { name: 'TMDB search results' })
  const shows = page.getByRole('list', { name: 'TVMaze show candidates' })
  const review = page.getByRole('button', { name: 'Review import' })

  await test.step('search TVMaze automatically using the original title', async () => {
    await page.getByRole('radio', { name: 'Series' }).check()
    await page.getByRole('searchbox', { name: 'Title name' }).fill('Bridge')
    await page.getByRole('button', { name: 'Search titles' }).click()

    const automaticSearch = page.waitForRequest('**/api/catalog/imports/shows?**')

    await titles.getByRole('button', { name: 'Use this' }).click()

    const request = await automaticSearch
    const url = new URL(request.url())

    expect(url.searchParams.get('query')).toBe('Bron/Broen')
    await expect(shows.getByRole('listitem')).toHaveCount(2)
    await expect(review).toBeDisabled()

    const hintText = 'Choose a TVMaze show, or record why no show matches, to continue.'
    const hint = page.getByText(hintText, { exact: true })

    await expect(review).toHaveAccessibleDescription(hintText)
    await expect(hint).toBeVisible()

    const hintBox = await bounds(hint)
    const reviewBox = await bounds(review)
    const hintGap = reviewBox.y - hintBox.y - hintBox.height

    expect(hintBox.width).toBeGreaterThan(100)
    expect(hintBox.height).toBeGreaterThan(16)
    expect(hintBox.x).toBe(reviewBox.x)
    expect(hintGap).toBeGreaterThanOrEqual(0)
    expect(hintGap).toBeLessThanOrEqual(24)
  })

  await test.step('choose the exact episode source and open the saved review', async () => {
    const selectedShow = shows.getByRole('listitem').filter({ hasText: 'TVMaze #100' })

    await selectedShow.getByRole('button', { name: 'Use this' }).click()
    await expect(selectedShow.getByRole('button', { name: 'Use this' })).toHaveAttribute('aria-pressed', 'true')
    await expect(selectedShow.getByText('Selected', { exact: true })).toBeVisible()
    await expect(page.getByText('Ready to review', { exact: true })).toHaveAttribute('data-tone', 'warning')
    await review.click()
    await expect(page.getByText('TVMaze show #100')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Episodes (1)' })).toBeVisible()
  })

  await test.step('review regular episodes and confirm the import', async () => {
    await page.getByText('Season 1', { exact: true }).click()
    await expect(page.getByText('Pilot', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Confirm import' }).click()
    await expect(page.getByRole('heading', { name: 'Import complete' })).toBeVisible()
  })
})

test('restores the exact TMDB cards, pagination, and visible focus after changing a series selection', async ({ page, context }) => {
  await asOperator(context)
  await page.goto('/manage/imports')
  await waitForHydration(page)
  await page.getByRole('radio', { name: 'Series' }).check()
  await page.getByRole('searchbox', { name: 'Title name' }).fill('Bridge')
  await page.getByRole('button', { name: 'Search titles' }).click()

  const titles = page.getByRole('list', { name: 'TMDB search results' })
  const more = page.getByRole('button', { name: 'More results' })

  const change = page.getByRole('button', {
    name: 'Change selection',
    exact: true
  })

  await test.step('hide available pagination during selection and restore it on change', async () => {
    await expect(more).toBeVisible()

    const choose = titles.getByRole('button', { name: 'Use this' })
    const chooseBox = await bounds(choose)

    await choose.click()
    await expect(more).toHaveCount(0)

    const changeBox = await bounds(change)

    expect(changeBox.height).toBe(chooseBox.height)
    await change.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('searchbox', { name: 'Title name' })).toBeFocused()
    await expect(page.getByRole('searchbox', { name: 'Title name' })).toBeInViewport()
    await expect(more).toBeEnabled()
    await expect(page.getByRole('list', { name: 'TVMaze show candidates' })).toHaveCount(0)
  })

  await test.step('collapse to the chosen card and restore both distinct results', async () => {
    await more.click()
    await expect(titles.getByRole('listitem')).toHaveCount(2)

    const secondTitle = titles.getByRole('listitem').filter({ hasText: 'TMDB #105249' })

    await secondTitle.getByRole('button', { name: 'Use this' }).click()
    await expect(titles.getByRole('listitem')).toHaveCount(1)
    await expect(secondTitle.getByText('Selected', { exact: true })).toBeVisible()
    await expect(titles.getByText('TMDB #105248')).toHaveCount(0)
    await change.click()
    await expect(titles.getByRole('listitem')).toHaveCount(2)
    await expect(titles.getByText('TMDB #105248')).toBeVisible()
    await expect(titles.getByText('TMDB #105249')).toBeVisible()
    await expect(titles.getByText('Selected', { exact: true })).toHaveCount(0)
  })
})

test('cancels pending TMDB pagination when a series is selected', async ({ page, context }) => {
  await asOperator(context)
  await page.goto('/manage/imports')
  await waitForHydration(page)
  await page.getByRole('radio', { name: 'Series' }).check()
  await page.getByRole('searchbox', { name: 'Title name' }).fill('Bridge')
  await page.getByRole('button', { name: 'Search titles' }).click()

  const pending = await holdFirstResponse(page, '**/api/catalog/imports/search?**')

  await page.getByRole('button', { name: 'More results' }).click()

  const staleRequest = await pending.started
  const requestFailure = observeRequestFailure(page, staleRequest)
  const titles = page.getByRole('list', { name: 'TMDB search results' })
  const status = page.getByRole('region', { name: 'Search TMDB' }).getByRole('status')

  try {
    await titles.getByRole('button', { name: 'Use this' }).click()
    await expect.poll(requestFailure).toBe('net::ERR_ABORTED')
    await expect(status).toHaveText('2 TVMaze shows found.')
  } finally {
    await pending.release()
  }

  await expect(status).toHaveText('2 TVMaze shows found.')
  await expect(titles.getByRole('listitem')).toHaveCount(1)

  await page.getByRole('button', {
    name: 'Change selection',
    exact: true
  }).click()

  await expect(page.getByRole('button', { name: 'More results' })).toBeEnabled()
  await page.getByRole('button', { name: 'More results' }).click()
  await expect(titles.getByText('TMDB #105249')).toBeVisible()
})

// oxlint-disable-next-line vitest/prefer-each -- Playwright does not provide test.each.
for (const width of [390, 768, 1440]) {
  test(`keeps TVMaze candidates still while refreshing at ${width}px`, async ({ page, context }) => {
    await asOperator(context)

    await page.setViewportSize({
      width,
      height: 1024
    })

    await page.goto('/manage/imports')
    await waitForHydration(page)
    await page.getByRole('radio', { name: 'Series' }).check()
    await page.getByRole('searchbox', { name: 'Title name' }).fill('Bridge')
    await page.getByRole('button', { name: 'Search titles' }).click()
    await page.getByRole('list', { name: 'TMDB search results' }).getByRole('button', { name: 'Use this' }).click()

    const shows = page.getByRole('list', { name: 'TVMaze show candidates' })
    const search = page.getByRole('button', { name: 'Search shows' })

    await expect(shows.getByRole('listitem')).toHaveCount(2)
    await search.scrollIntoViewIfNeeded()

    const before = await documentTop(shows)
    const pending = await holdFirstResponse(page, '**/api/catalog/imports/shows?**')

    await search.click()

    await pending.started

    try {
      await expect(page.getByRole('status').filter({ hasText: 'Searching TVMaze for episode sources…' })).toBeVisible()
      await expect(shows.getByRole('listitem')).toHaveCount(2)
      await expect.poll(async () => documentTop(shows)).toBe(before)
    } finally {
      await pending.release()
    }

    await expect(search).toBeEnabled()
    await expect.poll(async () => documentTop(shows)).toBe(before)
    await expectNoHorizontalOverflow(page)
  })
}

test('requires a fresh TVMaze search before recording a missing match', async ({ page, context }) => {
  await asOperator(context)
  await page.goto('/manage/imports')
  await waitForHydration(page)
  await page.getByRole('radio', { name: 'Series' }).check()
  await page.getByRole('searchbox', { name: 'Title name' }).fill('The Bridge')
  await page.getByRole('button', { name: 'Search titles' }).click()
  await page.getByRole('list', { name: 'TMDB search results' }).getByRole('button', { name: 'Use this' }).click()
  await expect(page.getByRole('button', { name: 'Review import' })).toBeDisabled()
  await expect(page.getByRole('list', { name: 'TVMaze show candidates' }).getByRole('listitem')).toHaveCount(2)
  await page.getByRole('checkbox', { name: 'No matching TVMaze show' }).check()
  await page.getByRole('textbox', { name: 'Why is there no match?' }).fill('Checked both source IDs and years.')
  await page.getByRole('button', { name: 'Review import' }).click()
  await expect(page.getByText('No TVMaze match: Checked both source IDs and years.')).toBeVisible()
  await expect(page.getByText('The operator verified that no matching TVMaze show exists.')).toBeVisible()
  await expect(page.getByRole('heading', { name: /^Episodes/u })).toHaveCount(0)
  await expect(page.getByText('Matching source IDs:')).toHaveCount(0)
  await expect(page.getByText(/episode records? will be added/u)).toHaveCount(0)
  await page.getByRole('button', { name: 'Confirm import' }).click()
  await expect(page.getByText('Created catalog card · 0 new episodes · 1 changed field.')).toBeVisible()
})

test('keeps a failed import in history and requires an explicit retry', async ({ page, context }) => {
  await asOperator(context)
  await addCookie(context, 'import_fail_once', '1')
  await page.goto('/manage/imports')
  await waitForHydration(page)
  await findMovie(page)
  await page.getByRole('button', { name: 'Confirm import' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Import failed' })).toBeFocused()
  await page.getByRole('button', { name: 'Retry failed import' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Import complete' })).toBeFocused()
})

test('refreshes a pending import without submitting it again', async ({ page, context }) => {
  await asOperator(context)
  await addCookie(context, 'import_pending', '1')
  await page.goto('/manage/imports')
  await waitForHydration(page)
  await findMovie(page)
  await page.getByRole('button', { name: 'Confirm import' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Import pending' })).toBeFocused()
  await page.getByRole('button', { name: 'Refresh status' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Import complete' })).toBeFocused()
})

// oxlint-disable-next-line vitest/prefer-each -- Playwright's test API does not provide test.each.
for (const scenario of [{
  changedInput: 'query',
  initialQuery: 'empty',
  replace: async (page: Page) => page.getByRole('searchbox', { name: 'Title name' }).fill('The Return'),
  expectedCount: 2,
  expectedSource: 'TMDB #603'
}, {
  changedInput: 'type',
  initialQuery: 'The Bridge',
  replace: async (page: Page) => page.getByRole('radio', { name: 'Series' }).check(),
  expectedCount: 1,
  expectedSource: 'TMDB #105248'
}]) {
  test(`recovers TMDB search after changing the ${scenario.changedInput} during a pending request`, async ({ page, context }) => {
    await asOperator(context)
    await page.goto('/manage/imports')
    await waitForHydration(page)

    const pending = await holdFirstResponse(page, '**/api/catalog/imports/search?**')
    const input = page.getByRole('searchbox', { name: 'Title name' })

    await input.fill(scenario.initialQuery)
    await page.getByRole('button', { name: 'Search titles' }).click()

    const staleRequest = await pending.started
    const requestFailure = observeRequestFailure(page, staleRequest)

    try {
      await scenario.replace(page)
      await expect(page.getByRole('button', { name: 'Search titles' })).toBeEnabled()
      await expect.poll(requestFailure).toBe('net::ERR_ABORTED')
    } finally {
      await pending.release()
    }

    await page.getByRole('button', { name: 'Search titles' }).click()

    const results = page.getByRole('list', { name: 'TMDB search results' })

    await expect(results.getByRole('listitem')).toHaveCount(scenario.expectedCount)
    await expect(results.getByText(scenario.expectedSource)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Search titles' })).toBeEnabled()
  })
}

test('recovers TVMaze search after editing the query during a pending request', async ({ page, context }) => {
  await asOperator(context)
  await page.goto('/manage/imports')
  await waitForHydration(page)
  await page.getByRole('radio', { name: 'Series' }).check()
  await page.getByRole('searchbox', { name: 'Title name' }).fill('The Bridge')
  await page.getByRole('button', { name: 'Search titles' }).click()

  const pending = await holdFirstResponse(page, '**/api/catalog/imports/shows?**')

  await page.getByRole('list', { name: 'TMDB search results' }).getByRole('button', { name: 'Use this' }).click()

  const staleRequest = await pending.started
  const requestFailure = observeRequestFailure(page, staleRequest)

  try {
    await page.getByRole('searchbox', { name: 'TVMaze show name' }).fill('Bridge')
    await expect(page.getByRole('button', { name: 'Search shows' })).toBeEnabled()
    await expect.poll(requestFailure).toBe('net::ERR_ABORTED')
  } finally {
    await pending.release()
  }

  const currentRequest = page.waitForRequest('**/api/catalog/imports/shows?query=Bridge')

  await page.getByRole('button', { name: 'Search shows' }).click()

  await currentRequest

  await expect(page.getByRole('list', { name: 'TVMaze show candidates' }).getByRole('listitem')).toHaveCount(2)
  await expect(page.getByRole('button', { name: 'Search shows' })).toBeEnabled()
})

test('keeps import history open when an abandoned preview save finishes', async ({ page, context }) => {
  await asOperator(context)
  await page.goto('/manage/imports')
  await waitForHydration(page)
  await selectMovie(page)

  const pending = await holdFirstResponse(page, '**/api/catalog/imports/previews')

  await page.getByRole('button', { name: 'Review import' }).click()

  const staleRequest = await pending.started
  const outcome = observeAbandonedSave(page, staleRequest)

  try {
    await page.getByRole('link', {
      name: 'Import history',
      exact: true
    }).click()

    await expect(page.getByRole('heading', { name: 'Import history' })).toBeVisible()
  } finally {
    await pending.release()
  }

  const requestOutcome = await outcome

  expect(requestOutcome).toBe('net::ERR_ABORTED')
  await expect(page).toHaveURL(/\/manage\/imports\/history$/u)
  await expect(page.getByRole('heading', { name: 'Import history' })).toBeVisible()
})

const sourceFailureTest = test.extend({ expectedHttpErrors: { values: [{
  pathname: '/api/catalog/imports/search',
  status: 503
}] } })

// oxlint-disable-next-line vitest/require-hook -- This is a Playwright test with an expected HTTP error.
sourceFailureTest('shows empty results and a safe source retry message', async ({ page, context }) => {
  await asOperator(context)
  await page.goto('/manage/imports')
  await waitForHydration(page)
  await page.getByRole('searchbox', { name: 'Title name' }).fill('empty')
  await page.getByRole('button', { name: 'Search titles' }).click()
  await expect(page.getByRole('heading', { name: 'No matching titles' })).toBeVisible()
  await addCookie(context, 'import_source_failure', '1')
  await page.getByRole('searchbox', { name: 'Title name' }).fill('The Return')
  await page.getByRole('button', { name: 'Search titles' }).click()
  await expect(page.getByText('The source is temporarily unavailable. Try again in 12 seconds.')).toBeVisible()
})

// oxlint-disable-next-line vitest/require-hook -- This is a Playwright test with an expected HTTP error.
sourceFailureTest('clears the pagination cursor when the same first-page search fails', async ({ page, context }) => {
  await asOperator(context)
  await page.goto('/manage/imports')
  await waitForHydration(page)
  await page.getByRole('radio', { name: 'Series' }).check()
  await page.getByRole('searchbox', { name: 'Title name' }).fill('The Bridge')
  await page.getByRole('button', { name: 'Search titles' }).click()
  await expect(page.getByRole('button', { name: 'More results' })).toBeVisible()
  await addCookie(context, 'import_source_failure', '1')
  await page.getByRole('button', { name: 'Search titles' }).click()
  await expect(page.getByText('The source is temporarily unavailable. Try again in 12 seconds.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'More results' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'No matching titles' })).toHaveCount(0)
})

const conflictTest = test.extend({ expectedHttpErrors: { values: [{
  pathname: `/api/catalog/imports/previews/${PREVIEW_ID}/apply`,
  status: 409
}] } })

// oxlint-disable-next-line vitest/require-hook -- This is a Playwright test with an expected HTTP error.
conflictTest('stops confirmation when the catalog changed after review', async ({ page, context }) => {
  await asOperator(context)
  await page.goto('/manage/imports')
  await waitForHydration(page)
  await findMovie(page)
  await addCookie(context, 'import_conflict', '1')
  await page.getByRole('button', { name: 'Confirm import' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByText('This preview changed or expired. Create a new preview.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Confirm import' })).toHaveCount(0)

  await expect(page.getByRole('heading', {
    name: 'Confirm import',
    exact: true
  })).toBeFocused()
})

const revokedTest = test.extend({ expectedHttpErrors: { values: [{
  pathname: '/api/catalog/imports/search',
  status: 403
}] } })

// oxlint-disable-next-line vitest/require-hook -- This is a Playwright test with an expected HTTP error.
revokedTest('clears private controls after access is revoked on an open page', async ({ page, context }) => {
  await asOperator(context)
  await page.goto('/manage/imports')
  await waitForHydration(page)
  await context.clearCookies({ name: 'catalog_manager' })
  await page.getByRole('searchbox', { name: 'Title name' }).fill('The Return')
  await page.getByRole('button', { name: 'Search titles' }).click()
  await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible()
  await expect(page.getByRole('searchbox', { name: 'Title name' })).toHaveCount(0)
})

const deniedTest = test.extend({ expectedHttpErrors: { values: [{
  pathname: '/manage/imports',
  status: 403
}, {
  pathname: '/api/catalog/imports/access',
  status: 403
}] } })

// oxlint-disable-next-line vitest/require-hook -- This is a Playwright test with expected HTTP errors.
deniedTest('redirects guests and denies an account without the current grant', async ({ page, context }) => {
  await page.goto('/manage/imports')
  await expect(page).toHaveURL(/\/sign-in\?redirectTo=/u)
  await addCookie(context, 'tv_session', 'e2e-session')
  await page.goto('/manage/imports')
  await waitForHydration(page)
  await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible()
  await expect(page.getByRole('searchbox', { name: 'Title name' })).toHaveCount(0)

  await expect(page.getByRole('link', {
    name: 'Add title',
    exact: true
  })).toHaveCount(0)
})

test('shows blocked and expired previews and offers a new review', async ({ page, context }) => {
  await asOperator(context)
  await addCookie(context, 'import_blocked', '1')
  await page.goto('/manage/imports')
  await waitForHydration(page)
  await findMovie(page)
  await expect(page.getByText('This preview is blocked or expired.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Confirm import' })).toHaveCount(0)
  await addCookie(context, 'import_expired', '1')
  await page.reload()
  await expect(page.getByText('This preview is unavailable or expired.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Create a new preview' })).toBeVisible()
})

test('renders a hosted public poster and source credits on an imported catalog card', async ({ page, context }) => {
  await asOperator(context)
  await addCookie(context, 'import_public_poster', '1')
  await page.goto(`/titles/${dune.id}`)
  await waitForHydration(page)
  await expect(page.getByRole('heading', { name: 'Sources and credits' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'TVMaze show' })).toBeVisible()

  const poster = page.getByRole('img', { name: 'Dune poster' })

  await expect(poster).toBeVisible()
  await expect(poster).toHaveJSProperty('complete', true)
  await expect.poll( async () => poster.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0)

  const posterUrl = await poster.evaluate((image: HTMLImageElement) => image.currentSrc)
  const response = await page.request.get(posterUrl)

  expect(response.headers()['content-type']).toContain('image/webp')
  expect(response.headers()['cache-control']).toContain('immutable')
})

for (const viewport of [{
  width: 390,
  height: 844
}, {
  width: 768,
  height: 1024
}, {
  width: 1440,
  height: 1024
}]) {
  // oxlint-disable-next-line vitest/prefer-each -- Playwright's test API does not provide test.each.
  for (const theme of ['light', 'dark'] as const) {
    test(`keeps import controls usable at ${viewport.width}×${viewport.height} in ${theme} theme`, async ({ page, context }) => {
      await asOperator(context)
      await page.setViewportSize(viewport)
      await page.emulateMedia({ colorScheme: theme })
      await page.goto('/')
      await waitForHydration(page)

      const entry = page.getByRole('link', {
        name: 'Add title',
        exact: true
      })

      const mainNavigation = page.getByRole('navigation', {
        name: 'Main navigation',
        exact: true
      })

      await expect(entry).toBeVisible()
      await expect(entry.locator('svg')).toBeVisible()

      await expect(mainNavigation.getByRole('link', {
        name: 'Add title',
        exact: true
      })).toHaveCount(Number(viewport.width >= 640))

      await entry.focus()
      await expect(entry).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(page).toHaveURL(/\/manage\/imports$/u)
      await waitForHydration(page)
      await expectNoHorizontalOverflow(page)

      const navigation = page.getByRole('navigation', {
        name: 'Main navigation',
        exact: true
      })

      await expect(navigation.filter({ visible: true })).toHaveCount(Number(viewport.width >= 640))

      await expect(navigation.getByRole('link', {
        name: 'Add title',
        exact: true
      }).and(page.locator('[aria-current="page"]'))).toHaveCount(Number(viewport.width >= 640))

      await expect(page.getByRole('link', { name: 'Back to catalog' }).filter({ visible: true })).toHaveCount(Number(viewport.width < 640))

      const input = page.getByRole('searchbox', { name: 'Title name' })

      await input.focus()
      await expect(input).toBeFocused()
      await input.fill('The Return')
      await input.press('Enter')
      await expect(page.getByRole('list', { name: 'TMDB search results' }).getByRole('listitem')).toHaveCount(2)

      const result = page.getByRole('list', { name: 'TMDB search results' }).getByRole('listitem').first()
      const poster = result.getByRole('img', { name: 'The Return poster' })

      await expect(poster).toBeVisible()
      await expectLoadedPoster(poster)

      const inputBox = await bounds(input)
      const searchBox = await bounds(page.getByRole('button', { name: 'Search titles' }))
      const resultBox = await bounds(result)
      const posterBox = await bounds(poster)

      const selectedMode = page.getByRole('radio', {
        name: 'Movie',
        exact: true
      }).locator('..')

      const modeBackground = await selectedMode.evaluate(label => globalThis.getComputedStyle(label).backgroundColor)

      expect(modeBackground).toBe('rgb(215, 255, 85)')
      expect(searchBox.x).toBeGreaterThan(inputBox.x + inputBox.width / 2)
      expect(searchBox.x + searchBox.width).toBeLessThanOrEqual(inputBox.x + inputBox.width)
      expect(searchBox.y).toBeGreaterThanOrEqual(inputBox.y)
      expect(searchBox.y + searchBox.height).toBeLessThanOrEqual(inputBox.y + inputBox.height)
      expect(posterBox.x).toBeLessThan(resultBox.x + resultBox.width / 2)

      const choose = result.getByRole('button', { name: 'Use this' })

      await choose.focus()

      const scrollBefore = await page.evaluate(() => globalThis.scrollY)

      await page.keyboard.press('Enter')
      await expect(choose).toHaveAttribute('aria-pressed', 'true')
      await expect(choose).toBeFocused()
      await expect.poll(async () => page.evaluate(() => globalThis.scrollY)).toBe(scrollBefore)
      await page.getByRole('button', { name: 'Review import' }).click()
      await expect(page.getByRole('heading', { name: 'Planned changes' })).toBeVisible()
      await expect(page.getByText('Read-only source data')).toBeVisible()
      await expect(page.getByText('Saved poster', { exact: true })).toBeVisible()
      await page.evaluate(() => { globalThis.scrollTo(0, 0) })

      const confirm = await bounds(page.getByRole('region', { name: 'Confirm import' }))

      const card = await bounds(page.getByRole('region', {
        name: 'The Return',
        exact: true
      }))

      const changes = await bounds(page.getByRole('heading', { name: 'Planned changes' }))
      const action = await bounds(page.getByRole('button', { name: 'Confirm import' }))
      const hasRail = viewport.width >= 1024

      expect(confirm.x + confirm.width).toBeLessThanOrEqual(viewport.width)
      expectReviewOrder(viewport.width, confirm, [changes, resultBox])
      expect(action.width).toBeGreaterThanOrEqual(44)
      expect(action.height).toBeGreaterThanOrEqual(44)
      expectNoOverlap(hasRail, card, confirm)
      await expectNoHorizontalOverflow(page)
      await page.getByRole('button', { name: 'Confirm import' }).focus()
      await page.keyboard.press('Enter')
      await expect(page.getByRole('heading', { name: 'Import complete' })).toBeFocused()
      await page.getByRole('link', { name: 'View shared history' }).click()
      await expect(page.getByRole('list', { name: 'Import operations' })).toContainText('viewer@example.com')
      await expectNoHorizontalOverflow(page)
    })
  }
}

test('keeps a long series review compact and opens seasons with the keyboard', async ({ page, context }) => {
  await asOperator(context)
  await addCookie(context, 'import_long_series', '1')

  await page.setViewportSize({
    width: 1440,
    height: 1024
  })

  await page.goto('/manage/imports')
  await waitForHydration(page)
  await page.getByRole('radio', { name: 'Series' }).check()
  await page.getByRole('searchbox', { name: 'Title name' }).fill('The Bridge')
  await page.getByRole('button', { name: 'Search titles' }).click()
  await page.getByRole('list', { name: 'TMDB search results' }).getByRole('button', { name: 'Use this' }).click()
  await expect(page.getByRole('heading', { name: 'Match the episode source' })).toBeFocused()
  await expect(page.getByRole('list', { name: 'TVMaze show candidates' }).getByRole('listitem')).toHaveCount(2)
  await page.getByRole('list', { name: 'TVMaze show candidates' }).getByRole('button', { name: 'Use this' }).first().click()
  await expect(page.getByRole('button', { name: 'Review import' })).toBeFocused()
  await page.getByRole('button', { name: 'Review import' }).press('Enter')
  await expect(page.getByRole('heading', { name: 'Episodes (40)' })).toBeVisible()
  await page.evaluate(() => { globalThis.scrollTo(0, 0) })
  await expect(page.getByRole('button', { name: 'Confirm import' })).toBeInViewport()
  await expect(page.getByText('Pilot', { exact: true })).not.toBeVisible()
  await page.locator('summary').filter({ hasText: 'Season 1' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByText('Pilot', { exact: true })).toBeVisible()
  await expect(page.getByText('The Bridge: a long episode title for chapter 11', { exact: true })).not.toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page.getByText('Pilot', { exact: true })).not.toBeVisible()
  await expectNoHorizontalOverflow(page)
})
