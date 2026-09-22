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

const { default: getEpisodes } = await import('../items/[id]/episodes.get.ts')
const { default: getEpisodeWatches } = await import('../items/[id]/episodes/watched.get.ts')
const { default: markEpisodeWatched } = await import('../episodes/[id]/watched.put.ts')
const { default: unmarkEpisodeWatched } = await import('../episodes/[id]/watched.delete.ts')

describe('catalog episode proxy routes', () => {
  beforeEach(() => {
    proxyApiRequest.mockReset()
  })

  it.each([
    {
      handler: getEpisodes,
      logContext: 'catalog episodes service binding request failed',
      message: 'Episodes are temporarily unavailable.'
    },
    {
      handler: getEpisodeWatches,
      logContext: 'catalog episode watches service binding request failed',
      message: 'Watched episodes are temporarily unavailable.'
    },
    {
      handler: markEpisodeWatched,
      logContext: 'catalog episode watched service binding request failed',
      message: 'This episode could not be marked as watched right now.'
    },
    {
      handler: unmarkEpisodeWatched,
      logContext: 'catalog episode watched service binding request failed',
      message: 'This episode could not be unmarked right now.'
    }
  ])('forwards the event with the $message fallback', async ({ handler, logContext, message }) => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The route forwards the opaque event without reading it.
    const event = { context: {} } as H3Event
    const response = { items: [] }

    proxyApiRequest.mockResolvedValue(response)
    await expect(handler(event)).resolves.toBe(response)

    expect(proxyApiRequest).toHaveBeenCalledExactlyOnceWith(event, {
      logContext,
      message
    })
  })
})
