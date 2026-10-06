import { describe, expect, it } from 'vitest'
import * as v from 'valibot'
import { catalogViewingCreateSchema, catalogViewingUpdateSchema } from '../catalog-viewings.ts'

const requestId = '01991a00-0000-7000-8000-000000000001'

describe('movie viewing calendar and request contracts', () => {
  it.each(['0001-01-01', '9999-12-31', '2024-02-29', '2400-02-29'])('accepts the calendar day %s unchanged', date => {
    const created = v.parse(catalogViewingCreateSchema, {
      requestId,
      mode: 'history',
      startedOn: date
    })

    const updated = v.parse(catalogViewingUpdateSchema, {
      revision: 1,
      startedOn: null,
      completedOn: date
    })

    expect(created.startedOn).toBe(date)
    expect(updated.completedOn).toBe(date)
  })

  it.each(['0000-01-01', '2023-02-29', '1900-02-29', '2024-04-31', '2024-13-01', '2024-00-01', '2024-01-00', '2024-1-01', '2024-01-01T00:00:00Z', ''])('rejects invalid calendar values %s through both public inputs', date => {
    const created = v.safeParse(catalogViewingCreateSchema, {
      requestId,
      mode: 'history',
      startedOn: date
    })

    const updated = v.safeParse(catalogViewingUpdateSchema, {
      revision: 1,
      startedOn: null,
      completedOn: date
    })

    expect(created.success).toBe(false)
    expect(updated.success).toBe(false)
  })

  it('defaults unknown dates to null, requires the current context version, and rejects owner or state overrides', () => {
    const unknown = v.parse(catalogViewingCreateSchema, {
      requestId,
      mode: 'history'
    })

    const missingVersion = v.safeParse(catalogViewingCreateSchema, {
      requestId,
      mode: 'current'
    })

    const ownerOverride = v.safeParse(catalogViewingCreateSchema, {
      requestId,
      mode: 'history',
      userId: requestId
    })

    const stateOverride = v.safeParse(catalogViewingCreateSchema, {
      requestId,
      mode: 'history',
      status: 'started'
    })

    expect(unknown).toStrictEqual({
      requestId,
      mode: 'history',
      startedOn: null,
      completedOn: null
    })

    expect(missingVersion.success).toBe(false)
    expect(ownerOverride.success).toBe(false)
    expect(stateOverride.success).toBe(false)
  })

  it('checks date order only when both dates are known and allows future days', () => {
    const reversed = v.safeParse(catalogViewingUpdateSchema, {
      revision: 1,
      startedOn: '2020-01-02',
      completedOn: '2020-01-01'
    })

    const future = v.safeParse(catalogViewingUpdateSchema, {
      revision: 1,
      startedOn: null,
      completedOn: '2099-01-01'
    })

    const invalidRevision = v.safeParse(catalogViewingUpdateSchema, {
      revision: 0,
      startedOn: null,
      completedOn: null
    })

    expect(reversed.success).toBe(false)
    expect(future.success).toBe(true)
    expect(invalidRevision.success).toBe(false)
  })
})
