import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACCOUNTING_E2E_ENV,
  accountingE2EBaseUrl,
  accountingE2EBatchId,
  accountingE2ECredentials,
  accountingE2ERequestIsReadOnly,
  assertDistinctAccountingE2EAccounts,
} from "../accounting e2e safety";

describe("accounting read-only E2E safety", () => {
  it("defaults only to the local app and accepts local origins", () => {
    expect(accountingE2EBaseUrl({})).toBe("http://127.0.0.1:3100");
    expect(
      accountingE2EBaseUrl({
        [ACCOUNTING_E2E_ENV.baseUrl]: "http://localhost:3200",
      }),
    ).toBe("http://localhost:3200");
  });

  it("requires acknowledgement and an exact allowlist match for remote targets", () => {
    expect(() =>
      accountingE2EBaseUrl({
        [ACCOUNTING_E2E_ENV.baseUrl]: "https://ebeidfarm.business",
      }),
    ).toThrow(/Remote accounting acceptance is disabled/);
    expect(
      accountingE2EBaseUrl({
        [ACCOUNTING_E2E_ENV.baseUrl]: "https://ebeidfarm.business",
        [ACCOUNTING_E2E_ENV.allowRemote]: "1",
      }),
    ).toBe("https://ebeidfarm.business");
    expect(() =>
      accountingE2EBaseUrl({
        [ACCOUNTING_E2E_ENV.baseUrl]: "https://example.com",
        [ACCOUNTING_E2E_ENV.allowRemote]: "1",
      }),
    ).toThrow(/not allowlisted/);
  });

  it("rejects malformed, credential-bearing and path-bearing targets", () => {
    for (const value of [
      "not a url",
      "ftp://localhost",
      "http://user:secret@localhost:3100",
      "http://localhost",
      "http://localhost:3100/login",
      "http://localhost:3100/?next=/finance",
    ]) {
      expect(() =>
        accountingE2EBaseUrl({ [ACCOUNTING_E2E_ENV.baseUrl]: value }),
      ).toThrow();
    }
  });

  it("requires an explicit UUID batch and all role credentials without exposing values", () => {
    expect(() => accountingE2EBatchId({})).toThrow(ACCOUNTING_E2E_ENV.batchId);
    expect(() =>
      accountingE2EBatchId({ [ACCOUNTING_E2E_ENV.batchId]: "not-a-uuid" }),
    ).toThrow(/must be a UUID/);
    expect(
      accountingE2EBatchId({
        [ACCOUNTING_E2E_ENV.batchId]: "80a1051d-5bcf-504c-93cd-07206b4c59ef",
      }),
    ).toBe("80a1051d-5bcf-504c-93cd-07206b4c59ef");

    expect(() => accountingE2ECredentials({}, "owner")).toThrow(
      ACCOUNTING_E2E_ENV.ownerEmail,
    );
    expect(
      accountingE2ECredentials(
        {
          [ACCOUNTING_E2E_ENV.ownerEmail]: " owner@example.test ",
          [ACCOUNTING_E2E_ENV.ownerPassword]: " private value ",
        },
        "owner",
      ),
    ).toEqual({ email: "owner@example.test", password: " private value " });
  });

  it("requires three distinct role accounts", () => {
    expect(() =>
      assertDistinctAccountingE2EAccounts({
        owner: { email: "same@example.test", password: "owner secret" },
        accountant: { email: " SAME@example.test ", password: "accountant secret" },
        denied: { email: "denied@example.test", password: "denied secret" },
      }),
    ).toThrow(/must be distinct/);
    expect(() =>
      assertDistinctAccountingE2EAccounts({
        owner: { email: "owner@example.test", password: "owner secret" },
        accountant: { email: "accountant@example.test", password: "accountant secret" },
        denied: { email: "denied@example.test", password: "denied secret" },
      }),
    ).not.toThrow();
  });

  it("allows only methods that cannot mutate application or data state", () => {
    expect(accountingE2ERequestIsReadOnly("GET")).toBe(true);
    expect(accountingE2ERequestIsReadOnly("head")).toBe(true);
    expect(accountingE2ERequestIsReadOnly("OPTIONS")).toBe(true);
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(accountingE2ERequestIsReadOnly(method)).toBe(false);
    }
  });
});

describe("accounting read-only E2E source contract", () => {
  const spec = readFileSync(
    join(process.cwd(), "e2e", "accounting readonly.spec.ts"),
    "utf8",
  );
  const config = readFileSync(
    join(process.cwd(), "playwright accounting readonly.config.ts"),
    "utf8",
  );

  it("does not import privileged clients or perform direct database work", () => {
    expect(`${spec}\n${config}`).not.toMatch(
      /SUPABASE_SERVICE_ROLE_KEY|createClient\s*\(|auth\.admin|\.from\s*\(|page\.request|request\.(post|put|patch|delete)\s*\(/,
    );
  });

  it("installs the mutation guard and never interacts with financial action controls", () => {
    const loginGoto = spec.indexOf('await page.goto("/login")');
    const firstOriginCheck = spec.indexOf("expect(new URL(page.url()).origin).toBe(approvedOrigin)");
    const credentialFill = spec.indexOf('page.locator("#email").fill');
    const dashboardWait = spec.indexOf("await page.waitForURL");
    const secondOriginCheck = spec.indexOf(
      "expect(new URL(page.url()).origin).toBe(approvedOrigin)",
      firstOriginCheck + 1,
    );

    expect(spec).toContain("accountingE2ERequestIsReadOnly");
    expect(spec).toContain("test.abort");
    expect(spec).toContain("route.abort");
    expect(spec).toContain("page.context().route");
    expect(loginGoto).toBeLessThan(firstOriginCheck);
    expect(firstOriginCheck).toBeLessThan(credentialFill);
    expect(dashboardWait).toBeLessThan(secondOriginCheck);
    expect(
      spec.indexOf(
        "expect(new URL(page.url()).origin).toBe(approvedOrigin)",
        secondOriginCheck + 1,
      ),
    ).toBe(-1);
    expect(spec).toContain("assertDistinctAccountingE2EAccounts(credentialsByRole)");
    expect(spec).toContain('role === "owner" ? "المالك" : "محاسب"');
    expect(spec).toContain("dashboard\\/manager|m|inventory\\/dashboard");
    expect(spec).toContain(
      'page.getByRole("heading", { name: "مراجعة التسويات" })).toHaveCount(0)',
    );
    expect(config).toContain('serviceWorkers: "block"');
    expect(config).toContain('trace: "off"');
    expect(config).toContain("reuseExistingServer: false");
    expect(spec).not.toMatch(
      /getByRole\([^)]*(تجهيز|حفظ|تجميد|اعتماد|تنفيذ|تراجع)|getByText\([^)]*(تجهيز|حفظ|تجميد|اعتماد|تنفيذ|تراجع)/,
    );
  });
});
