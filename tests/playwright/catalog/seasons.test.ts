import type { Locator } from '@playwright/test'
import { expect, test } from '../fixtures/global.fixtures.ts'
import { addCookie } from '../helpers.ts'
import { episodeEdgeSeries } from './details.fixtures.ts'
import { openEpisodes } from './helpers.ts'

const titlePath = `/titles/${episodeEdgeSeries.id}`

async function measureDisclosure(panel: Locator) {
  return panel.evaluate(async element => {
    const activatorId = element.getAttribute('aria-labelledby')
    const activator = activatorId === null ? null : globalThis.document.querySelector<HTMLButtonElement>(`#${globalThis.CSS.escape(activatorId)}`)

    if (activator === null) {
      throw new Error('The season disclosure has no activator.')
    }

    const before = element.getBoundingClientRect().height

    activator.click()

    const firstFrame = Promise.withResolvers<number>()

    globalThis.requestAnimationFrame(firstFrame.resolve)

    await firstFrame.promise

    const transition = element.getAnimations().find(animation => (
      animation instanceof globalThis.CSSTransition && animation.transitionProperty === 'grid-template-rows'
    ))

    const isAnimated = transition !== undefined
    const inert = element.hasAttribute('inert')
    const ariaHidden = element.getAttribute('aria-hidden')

    if (transition !== undefined) {
      transition.pause()

      const duration = transition.effect?.getComputedTiming().duration

      if (typeof duration !== 'number') {
        throw new TypeError('The disclosure transition has no duration.')
      }

      transition.currentTime = duration / 2
    }

    const during = element.getBoundingClientRect().height

    transition?.finish()

    const lastFrame = Promise.withResolvers<number>()

    globalThis.requestAnimationFrame(lastFrame.resolve)

    await lastFrame.promise

    return {
      before,
      during,
      after: element.getBoundingClientRect().height,
      isAnimated,
      inert,
      ariaHidden
    }
  })
}

test('opens the newest season and supports single-open keyboard disclosure with progress', async ({ context, page }) => {
  await page.clock.setFixedTime(new Date('2099-03-01T12:00:00Z'))
  await addCookie(context, 'tv_session', 'e2e-session')
  await page.goto(titlePath)
  await openEpisodes(page)

  const episodes = page.getByRole('region', {
    name: 'Episodes',
    exact: true
  })

  const first = episodes.getByRole('button', {
    name: 'Season 1',
    exact: true
  })

  const second = episodes.getByRole('button', {
    name: 'Season 2',
    exact: true
  })

  await expect(page.getByRole('combobox', {
    name: 'Season',
    exact: true
  })).toHaveCount(0)

  const seasonButtons = episodes.getByRole('button', { name: /^Season \d+$/u })

  await expect(seasonButtons.nth(0)).toHaveAccessibleName('Season 2')
  await expect(seasonButtons.nth(1)).toHaveAccessibleName('Season 1')
  await expect(first).toHaveAttribute('aria-expanded', 'false')
  await expect(second).toHaveAttribute('aria-expanded', 'true')
  await expect(second).toHaveAccessibleDescription('2 episodes · 0 watched')

  const currentEpisode = episodes.getByRole('listitem').filter({ hasText: 'A future title' })

  await currentEpisode.getByRole('button', {
    name: 'Watched',
    exact: true
  }).click()

  await expect(second).toHaveAccessibleDescription('2 episodes · 1 watched')
  await first.focus()
  await page.keyboard.press('Enter')
  await expect(first).toBeFocused()
  await expect(first).toHaveAttribute('aria-expanded', 'true')
  await expect(second).toHaveAttribute('aria-expanded', 'false')

  await expect(episodes.getByRole('heading', {
    name: 'A future title',
    exact: true
  })).toHaveCount(0)

  await expect(first).toHaveAccessibleDescription('2 episodes · 0 watched')
  await expect(episodes.getByRole('listitem')).toHaveCount(2)
  await page.keyboard.press('Space')
  await expect(first).toHaveAttribute('aria-expanded', 'false')
  await expect(first).toBeFocused()
  await expect(episodes.getByRole('listitem')).toHaveCount(0)
  await second.click()
  await expect(second).toHaveAttribute('aria-expanded', 'true')

  await expect(episodes.getByRole('heading', {
    name: 'A future title',
    exact: true
  })).toBeVisible()

  await expect(second).toHaveAccessibleDescription('2 episodes · 1 watched')
})

test('reuses loaded season and episode ratings across season and tab disclosure', async ({ context, page }) => {
  const reads: string[] = []
  const seasonsPath = `/api/catalog/items/${episodeEdgeSeries.id}/seasons/`

  page.on('request', request => {
    reads.push(new URL(request.url()).pathname)
  })

  await addCookie(context, 'tv_session', 'e2e-session')
  await page.goto(titlePath)
  await openEpisodes(page)

  const first = page.getByRole('button', {
    name: 'Season 1',
    exact: true
  })

  const second = page.getByRole('button', {
    name: 'Season 2',
    exact: true
  })

  const firstRatings = page.getByRole('region', {
    name: 'Season 1 ratings',
    exact: true
  })

  const secondRatings = page.getByRole('region', {
    name: 'Season 2 ratings',
    exact: true
  })

  const episodeRatings = page.getByRole('region', {
    name: 'Ratings for season 2, episode 1',
    exact: true
  })

  await expect(secondRatings.getByRole('button', {
    name: 'Rate season 2',
    exact: true
  })).toBeEnabled()

  await expect(episodeRatings.getByRole('button', { name: /^Rate episode,/u })).toBeEnabled()
  await expect(episodeRatings.getByText('0 ratings', { exact: true })).toBeVisible()
  await first.click()

  await expect(firstRatings.getByRole('button', {
    name: 'Rate season 1',
    exact: true
  })).toBeEnabled()

  const initialReads = reads.filter(path => path.startsWith(seasonsPath)).toSorted()

  expect(initialReads).toHaveLength(8)
  await second.click()

  await expect(secondRatings.getByRole('button', {
    name: 'Rate season 2',
    exact: true
  })).toBeEnabled()

  await expect(episodeRatings.getByRole('button', { name: /^Rate episode,/u })).toBeEnabled()

  await page.getByRole('tab', {
    name: 'Overview',
    exact: true
  }).click()

  await openEpisodes(page)
  await expect(secondRatings.getByText('0 ratings', { exact: true })).toBeVisible()
  await expect(episodeRatings.getByText('0 ratings', { exact: true })).toBeVisible()
  expect(reads.filter(path => path.startsWith(seasonsPath)).toSorted()).toStrictEqual(initialReads)
})

test('animates season height and keeps closed contents out of keyboard and screen reader access', async ({ context, page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await addCookie(context, 'tv_session', 'e2e-session')
  await page.goto(titlePath)
  await openEpisodes(page)

  const second = page.getByRole('button', {
    name: 'Season 2',
    exact: true
  })

  const panel = page.getByRole('region', {
    name: 'Season 2',
    exact: true,
    includeHidden: true
  })

  await expect(panel.getByRole('button', {
    name: 'Rate season 2',
    exact: true
  })).toBeEnabled()

  await expect.poll(async () => panel.evaluate(element => element.getAnimations().length)).toBe(0)
  await second.focus()

  const collapse = await measureDisclosure(panel)

  expect(collapse.isAnimated).toBe(true)
  expect(collapse.during).toBeGreaterThan(0)
  expect(collapse.during).toBeLessThan(collapse.before)
  expect(collapse.after).toBe(0)
  expect(collapse.inert).toBe(true)
  expect(collapse.ariaHidden).toBe('true')

  await expect(page.getByRole('region', {
    name: 'Season 2',
    exact: true
  })).toHaveCount(0)

  await panel.locator('button').first().evaluate(element => { element.focus() })
  await expect(second).toBeFocused()

  const expand = await measureDisclosure(panel)

  expect(expand.isAnimated).toBe(true)
  expect(expand.before).toBe(0)
  expect(expand.during).toBeGreaterThan(0)
  expect(expand.during).toBeLessThan(expand.after)
  expect(expand.inert).toBe(false)
  expect(expand.ariaHidden).toBeNull()

  await expect(panel.getByRole('heading', {
    name: 'A future title',
    exact: true
  })).toBeVisible()

  await second.evaluate(async element => {
    const button = element.closest('button')

    button?.click()

    const frame = Promise.withResolvers<number>()

    globalThis.requestAnimationFrame(frame.resolve)

    await frame.promise

    button?.click()
  })

  await expect(second).toHaveAttribute('aria-expanded', 'true')
  await expect.poll(async () => panel.evaluate(element => element.getAnimations().length)).toBe(0)

  await expect(panel.getByRole('heading', {
    name: 'A future title',
    exact: true
  })).toBeVisible()
})

test('discloses seasons immediately when reduced motion is requested', async ({ context, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await addCookie(context, 'tv_session', 'e2e-session')
  await page.goto(titlePath)
  await openEpisodes(page)

  const panel = page.getByRole('region', {
    name: 'Season 2',
    exact: true,
    includeHidden: true
  })

  await expect(panel.getByRole('button', {
    name: 'Rate season 2',
    exact: true
  })).toBeEnabled()

  const collapse = await measureDisclosure(panel)

  expect(collapse.isAnimated).toBe(false)
  expect(collapse.during).toBe(0)
  expect(collapse.after).toBe(0)

  const expand = await measureDisclosure(panel)

  expect(expand.isAnimated).toBe(false)
  expect(expand.during).toBeGreaterThan(0)
  expect(expand.during).toBe(expand.after)
})
