import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 2,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: [
    {
      command: 'node tests/e2e/mock-api.mjs',
      url: 'http://127.0.0.1:3101/api/v1/anime/sources',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: 'bun run dev -- --host 127.0.0.1',
      url: 'http://127.0.0.1:3000',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        VITE_ANILIST_API_URL: 'http://127.0.0.1:3101/anilist',
        ANISOURCE_BASE: 'http://127.0.0.1:3101',
        // Keep overflow traffic hermetic: an unset fallback base would point
        // the mount-time warm ping at the production Render deployment.
        ANISOURCE_FALLBACK_BASE: 'http://127.0.0.1:3101',
        // Real browsers solve real challenges: keep the work trivial so the
        // journeys measure product behavior, not hashing throughput.
        ANISOURCE_POW_DIFFICULTY: '8',
      },
    },
  ],
})
