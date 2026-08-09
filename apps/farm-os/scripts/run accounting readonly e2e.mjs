import { randomUUID } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const OWNER_APPROVAL_FLAG = "--owner-approved-production-readonly";
const ACK_ENV = "FARM_OS_ACCOUNTING_E2E_PRODUCTION_ACK_PATH";
const PRODUCTION_ORIGIN = "https://veezkmytervjnpxcrbkw.supabase.co";
const ALLOWED_ENVIRONMENT_KEYS = new Set([
  "CI",
  "HOME",
  "LANG",
  "LC_ALL",
  "NODE_ENV",
  "PATH",
  "SHELL",
  "TERM",
  "TMPDIR",
  "TZ",
  "USER",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "FARM_OS_ACCOUNTING_E2E_BASE_URL",
  "FARM_OS_ACCOUNTING_E2E_AUTH_ORIGIN",
  "FARM_OS_E2E_BATCH_ID",
  "FARM_OS_E2E_OWNER_EMAIL",
  "FARM_OS_E2E_OWNER_PASSWORD",
  "FARM_OS_E2E_ACCOUNTANT_EMAIL",
  "FARM_OS_E2E_ACCOUNTANT_PASSWORD",
  "FARM_OS_E2E_DENIED_EMAIL",
  "FARM_OS_E2E_DENIED_PASSWORD",
  "FARM_OS_E2E_DENIED_ROLE",
]);
const args = process.argv.slice(2);
const approvalCount = args.filter((arg) => arg === OWNER_APPROVAL_FLAG).length;

if (approvalCount > 1) {
  console.error(`${OWNER_APPROVAL_FLAG} may be supplied only once.`);
  process.exit(2);
}

const playwrightArgs = args.filter((arg) => arg !== OWNER_APPROVAL_FLAG);
const childEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => ALLOWED_ENVIRONMENT_KEYS.has(key)),
);

let acknowledgementDirectory;
try {
  if (approvalCount === 1) {
    acknowledgementDirectory = mkdtempSync(
      join(realpathSync(tmpdir()), "farm-accounting-e2e-"),
    );
    const acknowledgementPath = join(
      acknowledgementDirectory,
      "production-read-ack.json",
    );
    writeFileSync(
      acknowledgementPath,
      JSON.stringify({
        origin: PRODUCTION_ORIGIN,
        createdAt: Date.now(),
        nonce: randomUUID(),
      }),
      { mode: 0o600 },
    );
    childEnvironment[ACK_ENV] = acknowledgementPath;
  }

  const require = createRequire(import.meta.url);
  const playwrightCli = require.resolve("@playwright/test/cli");
  const result = spawnSync(
    process.execPath,
    [playwrightCli, "test", "--config=playwright accounting readonly.config.ts", ...playwrightArgs],
    { cwd: process.cwd(), env: childEnvironment, stdio: "inherit" },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  if (acknowledgementDirectory) {
    rmSync(acknowledgementDirectory, { recursive: true, force: true });
  }
}
