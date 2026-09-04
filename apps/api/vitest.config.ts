import { cloudflareTest } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        compatibilityDate: '2026-09-04',

        bindings: {
          TURNSTILE_SECRET: '1x0000000000000000000000000000000AA'
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
      'src/__tests__/index.test.ts'
    ]
  }
})
