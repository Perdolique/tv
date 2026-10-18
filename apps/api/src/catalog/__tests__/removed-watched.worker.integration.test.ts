import { exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

const removedPath = '/api/catalog/items/00000000-0000-4000-8000-000000000001/watched'

describe('removed catalog watched routes', () => {
  it.each(['GET', 'PUT', 'DELETE'])('does not expose the legacy %s contract', async (method) => {
    const input = new Request(`https://tv-api.test${removedPath}`, { method })
    const response = await exports.default.fetch(input)

    expect(response.status).toBe(404)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
})
