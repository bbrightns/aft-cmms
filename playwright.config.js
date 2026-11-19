// Browser tests (tests/e2e). The pages run against a mocked Supabase API, so no real data is touched.
// Run: npx playwright test        (CI runs it on every pull request, see .github/workflows/ci.yml)
const { defineConfig, devices } = require('@playwright/test');

const PORT = 4173;
module.exports = defineConfig({
  testDir: 'tests/e2e',
  globalSetup: require.resolve('./tests/e2e/global-setup.js'),
  timeout: 60_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: `http://localhost:${PORT}`, trace: 'off' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'phone', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
  webServer: {
    command: 'node server.js',
    env: { PORT: String(PORT) },
    url: `http://localhost:${PORT}/login.html`,
    reuseExistingServer: !process.env.CI,
  },
});
