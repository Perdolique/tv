import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',

    include: [
      'app/**/__tests__/*.test.ts',
      'server/**/__tests__/*.test.ts'
    ]
  }
})
