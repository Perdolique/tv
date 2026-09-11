import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    fileParallelism: false,

    include: [
      'src/**/__tests__/database.integration.test.ts'
    ],

    testTimeout: 30_000
  }
})
