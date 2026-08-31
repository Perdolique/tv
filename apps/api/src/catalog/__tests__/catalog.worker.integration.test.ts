import { env, exports } from 'cloudflare:workers'
import { Client } from 'pg'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashSessionToken } from '../../auth/session.ts'
import { assertDisposableTestDatabase } from '../../testing/test-database.ts'

const TEST_SESSION_TOKEN = 'c'.repeat(43)
const TEST_USER_ID = '40000000-0000-4000-8000-000000000001'
const TEST_COOKIE = `__Host-tv_session=${TEST_SESSION_TOKEN}`

interface CatalogErrorResponse {
  error: {
    code: string;
    fields?: Record<string, string>;
    message: string;
  };
}

interface CatalogSearchResponse {
  items: {
    id: string;
    originalTitle: string;
    originalTitleLocale: string;
    releaseYear: number | null;
    title: string;
    titleLocale: string;
    type: 'movie' | 'series';
  }[];
}

interface ConsoleErrorMock {
  mock: {
    calls: readonly (readonly unknown[])[];
  };
}

async function connectTestDatabase(): Promise<Client> {
  const client = new Client({ connectionString: env.DATABASE.connectionString })

  try {
    await client.connect()
    await assertDisposableTestDatabase(client)

    return client
  } catch (error) {
    await client.end()

    throw error
  }
}

async function catalogRequest(
  path: string,
  cookie: string | null = TEST_COOKIE
): Promise<Response> {
  const headers = new Headers()

  if (cookie !== null) {
    headers.set('Cookie', cookie)
  }

  return exports.default.fetch(new Request(
    `https://tv-api.test${path}`,
    { headers }
  ))
}

async function resetTestSession(tokenHash: string): Promise<void> {
  const client = await connectTestDatabase()

  try {
    await client.query('DELETE FROM users WHERE id = $1', [TEST_USER_ID])
    await client.query(`
      INSERT INTO users (id, email)
      VALUES ($1, 'catalog-search@example.com')
    `, [TEST_USER_ID])
    await client.query(`
      INSERT INTO sessions (user_id, token_hash, expires_at)
      VALUES ($1, $2, now() + interval '30 days')
    `, [TEST_USER_ID, tokenHash])
  } finally {
    await client.end()
  }
}

async function expireTestSession(): Promise<void> {
  const client = await connectTestDatabase()

  try {
    await client.query(`
      UPDATE sessions
      SET expires_at = now() - interval '1 second'
      WHERE user_id = $1
    `, [TEST_USER_ID])
  } finally {
    await client.end()
  }
}

async function requestWithUnavailableCatalogTitles(): Promise<Response> {
  const client = await connectTestDatabase()

  await client.query(`
    ALTER TABLE catalog_item_titles
    RENAME TO catalog_item_titles_unavailable
  `)

  try {
    return await catalogRequest('/api/catalog/search?query=private-search-text')
  } finally {
    await client.query(`
      ALTER TABLE catalog_item_titles_unavailable
      RENAME TO catalog_item_titles
    `)
    await client.end()
  }
}

async function requestWithBrokenCatalogItem(catalogItemId: string): Promise<Response> {
  const client = await connectTestDatabase()

  await client.query(`
    INSERT INTO catalog_items (id, type)
    VALUES ($1, 'movie')
  `, [catalogItemId])
  await client.query(`
    INSERT INTO catalog_item_titles (catalog_item_id, locale, title, is_original)
    VALUES ($1, 'en', 'Broken catalog invariant', false)
  `, [catalogItemId])

  try {
    return await catalogRequest(
      '/api/catalog/search?query=Broken%20catalog%20invariant'
    )
  } finally {
    await client.query('DELETE FROM catalog_items WHERE id = $1', [catalogItemId])
    await client.end()
  }
}

function expectNoStore(response: Response): void {
  expect(response.headers.get('cache-control')).toBe('no-store')
}

function readStructuredErrorLogs(consoleError: ConsoleErrorMock): unknown[] {
  return consoleError.mock.calls.map((parameters) => {
    expect(parameters).toHaveLength(1)

    const [serializedError] = parameters

    if (typeof serializedError !== 'string') {
      throw new TypeError('Expected a serialized structured error')
    }

    return JSON.parse(serializedError) as unknown
  })
}

describe('catalog search Worker contract', () => {
  beforeEach(async () => {
    const tokenHash = await hashSessionToken(TEST_SESSION_TOKEN)

    await resetTestSession(tokenHash)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('requires a valid session and clears a malformed cookie', async () => {
    const missingResponse = await catalogRequest(
      '/api/catalog/search?query=dead',
      null
    )

    const malformedResponse = await catalogRequest(
      '/api/catalog/search?query=dead',
      '__Host-tv_session=malformed'
    )

    expect(missingResponse.status).toBe(401)
    expect(missingResponse.headers.get('set-cookie')).toBeNull()
    await expect(missingResponse.json()).resolves.toStrictEqual({
      error: {
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Authentication is required.'
      }
    })
    expect(malformedResponse.status).toBe(401)
    expect(malformedResponse.headers.get('set-cookie')).toContain('Max-Age=0')
    expectNoStore(missingResponse)
    expectNoStore(malformedResponse)
  })

  it('rejects an expired session and clears its cookie', async () => {
    await expireTestSession()

    const response = await catalogRequest('/api/catalog/search?query=dead')

    expect(response.status).toBe(401)
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
    expectNoStore(response)
  })

  it('returns field errors for an empty query and invalid title locale', async () => {
    const emptyQueryResponse = await catalogRequest('/api/catalog/search?query=%20')

    const invalidLocaleResponse = await catalogRequest(
      '/api/catalog/search?query=dead&titleLocale=not_a_locale'
    )

    expect(emptyQueryResponse.status).toBe(400)
    await expect(emptyQueryResponse.json()).resolves.toStrictEqual({
      error: {
        code: 'INVALID_REQUEST',

        fields: {
          query: 'Enter a search query.'
        },

        message: 'The request is invalid.'
      }
    })
    expect(invalidLocaleResponse.status).toBe(400)
    await expect(invalidLocaleResponse.json()).resolves.toStrictEqual({
      error: {
        code: 'INVALID_REQUEST',

        fields: {
          titleLocale: 'Use a valid BCP 47 locale.'
        },

        message: 'The request is invalid.'
      }
    })
    expectNoStore(emptyQueryResponse)
    expectNoStore(invalidLocaleResponse)
  })

  it('returns the requested title locale and its fallback', async () => {
    const russianResponse = await catalogRequest(
      '/api/catalog/search?query=dead&titleLocale=ru-RU'
    )

    const englishFallbackResponse = await catalogRequest(
      '/api/catalog/search?query=мертвец&titleLocale=de-DE'
    )

    const russianBody = await russianResponse.json<CatalogSearchResponse>()
    const fallbackBody = await englishFallbackResponse.json<CatalogSearchResponse>()

    expect(russianResponse.status).toBe(200)
    expect(russianBody.items).toStrictEqual([
      {
        id: '10000000-0000-4000-8000-000000000002',
        originalTitle: 'Dead Man',
        originalTitleLocale: 'en',
        releaseYear: 1995,
        title: 'Мертвец',
        titleLocale: 'ru',
        type: 'movie'
      }
    ])
    expect(englishFallbackResponse.status).toBe(200)
    expect(fallbackBody.items[0]).toMatchObject({
      title: 'Dead Man',
      titleLocale: 'en'
    })
    expectNoStore(russianResponse)
    expectNoStore(englishFallbackResponse)
  })

  it('returns an empty array when no titles match', async () => {
    const response = await catalogRequest('/api/catalog/search?query=unknown-title')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toStrictEqual({ items: [] })
    expectNoStore(response)
  })

  it('returns a safe 503 and logs the raw database error without the query', async () => {
    const consoleError = vi.spyOn(console, 'error').mockReturnValue()
    const response = await requestWithUnavailableCatalogTitles()
    const body = await response.json<CatalogErrorResponse>()
    const logs = JSON.stringify(readStructuredErrorLogs(consoleError))

    expect(response.status).toBe(503)
    expect(body).toStrictEqual({
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Catalog search is temporarily unavailable.'
      }
    })
    expect(logs).toContain('catalog_item_titles')
    expect(logs).toContain('requestId')
    expect(logs).not.toContain('private-search-text')
    expectNoStore(response)
  })

  it('returns a safe 500 for an unexpected catalog invariant failure', async () => {
    const catalogItemId = '40000000-0000-4000-8000-000000000002'
    const consoleError = vi.spyOn(console, 'error').mockReturnValue()
    const response = await requestWithBrokenCatalogItem(catalogItemId)
    const logs = JSON.stringify(readStructuredErrorLogs(consoleError))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toStrictEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred.'
      }
    })
    expect(logs).toContain(`Catalog item ${catalogItemId} has no original title`)
    expectNoStore(response)
  })
})
