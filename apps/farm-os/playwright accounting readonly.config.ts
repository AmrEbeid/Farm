import { defineConfig, devices } from "@playwright/test";
import {
  ACCOUNTING_E2E_SERVER_READ_ONLY_ENV,
  accountingE2EBaseUrl,
  accountingE2ESanitizedChildEnvironment,
  assertAccountingE2EInputs,
} from "./lib/accounting e2e safety";
import {
  assertNoAccountingE2ENextEnvironmentFiles,
  consumeAccountingE2EProductionAcknowledgement,
} from "./lib/accounting e2e launch safety";

const baseURL = accountingE2EBaseUrl(process.env);
assertNoAccountingE2ENextEnvironmentFiles(process.cwd());
const productionReadAcknowledged = consumeAccountingE2EProductionAcknowledgement(process.env);
assertAccountingE2EInputs(process.env, productionReadAcknowledged);
const local = new URL(baseURL);

export default defineConfig({
  testDir: "./e2e",
  testMatch: "accounting readonly.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
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
  webServer: {
    command: `npm run build && npm run start -- -p ${local.port}`,
    url: `${baseURL}/login`,
    // Never send finance-role credentials to an unknown process already occupying the port.
    reuseExistingServer: false,
    env: {
      ...accountingE2ESanitizedChildEnvironment(process.env),
      [ACCOUNTING_E2E_SERVER_READ_ONLY_ENV]: "1",
    },
    timeout: 120_000,
  },
});
