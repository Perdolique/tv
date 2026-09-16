import type { H3Event } from 'h3'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { proxyApiRequest } = vi.hoisted(() => {
  return {
    proxyApiRequest: vi.fn()
  }
})

vi.mock(import('~~/server/utils/proxy-api.ts'), () => {
  return { proxyApiRequest }
})

vi.mock(import('h3'), () => {
  return {
    defineEventHandler: <Handler>(handler: Handler) => handler
  }
})

const { default: handleUpcomingReleases } = await import('../releases/upcoming.get.ts')

describe('catalog upcoming releases proxy route', () => {
  beforeEach(() => {
    proxyApiRequest.mockReset()
  })

  it('forwards the event with upcoming-release failure details', async () => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The route forwards the opaque event without reading it.
    const event = { context: {} } as H3Event

    const response = {
      items: [],
      nextCursor: null
    }

    proxyApiRequest.mockResolvedValue(response)
    await expect(handleUpcomingReleases(event)).resolves.toBe(response)

    expect(proxyApiRequest).toHaveBeenCalledExactlyOnceWith(event, {
      message: 'Your upcoming releases are temporarily unavailable.',
      logContext: 'catalog upcoming releases service binding request failed'
    })
  })
})
