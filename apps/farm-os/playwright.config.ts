import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

/**
 * Legacy mutating E2E for the wedge loop.
 *
 * Farm OS no longer uses the Docker-backed local Supabase stack. The global
 * setup refuses non-local Supabase URLs so this cannot reset production or a
 * shared branch by accident. Browser smoke for current review work should use
 * an already-authenticated browser/session or another explicitly approved
 * non-Docker path.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    locale: "ar-EG",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run start -- -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
