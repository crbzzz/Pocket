import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/preview',
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4310', channel: 'chrome', headless: true },
  webServer: {
    command: 'npm run dev:demo',
    url: 'http://127.0.0.1:4310/health',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
