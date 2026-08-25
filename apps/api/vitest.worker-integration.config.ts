import { env } from 'node:process'
import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

const TEST_DATABASE_NAME_PATTERN = /^tv_test_[0-9a-f]{32}$/u
const databaseUrl = env.TEST_DATABASE_URL

if (databaseUrl === undefined || databaseUrl === '') {
  throw new Error('TEST_DATABASE_URL is required for Worker integration tests')
}

const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1))

if (!TEST_DATABASE_NAME_PATTERN.test(databaseName)) {
  throw new Error('Worker integration tests require a disposable test database')
}

export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        compatibilityDate: '2026-08-04',

        bindings: {
          TURNSTILE_SECRET: '1x0000000000000000000000000000000AA'
        },

        hyperdrives: {
          DATABASE: databaseUrl
        },

        ratelimits: {
          REGISTRATION_EMAIL_RATE_LIMITER: {
            namespace_id: '1001',

            simple: {
              limit: 1,
              period: 60
            }
          },

          REGISTRATION_ACTIVATION_RATE_LIMITER: {
            namespace_id: '1003',

            simple: {
              limit: 5,
              period: 60
            }
          },

          SIGN_IN_RATE_LIMITER: {
            namespace_id: '1005',

            simple: {
              limit: 5,
              period: 60
            }
          }
        }
      },

      wrangler: {
        configPath: './wrangler.jsonc'
      }
    })
  ],

  resolve: {
    alias: {
      crypto: 'node:crypto',
      dns: 'node:dns',
      events: 'node:events',
      fs: 'node:fs',
      net: 'node:net',
      path: 'node:path',
      stream: 'node:stream',
      tls: 'node:tls',
      util: 'node:util',
      'util/types': 'node:util/types'
    }
  },

  test: {
    deps: {
      optimizer: {
        ssr: {
          enabled: true,

          exclude: [
            'crypto',
            'dns',
            'events',
            'fs',
            'net',
            'path',
            'stream',
            'tls',
            'util',
            'util/types'
          ],

          include: ['pg']
        }
      }
    },

    include: [
      'src/**/__tests__/*.worker.integration.test.ts'
    ],

    testTimeout: 30_000
  }
})
