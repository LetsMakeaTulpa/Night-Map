import { defineConfig, devices } from '@playwright/test';

const PRODUCTION_URL = 'http://127.0.0.1:4173';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 12_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.BASE_URL ?? PRODUCTION_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    permissions: ['geolocation'],
    geolocation: { latitude: 37.7845, longitude: -122.4115 },
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
    },
  ],
  webServer: process.env.BASE_URL
    ? undefined
    : {
        // The suite is a production check: build the same dist the browser gets,
        // then serve it with the service worker enabled.
        command: 'npm run build && npm run preview -- --port 4173 --strictPort',
        url: PRODUCTION_URL,
        reuseExistingServer: true,
        timeout: 180_000,
      },
});
