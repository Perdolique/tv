import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        compatibilityDate: '2026-08-08'
      },

      wrangler: {
        configPath: './wrangler.jsonc'
      }
    })
  ],

  test: {
    include: [
      'src/__tests__/index.test.ts'
    ]
  }
})
