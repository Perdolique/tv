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

const { default: getWatched } = await import('../items/[id]/watched.get.ts')
const { default: markWatched } = await import('../items/[id]/watched.put.ts')
const { default: unmarkWatched } = await import('../items/[id]/watched.delete.ts')

describe('catalog watched proxy routes', () => {
  beforeEach(() => {
    proxyApiRequest.mockReset()
  })

  it.each([
    {
      handler: getWatched,
      message: 'Watched status is temporarily unavailable.'
    },
    {
      handler: markWatched,
      message: 'This movie could not be marked as watched right now.'
    },
    {
      handler: unmarkWatched,
      message: 'This movie could not be unmarked right now.'
    }
  ])('forwards the event with the $message fallback', async ({ handler, message }) => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The route forwards the opaque event without reading it.
    const event = { context: {} } as H3Event
    const response = { watched: false }

    proxyApiRequest.mockResolvedValue(response)
    await expect(handler(event)).resolves.toBe(response)

    expect(proxyApiRequest).toHaveBeenCalledExactlyOnceWith(event, {
      message,
      logContext: 'catalog watched service binding request failed'
    })
  })
})
