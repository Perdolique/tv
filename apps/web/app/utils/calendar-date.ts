import type { CatalogReleaseItem } from '@tv/shared/catalog'

interface CalendarDateParts {
  day: number;
  month: number;
  year: number;
}

interface CalendarDay extends CalendarDateParts {
  date: string;
  inMonth: boolean;
  isToday: boolean;
  selectable: boolean;
}

interface CalendarReleaseRange {
  from: string;
  to: string;
}

const DATE_PATTERN = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/u
const DAYS_PER_WEEK = 7
const GRID_DAY_COUNT = 42
const MAX_CALENDAR_YEAR = 9999

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
}

function getDaysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28
  }

  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

function parseCalendarDate(value: string): CalendarDateParts | null {
  const match = DATE_PATTERN.exec(value)

  if (match?.groups === undefined) {
    return null
  }

  const year = Number(match.groups.year)
  const month = Number(match.groups.month)
  const day = Number(match.groups.day)
  const maximumDay = getDaysInMonth(year, month)

  if (year === 0 || month < 1 || month > 12 || day < 1 || day > maximumDay) {
    return null
  }

  return {
    day,
    month,
    year
  }
}

function serializeCalendarDate(parts: CalendarDateParts): string {
  const year = String(parts.year).padStart(4, '0')
  const month = String(parts.month).padStart(2, '0')
  const day = String(parts.day).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function toUtcDate(parts: CalendarDateParts): Date {
  const date = new Date(0)

  date.setUTCHours(0, 0, 0, 0)
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day)

  return date
}

function fromUtcDate(date: Date): CalendarDateParts {
  return {
    day: date.getUTCDate(),
    month: date.getUTCMonth() + 1,
    year: date.getUTCFullYear()
  }
}

function addCalendarDays(parts: CalendarDateParts, amount: number): CalendarDateParts {
  const date = toUtcDate(parts)

  date.setUTCDate(date.getUTCDate() + amount)

  return fromUtcDate(date)
}

function getLocalCalendarDate(date = new Date()): string {
  return serializeCalendarDate({
    day: date.getDate(),
    month: date.getMonth() + 1,
    year: date.getFullYear()
  })
}

// Formats stored date-only values in UTC so the viewer's timezone cannot move them to another calendar day.
function formatCalendarDateForDisplay(
  value: CalendarDay | string,
  options: Intl.DateTimeFormatOptions
): string {
  const parts = typeof value === 'string' ? parseCalendarDate(value) : value

  if (parts === null) {
    return ''
  }

  const date = toUtcDate(parts)

  const formatterOptions = {
    ...options,
    timeZone: 'UTC'
  }

  return new Intl.DateTimeFormat(undefined, formatterOptions).format(date)
}

function normalizeCalendarQuery(value: unknown, today: string): string {
  if (typeof value !== 'string' || parseCalendarDate(value) === null || value < today) {
    return today
  }

  return value
}

function getCalendarReleaseRange(selectedDate: string, today: string): CalendarReleaseRange {
  const selected = parseCalendarDate(selectedDate)
  const current = parseCalendarDate(today)

  if (selected === null || current === null) {
    throw new Error('Calendar range requires valid dates')
  }

  const monthStart = serializeCalendarDate({
    day: 1,
    month: selected.month,
    year: selected.year
  })

  const monthEnd = serializeCalendarDate({
    day: getDaysInMonth(selected.year, selected.month),
    month: selected.month,
    year: selected.year
  })

  const isCurrentMonth = selected.year === current.year && selected.month === current.month

  return {
    from: isCurrentMonth ? today : monthStart,
    to: monthEnd
  }
}

function compareCalendarDates(left: CalendarDateParts, right: CalendarDateParts): number {
  if (left.year !== right.year) {
    return left.year - right.year
  }

  if (left.month !== right.month) {
    return left.month - right.month
  }

  return left.day - right.day
}

function createCalendarDay(
  parts: CalendarDateParts,
  selected: CalendarDateParts,
  today: CalendarDateParts
): CalendarDay {
  const date = serializeCalendarDate(parts)
  const inMonth = parts.year === selected.year && parts.month === selected.month
  const isPast = compareCalendarDates(parts, today) < 0

  return {
    ...parts,
    date,
    inMonth,
    isToday: compareCalendarDates(parts, today) === 0,
    selectable: inMonth && !isPast
  }
}

function getCalendarMonthDays(selectedDate: string, today: string): CalendarDay[] {
  const selected = parseCalendarDate(selectedDate)
  const current = parseCalendarDate(today)

  if (selected === null || current === null) {
    throw new Error(`Invalid calendar date: ${selectedDate}`)
  }

  const monthStart = {
    day: 1,
    month: selected.month,
    year: selected.year
  }

  const firstWeekday = toUtcDate({
    day: 1,
    month: selected.month,
    year: selected.year
  }).getUTCDay()

  const leadingDayCount = (firstWeekday + 6) % DAYS_PER_WEEK
  const gridStart = addCalendarDays(monthStart, -leadingDayCount)

  return Array.from({ length: GRID_DAY_COUNT }, (_value, index) => {
    const parts = addCalendarDays(gridStart, index)

    return createCalendarDay(parts, selected, current)
  })
}

function getCalendarWeekDays(selectedDate: string, today: string): CalendarDay[] {
  const selected = parseCalendarDate(selectedDate)
  const current = parseCalendarDate(today)

  if (selected === null || current === null) {
    throw new Error(`Invalid calendar date: ${selectedDate}`)
  }

  const selectedWeekday = toUtcDate(selected).getUTCDay()
  const leadingDayCount = (selectedWeekday + 6) % DAYS_PER_WEEK
  const weekStart = addCalendarDays(selected, -leadingDayCount)

  return Array.from({ length: DAYS_PER_WEEK }, (_value, index) => {
    const parts = addCalendarDays(weekStart, index)

    return createCalendarDay(parts, selected, current)
  })
}

function shiftCalendarMonth(selectedDate: string, amount: number, today: string): string {
  const selected = parseCalendarDate(selectedDate)
  const current = parseCalendarDate(today)

  if (selected === null || current === null) {
    throw new Error('Calendar navigation requires valid dates')
  }

  const monthIndex = selected.month - 1 + amount
  const targetYear = selected.year + Math.floor(monthIndex / 12)
  const targetMonth = ((monthIndex % 12) + 12) % 12 + 1

  if (targetYear > MAX_CALENDAR_YEAR) {
    return selectedDate
  }

  if (targetYear < 1) {
    return today
  }

  const targetDay = Math.min(selected.day, getDaysInMonth(targetYear, targetMonth))

  const target = serializeCalendarDate({
    day: targetDay,
    month: targetMonth,
    year: targetYear
  })

  return target < today ? today : target
}

function groupReleasesByDate(items: CatalogReleaseItem[]): Map<string, CatalogReleaseItem[]> {
  const releases = new Map<string, CatalogReleaseItem[]>()

  for (const item of items) {
    const dateItems = releases.get(item.releaseDate)

    if (dateItems === undefined) {
      releases.set(item.releaseDate, [item])
    } else {
      dateItems.push(item)
    }
  }

  return releases
}

export {
  formatCalendarDateForDisplay,
  getCalendarMonthDays,
  getCalendarReleaseRange,
  getCalendarWeekDays,
  getLocalCalendarDate,
  groupReleasesByDate,
  normalizeCalendarQuery,
  parseCalendarDate,
  shiftCalendarMonth
}

export type {
  CalendarDay,
  CalendarReleaseRange
}
