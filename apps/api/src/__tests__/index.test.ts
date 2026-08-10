import { exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

describe('get /health contract', () => {
  it('returns the API health contract', async () => {
    const response = await exports.default.fetch(
      new Request('https://tv-api.test/health')
    )
    const body: unknown = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(body).toStrictEqual({
      status: 'ok',
      service: 'tv-api'
    })
  })
})
