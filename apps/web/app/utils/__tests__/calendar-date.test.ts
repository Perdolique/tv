import type { CatalogReleaseItem } from '@tv/shared/catalog'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  getCalendarMonthDays,
  getCalendarReleaseRange,
  getCalendarWeekDays,
  getLocalCalendarDate,
  groupReleasesByDate,
  normalizeCalendarQuery,
  parseCalendarDate,
  shiftCalendarMonth
} from '../calendar-date.ts'

const today = '2026-09-12'

describe('calendar date parsing and normalization', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it.each(['2024-02-29', '2000-02-29', '2026-09-12'])('accepts %s', (date) => {
    expect(parseCalendarDate(date)).not.toBeNull()
  })

  it.each(['2023-02-29', '1900-02-29', '2026-04-31', '0000-01-01', '2026-9-12'])('rejects %s', (date) => {
    expect(parseCalendarDate(date)).toBeNull()
  })

  it('uses browser-local date fields without timezone conversion', () => {
    vi.stubEnv('TZ', 'Etc/GMT+8')

    const browserDate = new Date('2026-09-12T00:15:00.000Z')

    expect(getLocalCalendarDate(browserDate)).toBe('2026-09-11')
  })

  it.each([undefined, null, ['2026-10-01'], 'broken', '2026-09-11'])('canonicalizes %# to today', (value) => {
    expect(normalizeCalendarQuery(value, today)).toBe(today)
  })

  it('keeps a valid current or future date', () => {
    expect(normalizeCalendarQuery(today, today)).toBe(today)
    expect(normalizeCalendarQuery('2027-02-28', today)).toBe('2027-02-28')
  })
})

describe('calendar month calculations', () => {
  it('uses today through month end for the current month', () => {
    expect(getCalendarReleaseRange('2026-09-25', today)).toStrictEqual({
      from: today,
      to: '2026-09-30'
    })
  })

  it('uses the whole selected future month including leap day', () => {
    expect(getCalendarReleaseRange('2028-02-17', today)).toStrictEqual({
      from: '2028-02-01',
      to: '2028-02-29'
    })
  })

  it('builds six Monday-first weeks and keeps past month dates visible but unavailable', () => {
    const days = getCalendarMonthDays(today, today)

    expect(days).toHaveLength(42)
    expect(days[0]?.date).toBe('2026-08-31')
    expect(days[41]?.date).toBe('2026-10-11')

    expect(days.find(day => day.date === '2026-09-01')).toMatchObject({
      inMonth: true,
      selectable: false
    })

    expect(days.find(day => day.date === today)).toMatchObject({
      isToday: true,
      selectable: true
    })
  })

  it('builds a Monday-first compact week', () => {
    const days = getCalendarWeekDays(today, today)

    expect(days.map(day => day.date)).toStrictEqual([
      '2026-09-07',
      '2026-09-08',
      '2026-09-09',
      '2026-09-10',
      '2026-09-11',
      '2026-09-12',
      '2026-09-13'
    ])
  })

  it('clamps month navigation at month length and today', () => {
    expect(shiftCalendarMonth('2027-01-31', 1, today)).toBe('2027-02-28')
    expect(shiftCalendarMonth('2026-12-31', 1, today)).toBe('2027-01-31')
    expect(shiftCalendarMonth('2027-01-31', -1, today)).toBe('2026-12-31')
    expect(shiftCalendarMonth('2026-10-01', -1, today)).toBe(today)
    expect(shiftCalendarMonth('2026-09-20', -1, today)).toBe(today)
  })

  it('keeps the supported maximum year renderable', () => {
    const monthDays = getCalendarMonthDays('9999-12-31', today)
    const weekDays = getCalendarWeekDays('9999-12-31', today)

    expect(monthDays).toHaveLength(42)

    expect(monthDays.at(-1)).toMatchObject({
      inMonth: false,
      selectable: false,
      year: 10_000
    })

    expect(weekDays.at(-1)?.year).toBe(10_000)
    expect(shiftCalendarMonth('9999-12-31', 1, today)).toBe('9999-12-31')
  })
})

describe(groupReleasesByDate, () => {
  it('groups by calendar date and preserves separate episodes', () => {
    const item = {
      episodeNumber: 1,
      id: '01991a00-0000-7000-8000-000000000001',
      originalTitle: 'Kingdom',
      originalTitleLocale: 'en',
      posterUrl: null,
      releaseDate: '2026-10-02',
      releaseId: '01991a00-0000-7000-8000-000000000002',
      releaseYear: 2019,
      seasonNumber: 3,
      title: 'Kingdom',
      titleLocale: 'en',
      type: 'series'
    } as const satisfies CatalogReleaseItem

    const nextEpisode = {
      ...item,
      episodeNumber: null,
      releaseId: '01991a00-0000-7000-8000-000000000003',
      seasonNumber: null
    } as const satisfies CatalogReleaseItem

    const grouped = groupReleasesByDate([item, nextEpisode])

    expect(grouped.get(item.releaseDate)).toStrictEqual([item, nextEpisode])
  })
})
