import { defineConfig, devices } from "@playwright/test";
import { accountingE2EBaseUrl } from "./lib/accounting e2e safety";

const baseURL = accountingE2EBaseUrl(process.env);
const local = new URL(baseURL);
const useLocalServer = local.hostname === "127.0.0.1" || local.hostname === "localhost";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "accounting readonly.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  reporter: [["list"]],
  use: {
    baseURL,
    // A trace can retain form inputs. This suite handles real role credentials, so traces stay off.
    trace: "off",
    locale: "ar-EG",
    // page.route cannot see requests owned by a service worker. Blocking service workers keeps the
    // post-login mutation guard complete instead of leaving a second network path around it.
    serviceWorkers: "block",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: useLocalServer
    ? {
        command: `npm run start -- -p ${local.port || "3100"}`,
        url: `${baseURL}/login`,
        // Never send finance-role credentials to an unknown process already occupying the port.
        reuseExistingServer: false,
        timeout: 120_000,
      }
    : undefined,
});
