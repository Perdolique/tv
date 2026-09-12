import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '~~': import.meta.dirname,
      '~': fileURLToPath(new URL('app', import.meta.url))
    }
  },

  test: {
    environment: 'node',

    include: [
      'app/**/__tests__/*.test.ts',
      'server/**/__tests__/*.test.ts'
    ]
  }
})
