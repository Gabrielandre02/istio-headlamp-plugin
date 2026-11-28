import { defineConfig } from '@playwright/test';

// Runs against a Headlamp that is already up with the plugin and a cluster
// loaded: dev/e2e.sh starts one on the kind cluster from dev/kind-istio-ambient.sh.
// Each URL must end with a slash: the tests go to relative paths, and without
// it the last segment of a base URL (/headlamp) would be replaced.
const slash = (url: string) => (url.endsWith('/') ? url : `${url}/`);
const baseUrl = process.env.HEADLAMP_BASE_URL;

export default defineConfig({
  testDir: './tests',
  // Not *.spec/*.test: the plugin's own `npm test` (vitest) collects those
  // anywhere in the repo, and would try to run these without a browser.
  testMatch: '**/*.e2e.ts',
  timeout: 60_000,
  expect: { timeout: 20_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    viewport: { width: 1280, height: 800 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'root', use: { baseURL: slash(process.env.HEADLAMP_URL ?? 'http://localhost:4466') } },
    // Headlamp served under -base-url, to catch links that drop the base path.
    ...(baseUrl ? [{ name: 'base-url', use: { baseURL: slash(baseUrl) } }] : []),
  ],
});
