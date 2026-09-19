import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  timeout: 45_000,
  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'android-chrome', use: { ...devices['Pixel 7'], channel: 'chrome' } },
    // Canvas video capture is used only by the virtual-camera decoder fixture.
    { name: 'iphone-webkit', testIgnore: '**/qr-camera.spec.ts', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
    { name: 'desktop-chrome', testMatch: '**/organizer.spec.ts', use: { ...devices['Desktop Chrome'], channel: 'chrome' } },
  ],
  webServer: {
    command: 'npm run dev -- -p 3100 -H 127.0.0.1',
    url: 'http://127.0.0.1:3100/v2',
    reuseExistingServer: false,
    timeout: 60_000,
    env: { APP_ORIGIN: 'http://127.0.0.1:3100', ORGANIZER_PASSWORD: 'browser-test-password-only' },
  },
});
