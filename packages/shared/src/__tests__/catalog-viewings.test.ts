import { describe, expect, it } from 'vitest'
import * as v from 'valibot'

import {
  catalogHistoricalRatingSaveSchema,
  catalogRatingSaveSchema,
  catalogViewingCreateSchema,
  catalogViewingUpdateSchema
} from '../catalog-viewings.ts'

import { catalogSeriesUnwatchSchema, catalogSeriesWatchSchema } from '../catalog-series.ts'

const requestId = '01991a00-0000-7000-8000-000000000001'

const createInput = {
  requestId,
  mode: 'current',
  currentViewingId: null,
  contextVersion: 0,
  status: 'completed',
  startedOn: null,
  completedOn: '2026-10-17'
} as const

const updateInput = {
  requestId,
  revision: 1,
  currentViewingId: null,
  contextVersion: 0,
  status: 'completed',
  startedOn: null,
  completedOn: '2026-10-17'
} as const

describe('viewing calendar and mutation contracts', () => {
  it.each(['0001-01-01', '9999-12-31', '2024-02-29', '2400-02-29'])('accepts the exact calendar day %s', date => {
    const created = v.parse(catalogViewingCreateSchema, {
      ...createInput,
      completedOn: date
    })

    const updated = v.parse(catalogViewingUpdateSchema, {
      ...updateInput,
      completedOn: date
    })

    expect(created.completedOn).toBe(date)
    expect(updated.completedOn).toBe(date)
  })

  it.each(['0000-01-01', '2023-02-29', '1900-02-29', '2024-04-31', '2024-13-01', '2024-00-01', '2024-01-00', '2024-1-01', '2024-01-01T00:00:00Z', ''])('rejects invalid calendar value %s in creation and correction', completedOn => {
    expect(v.safeParse(catalogViewingCreateSchema, {
      ...createInput,
      completedOn
    }).success).toBe(false)

    expect(v.safeParse(catalogViewingUpdateSchema, {
      ...updateInput,
      completedOn
    }).success).toBe(false)
  })

  it.each([undefined, null, ''])('requires completion for a completed viewing: %s', completedOn => {
    expect(v.safeParse(catalogViewingCreateSchema, {
      ...createInput,
      completedOn
    }).success).toBe(false)

    expect(v.safeParse(catalogViewingUpdateSchema, {
      ...updateInput,
      completedOn
    }).success).toBe(false)
  })

  it('requires a start without completion for watching, orders dates and accepts future calendar dates', () => {
    const watching = {
      ...createInput,
      status: 'watching',
      startedOn: '2026-10-17',
      completedOn: null
    }

    expect(v.safeParse(catalogViewingCreateSchema, watching).success).toBe(true)

    expect(v.safeParse(catalogViewingCreateSchema, {
      ...watching,
      startedOn: null
    }).success).toBe(false)

    expect(v.safeParse(catalogViewingCreateSchema, {
      ...watching,
      completedOn: '2026-10-18'
    }).success).toBe(false)

    expect(v.safeParse(catalogViewingUpdateSchema, {
      ...updateInput,
      startedOn: '2026-10-18'
    }).success).toBe(false)

    expect(v.safeParse(catalogViewingUpdateSchema, {
      ...updateInput,
      completedOn: '2099-01-01'
    }).success).toBe(true)
  })

  it('requires operation identity, context and revision and rejects owner and unsupported status overrides', () => {
    expect(v.safeParse(catalogViewingCreateSchema, {
      ...createInput,
      requestId: undefined
    }).success).toBe(false)

    expect(v.safeParse(catalogViewingCreateSchema, {
      ...createInput,
      contextVersion: undefined
    }).success).toBe(false)

    expect(v.safeParse(catalogViewingCreateSchema, {
      ...createInput,
      currentViewingId: undefined
    }).success).toBe(false)

    expect(v.safeParse(catalogViewingCreateSchema, {
      ...createInput,
      userId: requestId
    }).success).toBe(false)

    expect(v.safeParse(catalogViewingCreateSchema, {
      ...createInput,
      score: 8
    }).success).toBe(false)

    const unknownStatus = v.safeParse(catalogViewingCreateSchema, {
      ...createInput,
      status: 'unknown',
      startedOn: '2026-10-17',
      completedOn: null
    })

    expect(unknownStatus.success).toBe(false)

    expect(v.safeParse(catalogViewingUpdateSchema, {
      ...updateInput,
      revision: 0
    }).success).toBe(false)
  })

  it.each(['paused', 'dropped'] as const)('accepts %s corrections with a start but no completion and keeps creation explicit', status => {
    const input = {
      ...updateInput,
      status,
      startedOn: '2026-10-17',
      completedOn: null
    }

    const accepted = v.safeParse(catalogViewingUpdateSchema, input)

    expect(accepted.success).toBe(true)

    const missingStart = v.safeParse(catalogViewingUpdateSchema, {
      ...input,
      startedOn: null
    })

    expect(missingStart.success).toBe(false)

    const withCompletion = v.safeParse(catalogViewingUpdateSchema, {
      ...input,
      completedOn: '2026-10-18'
    })

    expect(withCompletion.success).toBe(false)

    const missingContextVersion = v.safeParse(catalogViewingUpdateSchema, {
      ...input,
      contextVersion: undefined
    })

    expect(missingContextVersion.success).toBe(false)

    const missingCurrentViewing = v.safeParse(catalogViewingUpdateSchema, {
      ...input,
      currentViewingId: undefined
    })

    expect(missingCurrentViewing.success).toBe(false)

    const unknownStatus = v.safeParse(catalogViewingUpdateSchema, {
      ...input,
      status: 'unknown'
    })

    expect(unknownStatus.success).toBe(false)

    const creation = v.safeParse(catalogViewingCreateSchema, {
      ...createInput,
      status,
      startedOn: input.startedOn,
      completedOn: null
    })

    expect(creation.success).toBe(false)
  })

  it('uses dated, account-free current and historical rating requests for every target', () => {
    const input = {
      requestId,
      currentViewingId: null,
      contextVersion: 0,
      timeZone: 'Europe/Tallinn',
      viewingDate: '2026-10-17',
      score: 8
    }

    expect(v.parse(catalogRatingSaveSchema, input)).toStrictEqual(input)

    expect(v.safeParse(catalogRatingSaveSchema, {
      ...input,
      timeZone: 'not/a/zone'
    }).success).toBe(false)

    expect(v.safeParse(catalogRatingSaveSchema, {
      ...input,
      score: 0
    }).success).toBe(false)

    expect(v.safeParse(catalogRatingSaveSchema, {
      ...input,
      userId: requestId
    }).success).toBe(false)

    expect(v.safeParse(catalogHistoricalRatingSaveSchema, {
      requestId,
      revision: 1,
      timeZone: 'UTC',
      score: 10
    }).success).toBe(true)

    expect(v.safeParse(catalogHistoricalRatingSaveSchema, {
      requestId,
      timeZone: 'UTC',
      score: 10
    }).success).toBe(false)
  })

  it('requires watch operation identity and makes rated unwatch confirmation explicit', () => {
    expect(v.safeParse(catalogSeriesWatchSchema, {
      requestId,
      currentViewingId: null,
      contextVersion: 0,
      timeZone: 'UTC',
      viewingDate: '2026-10-17'
    }).success).toBe(true)

    const input = {
      requestId,
      currentViewingId: requestId,
      contextVersion: 1,
      watchId: requestId
    }

    expect(v.parse(catalogSeriesUnwatchSchema, input).confirmRatingRemoval).toBe(false)

    expect(v.parse(catalogSeriesUnwatchSchema, {
      ...input,
      confirmRatingRemoval: true
    }).confirmRatingRemoval).toBe(true)

    expect(v.safeParse(catalogSeriesUnwatchSchema, {
      ...input,
      requestId: undefined
    }).success).toBe(false)
  })
})
