import { env } from 'node:process'
import { defineConfig, devices, type ReporterDescription } from '@playwright/test'
import { appBaseUrl } from './tests/playwright/constants.ts'

delete env.NO_COLOR

const isCI = Boolean(env.CI)

const reporters: ReporterDescription[] = [
  ['html', { open: 'never' }]
]

if (isCI) {
  reporters.unshift(['github'])
}

export default defineConfig({
  testDir: './tests/playwright',
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: reporters,

  use: {
    baseURL: appBaseUrl,
    screenshot: 'only-on-failure',
    trace: isCI ? 'on-first-retry' : 'retain-on-failure'
  },

  projects: [{
    name: 'chromium',

    use: {
      ...devices['Desktop Chrome']
    }
  }],

  webServer: {
    command: 'pnpm --filter @tv/web run build && wrangler dev -c apps/web/wrangler.jsonc -c tests/playwright/auth/wrangler.jsonc --port 8889',
    url: appBaseUrl,
    reuseExistingServer: false,
    timeout: 120_000,

    gracefulShutdown: {
      signal: 'SIGINT',
      timeout: 5000
    }
  }
})
