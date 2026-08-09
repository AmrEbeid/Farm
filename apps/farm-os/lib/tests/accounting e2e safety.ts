import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACCOUNTING_E2E_ENV,
  ACCOUNTING_E2E_BROWSER_RUNTIME_ERROR,
  accountingE2EAuthOrigin,
  accountingE2EBaseUrl,
  accountingE2EBatchId,
  accountingE2ECredentials,
  accountingE2EDeniedRole,
  accountingE2EGuardedServerFetch,
  accountingE2ERequestIsReadOnly,
  accountingE2ERequestIsPasswordSignIn,
  accountingE2EServerRequestIsReadOnly,
  accountingE2ESanitizedChildEnvironment,
  accountingE2ESupabaseOrigin,
  assertAccountingE2EInputs,
  assertDistinctAccountingE2EAccounts,
  createAccountingE2ERequestPolicy,
  recordAccountingE2EBrowserRuntimeError,
  type AccountingE2EBrowserRuntimeError,
} from "../accounting e2e safety";
import {
  assertNoAccountingE2ENextEnvironmentFiles,
  consumeAccountingE2EProductionAcknowledgement,
} from "../accounting e2e launch safety";

describe("accounting read-only E2E safety", () => {
  it("records only fixed browser runtime error categories without retaining detail", () => {
    const errors: AccountingE2EBrowserRuntimeError[] = [];
    recordAccountingE2EBrowserRuntimeError(errors, ACCOUNTING_E2E_BROWSER_RUNTIME_ERROR.page);
    recordAccountingE2EBrowserRuntimeError(errors, ACCOUNTING_E2E_BROWSER_RUNTIME_ERROR.console);
    expect(errors).toEqual(["pageerror", "console:error"]);
    expect(() => recordAccountingE2EBrowserRuntimeError(errors, "private detail" as never)).toThrow(
      /unsupported browser runtime error category/i,
    );
    expect(errors).toEqual(["pageerror", "console:error"]);
  });

  it("defaults only to the local app and accepts local origins", () => {
    expect(accountingE2EBaseUrl({})).toBe("http://127.0.0.1:3100");
    expect(
      accountingE2EBaseUrl({
        [ACCOUNTING_E2E_ENV.baseUrl]: "http://localhost:3200",
      }),
    ).toBe("http://localhost:3200");
  });

  it("rejects every remote target because server-side writes cannot be contained there", () => {
    for (const value of ["https://ebeidfarm.business", "https://example.com"]) {
      expect(() => accountingE2EBaseUrl({ [ACCOUNTING_E2E_ENV.baseUrl]: value })).toThrow(
        /must use localhost/,
      );
    }
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
      expect(() => accountingE2EBaseUrl({ [ACCOUNTING_E2E_ENV.baseUrl]: value })).toThrow();
    }
  });

  it("requires an explicit UUID batch and all role credentials without exposing values", () => {
    expect(() => accountingE2EBatchId({})).toThrow(ACCOUNTING_E2E_ENV.batchId);
    expect(() => accountingE2EBatchId({ [ACCOUNTING_E2E_ENV.batchId]: "not-a-uuid" })).toThrow(/must be a UUID/);
    expect(
      accountingE2EBatchId({
        [ACCOUNTING_E2E_ENV.batchId]: "80a1051d-5bcf-504c-93cd-07206b4c59ef",
      }),
    ).toBe("80a1051d-5bcf-504c-93cd-07206b4c59ef");

    expect(() => accountingE2ECredentials({}, "owner")).toThrow(ACCOUNTING_E2E_ENV.ownerEmail);
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

  it("pins the sole password-sign-in exception to an explicit Supabase origin", () => {
    expect(() => accountingE2EAuthOrigin({})).toThrow(ACCOUNTING_E2E_ENV.authOrigin);
    expect(
      accountingE2EAuthOrigin({
        [ACCOUNTING_E2E_ENV.authOrigin]: "https://project-ref.supabase.co",
      }),
    ).toBe("https://project-ref.supabase.co");
    for (const value of [
      "https://example.com",
      "https://project-ref.supabase.co/auth/v1",
      "https://user:secret@project-ref.supabase.co",
      "http://project-ref.supabase.co",
    ]) {
      expect(() => accountingE2EAuthOrigin({ [ACCOUNTING_E2E_ENV.authOrigin]: value })).toThrow();
    }
  });

  it("requires the app data origin and approved auth origin to match", () => {
    expect(
      accountingE2ESupabaseOrigin({
        NEXT_PUBLIC_SUPABASE_URL: "https://branch-ref.supabase.co",
        [ACCOUNTING_E2E_ENV.authOrigin]: "https://branch-ref.supabase.co",
      }),
    ).toBe("https://branch-ref.supabase.co");
    expect(
      accountingE2ESupabaseOrigin({
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        [ACCOUNTING_E2E_ENV.authOrigin]: "http://127.0.0.1:54321",
      }),
    ).toBe("http://127.0.0.1:54321");
    expect(() =>
      accountingE2ESupabaseOrigin({
        NEXT_PUBLIC_SUPABASE_URL: "https://data-ref.supabase.co",
        [ACCOUNTING_E2E_ENV.authOrigin]: "https://auth-ref.supabase.co",
      }),
    ).toThrow(/must match/);
    expect(() =>
      accountingE2ESupabaseOrigin({
        NEXT_PUBLIC_SUPABASE_URL: "https://data-ref.supabase.co/rest/v1",
        [ACCOUNTING_E2E_ENV.authOrigin]: "https://data-ref.supabase.co",
      }),
    ).toThrow(/credential-free origin/);
  });

  it("fails closed on Farm production without a per-run Owner approval acknowledgement", () => {
    const production = "https://veezkmytervjnpxcrbkw.supabase.co";
    const env = {
      NEXT_PUBLIC_SUPABASE_URL: production,
      [ACCOUNTING_E2E_ENV.authOrigin]: production,
    };
    expect(() => accountingE2ESupabaseOrigin(env)).toThrow(/production reads are disabled/);
    expect(() =>
      accountingE2ESupabaseOrigin({
        ...env,
        FARM_OS_ALLOW_PRODUCTION_READONLY_E2E: "1",
      }),
    ).toThrow(/production reads are disabled/);
    expect(accountingE2ESupabaseOrigin(env, true)).toBe(production);
  });

  it("requires three distinct role accounts", () => {
    expect(() =>
      assertDistinctAccountingE2EAccounts({
        owner: { email: "same@example.test", password: "owner secret" },
        accountant: {
          email: " SAME@example.test ",
          password: "accountant secret",
        },
        denied: { email: "denied@example.test", password: "denied secret" },
      }),
    ).toThrow(/must be distinct/);
    expect(() =>
      assertDistinctAccountingE2EAccounts({
        owner: { email: "owner@example.test", password: "owner secret" },
        accountant: {
          email: "accountant@example.test",
          password: "accountant secret",
        },
        denied: { email: "denied@example.test", password: "denied secret" },
      }),
    ).not.toThrow();
  });

  it("preflights the complete launch input without retaining or exposing secrets", () => {
    expect(() => assertAccountingE2EInputs({})).toThrow(ACCOUNTING_E2E_ENV.batchId);
    expect(() =>
      assertAccountingE2EInputs({
        NEXT_PUBLIC_SUPABASE_URL: "https://project-ref.supabase.co",
        [ACCOUNTING_E2E_ENV.batchId]: "80a1051d-5bcf-504c-93cd-07206b4c59ef",
        [ACCOUNTING_E2E_ENV.authOrigin]: "https://project-ref.supabase.co",
        [ACCOUNTING_E2E_ENV.ownerEmail]: "owner@example.test",
        [ACCOUNTING_E2E_ENV.ownerPassword]: "owner secret",
        [ACCOUNTING_E2E_ENV.accountantEmail]: "accountant@example.test",
        [ACCOUNTING_E2E_ENV.accountantPassword]: "accountant secret",
        [ACCOUNTING_E2E_ENV.deniedEmail]: "denied@example.test",
        [ACCOUNTING_E2E_ENV.deniedPassword]: "denied secret",
        [ACCOUNTING_E2E_ENV.deniedRole]: "farm_manager",
      }),
    ).not.toThrow();
  });

  it("requires the denied account to name a real non-finance Farm role", () => {
    for (const role of ["farm_manager", "agri_engineer", "supervisor", "storekeeper"]) {
      expect(accountingE2EDeniedRole({ [ACCOUNTING_E2E_ENV.deniedRole]: role })).toBe(role);
    }
    for (const role of ["owner", "accountant", "", "unknown"]) {
      expect(() => accountingE2EDeniedRole({ [ACCOUNTING_E2E_ENV.deniedRole]: role })).toThrow();
    }
  });

  it("allows safe methods only to the approved app or auth origins", () => {
    const origins = ["https://ebeidfarm.business", "https://project-ref.supabase.co"];
    expect(accountingE2ERequestIsReadOnly("GET", `${origins[0]}/login`, origins)).toBe(true);
    expect(accountingE2ERequestIsReadOnly("head", `${origins[1]}/auth/v1/user`, origins)).toBe(true);
    expect(accountingE2ERequestIsReadOnly("OPTIONS", `${origins[0]}/`, origins)).toBe(true);
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(accountingE2ERequestIsReadOnly(method, `${origins[0]}/anything`, origins)).toBe(false);
    }
    for (const url of ["https://example.com/collect", "https://user:secret@ebeidfarm.business/", "not a url"]) {
      expect(accountingE2ERequestIsReadOnly("GET", url, origins)).toBe(false);
    }
  });

  it("allows exactly one structurally pinned password-sign-in request", () => {
    const origin = "https://project-ref.supabase.co";
    expect(accountingE2ERequestIsPasswordSignIn("POST", `${origin}/auth/v1/token?grant_type=password`, origin)).toBe(
      true,
    );
    for (const [method, url] of [
      ["GET", `${origin}/auth/v1/token?grant_type=password`],
      ["POST", `${origin}/auth/v1/token?grant_type=refresh_token`],
      ["POST", `${origin}/auth/v1/token?grant_type=password&next=write`],
      ["POST", "https://other.supabase.co/auth/v1/token?grant_type=password"],
      ["POST", `${origin}/rest/v1/expenses?grant_type=password`],
    ]) {
      expect(accountingE2ERequestIsPasswordSignIn(method, url, origin)).toBe(false);
    }
  });

  it("allows one password login and blocks every later mutation or foreign request", () => {
    const decide = createAccountingE2ERequestPolicy(
      "https://ebeidfarm.business",
      "https://project-ref.supabase.co",
    );
    const passwordToken = "https://project-ref.supabase.co/auth/v1/token?grant_type=password";
    expect(decide("GET", "https://ebeidfarm.business/login")).toBe("read-only");
    expect(decide("GET", "https://project-ref.supabase.co/auth/v1/user")).toBe("read-only");
    expect(decide("GET", "https://example.com/collect")).toBe("blocked");
    expect(decide("POST", passwordToken)).toBe("password-login");
    expect(decide("POST", passwordToken)).toBe("blocked");
    expect(decide("POST", "https://project-ref.supabase.co/rest/v1/expenses")).toBe("blocked");
  });

  it("allows server-side Supabase reads and only explicitly read-only RPC posts", () => {
    const origin = "https://project-ref.supabase.co";
    expect(accountingE2EServerRequestIsReadOnly("GET", `${origin}/rest/v1/expenses?select=id`, origin)).toBe(true);
    expect(
      accountingE2EServerRequestIsReadOnly("POST", `${origin}/rest/v1/rpc/fn_month_close_summary`, origin),
    ).toBe(true);
    expect(
      accountingE2EServerRequestIsReadOnly("POST", `${origin}/rest/v1/rpc/fn_pending_sale_pricing`, origin),
    ).toBe(true);
    expect(
      accountingE2EServerRequestIsReadOnly("POST", `${origin}/rest/v1/rpc/fn_open_sale_receivables`, origin),
    ).toBe(true);
    expect(
      accountingE2EServerRequestIsReadOnly("POST", `${origin}/rest/v1/rpc/fn_cost_center_reports_snapshot`, origin),
    ).toBe(true);
    expect(
      accountingE2EServerRequestIsReadOnly("POST", `${origin}/rest/v1/rpc/fn_reconciliation_acceptance_snapshot`, origin),
    ).toBe(true);
    expect(
      accountingE2EServerRequestIsReadOnly("POST", `${origin}/rest/v1/rpc/fn_payment_request_detail_snapshot`, origin),
    ).toBe(true);
    for (const [method, url] of [
      ["POST", `${origin}/rest/v1/rpc/fn_close_accounting_period`],
      ["POST", `${origin}/rest/v1/expenses`],
      ["PATCH", `${origin}/rest/v1/expenses?id=eq.1`],
      ["POST", "https://other.supabase.co/rest/v1/rpc/fn_month_close_summary"],
    ]) {
      expect(accountingE2EServerRequestIsReadOnly(method, url, origin)).toBe(false);
    }
  });

  it("enforces the server policy in the shared fetch wrapper", async () => {
    const origin = "https://project-ref.supabase.co";
    const calls: string[] = [];
    const guarded = accountingE2EGuardedServerFetch(origin, async (input) => {
      calls.push(input instanceof Request ? input.url : String(input));
      return new Response(null, { status: 204 });
    });

    await expect(guarded(`${origin}/rest/v1/expenses?select=id`)).resolves.toHaveProperty(
      "status",
      204,
    );
    await expect(
      guarded(`${origin}/auth/v1/token?grant_type=refresh_token`, { method: "POST" }),
    ).rejects.toThrow(/blocked server-side POST \/auth\/v1\/token/);
    expect(calls).toEqual([`${origin}/rest/v1/expenses?select=id`]);
  });

  it("removes every harness input from a local child server environment", () => {
    const env = {
      PATH: "/bin",
      NEXT_PUBLIC_SUPABASE_URL: "https://project-ref.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "privileged",
      DATABASE_URL: "postgres://privileged",
      ...Object.fromEntries(Object.values(ACCOUNTING_E2E_ENV).map((key) => [key, "private"])),
    };
    const sanitized = accountingE2ESanitizedChildEnvironment(env);
    expect(sanitized.PATH).toBe("/bin");
    expect(sanitized.NEXT_PUBLIC_SUPABASE_URL).toBe("https://project-ref.supabase.co");
    expect(sanitized.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe("public-anon-key");
    expect(sanitized.SUPABASE_SERVICE_ROLE_KEY).toBe("");
    expect(sanitized.DATABASE_URL).toBe("");
    for (const key of Object.values(ACCOUNTING_E2E_ENV)) {
      expect(sanitized[key]).toBe("");
    }
  });
});

describe("accounting read-only E2E launch safety", () => {
  it("refuses every Next environment file that production build or start would load", () => {
    const directory = mkdtempSync(join(realpathSync(tmpdir()), "farm-accounting-env-test-"));
    try {
      expect(() => assertNoAccountingE2ENextEnvironmentFiles(directory)).not.toThrow();
      writeFileSync(join(directory, ".env.local"), "DATABASE_URL=private\n", { mode: 0o600 });
      expect(() => assertNoAccountingE2ENextEnvironmentFiles(directory)).toThrow(/\.env\.local/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("consumes a fresh private production acknowledgement exactly once", () => {
    const directory = mkdtempSync(join(realpathSync(tmpdir()), "farm-accounting-e2e-"));
    const acknowledgementPath = join(directory, "production-read-ack.json");
    const now = Date.now();
    try {
      writeFileSync(
        acknowledgementPath,
        JSON.stringify({
          origin: "https://veezkmytervjnpxcrbkw.supabase.co",
          createdAt: now,
          nonce: randomUUID(),
        }),
        { mode: 0o600 },
      );
      const env = { [ACCOUNTING_E2E_ENV.productionAckPath]: acknowledgementPath };
      expect(consumeAccountingE2EProductionAcknowledgement(env, now)).toBe(true);
      expect(existsSync(acknowledgementPath)).toBe(false);
      expect(() => consumeAccountingE2EProductionAcknowledgement(env, now)).toThrow();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("accounting read-only E2E source contract", () => {
  const spec = readFileSync(join(process.cwd(), "e2e", "accounting readonly.spec.ts"), "utf8");
  const config = readFileSync(join(process.cwd(), "playwright accounting readonly.config.ts"), "utf8");
  const serverClient = readFileSync(join(process.cwd(), "lib", "supabase", "server.ts"), "utf8");
  const proxy = readFileSync(join(process.cwd(), "proxy.ts"), "utf8");
  const wrapper = readFileSync(
    join(process.cwd(), "scripts", "run accounting readonly e2e.mjs"),
    "utf8",
  );
  const packageJson = readFileSync(join(process.cwd(), "package.json"), "utf8");

  it("fails credentialed acceptance on browser runtime errors without retaining their text", () => {
    expect(spec).toContain("const browserRuntimeErrors = new WeakMap<BrowserContext, AccountingE2EBrowserRuntimeError[]>()");
    expect(spec).toContain('test.beforeEach(async ({ context }) =>');
    expect(spec).toContain("context.pages().forEach(install)");
    expect(spec).toContain('context.on("page", install)');
    expect(spec).toContain('recordAccountingE2EBrowserRuntimeError(errors, ACCOUNTING_E2E_BROWSER_RUNTIME_ERROR.page)');
    expect(spec).toContain('recordAccountingE2EBrowserRuntimeError(errors, ACCOUNTING_E2E_BROWSER_RUNTIME_ERROR.console)');
    expect(spec).toContain('message.type() === "error"');
    expect(spec).toContain('test.afterEach(async ({ context }) =>');
    expect(spec).toContain("expect(errors).toBeDefined()");
    expect(spec).toContain("await context.close()");
    expect(spec).toContain("expect(errors).toEqual([])");
    expect(spec.indexOf("await context.close()")).toBeLessThan(spec.indexOf("expect(errors).toEqual([])"));
    expect(spec).not.toMatch(/errors\.push\(|message\.(?:text|args|location)\(|String\(message\)|\.message\b/);
    expect(spec).not.toContain("browserRuntimeErrors.get(context) ?? []");
  });

  it("does not import privileged clients or perform direct database work", () => {
    expect(`${spec}\n${config}`).not.toMatch(
      /SUPABASE_SERVICE_ROLE_KEY|createClient\s*\(|auth\.admin|\.from\s*\(|page\.request|request\.(post|put|patch|delete)\s*\(/,
    );
  });

  it("installs the mutation guard and never interacts with financial action controls", () => {
    const functionBlock = (name: string, nextName: string) => {
      const start = spec.indexOf(`async function ${name}`);
      const endMarker = nextName.startsWith("for (") ? nextName : `async function ${nextName}`;
      const end = spec.indexOf(endMarker, start + 1);
      expect(start).toBeGreaterThanOrEqual(0);
      expect(end).toBeGreaterThan(start);
      return spec.slice(start, end);
    };
    const expectOrdered = (source: string, markers: readonly string[]) => {
      let cursor = -1;
      for (const marker of markers) {
        const index = source.indexOf(marker, cursor + 1);
        expect(index).toBeGreaterThan(cursor);
        cursor = index;
      }
    };
    const loginGoto = spec.indexOf('await gotoReadOnly(page, "/login")');
    const firstOriginCheck = spec.indexOf("expect(new URL(page.url()).origin).toBe(approvedOrigin)");
    const credentialFill = spec.indexOf('page.locator("#email").fill');
    const dashboardWait = spec.indexOf("await page.waitForURL");
    const secondOriginCheck = spec.indexOf(
      "expect(new URL(page.url()).origin).toBe(approvedOrigin)",
      firstOriginCheck + 1,
    );

    expect(spec).toContain("createAccountingE2ERequestPolicy");
    expect(spec).toContain('!== "blocked"');
    expect(spec).toContain("test.abort");
    expect(spec).toContain("route.abort");
    expect(spec).toContain("page.context().route");
    expect(loginGoto).toBeLessThan(firstOriginCheck);
    expect(firstOriginCheck).toBeLessThan(credentialFill);
    expect(dashboardWait).toBeLessThan(secondOriginCheck);
    expect(spec).toContain("assertDistinctAccountingE2EAccounts(credentialsByRole)");
    expect(spec).toContain("accountingE2EDeniedRole(process.env)");
    expect(spec).toContain("await expectAuthenticatedIdentity(page, credentialsByRole[role], roleLabels[role])");
    expect(spec).toContain("await expectAuthenticatedIdentity(page, credentialsByRole.denied, roleLabels[deniedRole])");
    expect(spec).toContain("dashboard\\/manager|m|inventory\\/dashboard");
    expect(spec).toContain('await gotoReadOnly(page, "/finance/close")');
    expect(spec).toContain('page.getByRole("heading", { name: "إقفال الشهر" })');
    expect(spec).toContain("async function verifyCostCenterReportModes(page: Page)");
    expect(spec).toContain('await gotoReadOnly(page, "/finance/reports?view=history")');
    expect(spec).toContain('name: "المصفوفة: الحساب × السنة × المركز"');
    expect(spec).toContain("`${role} can read both cost-center report modes`");
    expect(spec).toContain("page.locator('input[name=\"period_start\"]')");
    expect(spec).toContain("page.locator('input[name=\"period_end\"]')");
    for (const path of [
      "/record",
      "/approvals",
      "/reports",
      "/insights",
      "/finance/dashboard",
      "/budgets",
      "/expenses",
      "/custody",
      "/transactions",
      "/accounting",
      "/finance/accounts",
      "/finance/periods",
      "/finance/revenue-reports",
      "/finance/income-statement",
      "/finance/balance-sheet",
      "/finance/reports",
      "/finance/budget-vs-actual",
      "/finance/season",
      "/finance/custody-reports",
    ]) {
      expect(spec).toMatch(new RegExp(`\\{\\s*path:\\s*"${path.replaceAll("/", "\\/")}",\\s*heading:`));
    }
    expect(spec).toContain("await verifyAccountingReads(page, routes)");
    expect(spec).toContain("await verifyMoneyEntryForms(page)");
    expect(spec).toContain('["/record/scale", "⚖️ الميزان — تسليم حمولة"]');
    expect(spec).toContain("async function verifyStatementDownloads(page: Page)");
    expect(spec).toContain('await expectPdfDownload(page, "تنزيل حزمة PDF")');
    expect(spec).toContain('await expectPdfDownload(page, "تنزيل PDF")');
    expect(spec).toContain("expect(response.status()).toBe(200)");
    expect(spec).toContain('expect(response.headers()["content-type"]).toContain("application/pdf")');
    expect(spec).toContain('expect(response.headers()["content-disposition"]).toMatch(/^attachment;.*\\.pdf/i)');
    expect(spec).toContain("expect(prefix).toEqual([0x25, 0x50, 0x44, 0x46, 0x2d])");
    expect(spec).toContain("expect(tail.slice(-eof.length)).toEqual(eof)");
    expect(spec).toContain('"/record/expense", "/record/custody-in", "/record/collect", "/record/price"');
    expect(spec).toContain("Object.entries(DAILY_ACCOUNTING_READ_GROUPS)");
    expect(spec).toContain("Object.entries(FINANCE_ONLY_READ_GROUPS)");
    expect(spec).toContain("await test.step(`deny ${route.path}`");
    expect(config).toContain('serviceWorkers: "block"');
    expect(config).toContain('trace: "off"');
    expect(config).toContain('{ name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } }');
    expect(config).toContain('{ name: "mobile-chromium", use: { ...devices["Pixel 7"] } }');
    expect(spec).toContain("async function gotoReadOnly(page: Page, path: string)");
    expect(spec).toContain("await page.evaluate(() => document.fonts.ready)");
    expect(spec).toContain("now - stableSince >= 300");
    expect(spec).toContain("intervals: [100]");
    expect(spec).toContain("document.documentElement.clientWidth");
    expect(spec).toContain("document.documentElement.scrollWidth");
    expect(spec).toContain("document.body.scrollWidth");
    expect(spec).toContain("Math.max(widths.document, widths.body)");
    expect(spec).toContain("Math.max(widths.document, widths.body)).toBeLessThanOrEqual(widths.viewport)");
    expect(spec.match(/page\.goto\(/g)).toHaveLength(1);
    expectOrdered(functionBlock("gotoReadOnly", "login"), [
      "await page.goto(path)",
      "await expectPageFitsViewport(page)",
    ]);
    expectOrdered(functionBlock("login", "expectAuthenticatedIdentity"), [
      "await page.waitForURL",
      "expect(new URL(page.url()).origin).toBe(approvedOrigin)",
      "await expectPageFitsViewport(page)",
    ]);
    expectOrdered(functionBlock("expectAuthenticatedIdentity", "verifyMonthCloseReadOnly"), [
      'toHaveText(roleLabel)',
      "await expectPageFitsViewport(page)",
    ]);
    expectOrdered(functionBlock("verifyMonthCloseReadOnly", "verifyAccountingReads"), [
      'page.getByText("مراجعة القوائم قبل القفل", { exact: true })',
      "await expectPageFitsViewport(page)",
    ]);
    expectOrdered(functionBlock("verifyAccountingReads", "verifyFinanceRoleIdentity"), [
      'name: route.heading, exact: true })).toBeVisible()',
      "await expectPageFitsViewport(page)",
    ]);
    expectOrdered(functionBlock("verifyMoneyEntryForms", "expectPdfDownload"), [
      'page.getByText(heading, { exact: typeof heading === "string" }).first()',
      'await expect(page.locator("#w-pay")).toHaveValue(expectedPayment)',
      "await expectPageFitsViewport(page)",
    ]);
    expectOrdered(functionBlock("verifyStatementDownloads", "verifyCostCenterReportModes"), [
      'name: "تنزيل حزمة PDF", exact: true })).toBeVisible()',
      "await expectPageFitsViewport(page)",
      'await expectPdfDownload(page, "تنزيل حزمة PDF")',
      'name: "تنزيل PDF", exact: true })).toBeVisible()',
      "await expectPageFitsViewport(page)",
      'await expectPdfDownload(page, "تنزيل PDF")',
    ]);
    expectOrdered(functionBlock("verifyCostCenterReportModes", "verifyAccountingControls"), [
      'name: "ملخص سريع", exact: true',
      "await expectPageFitsViewport(page)",
      'name: "المصفوفة: الحساب × السنة × المركز"',
      "await expectPageFitsViewport(page)",
    ]);
    expectOrdered(functionBlock("verifyAccountingControls", "for (const role"), [
      'name: "دفعات التسوية"',
      "await expectPageFitsViewport(page)",
      'name: "تقرير القبول"',
      "await expectPageFitsViewport(page)",
      'toHaveValue("missing_source_amount")',
      "await expectPageFitsViewport(page)",
      'name: /تقرير قبول التسوية/',
      "await expectPageFitsViewport(page)",
    ]);
    const deniedRoutes = spec.slice(
      spec.indexOf("for (const [group, routes] of Object.entries(FINANCE_ONLY_READ_GROUPS))"),
      spec.indexOf('test("a non-finance role is denied finance-only money-entry forms"'),
    );
    expectOrdered(deniedRoutes, [
      'name: route.heading, exact: true })).toHaveCount(0)',
      "await expectPageFitsViewport(page)",
    ]);
    const deniedForms = spec.slice(
      spec.indexOf('test("a non-finance role is denied finance-only money-entry forms"'),
    );
    expectOrdered(deniedForms, [
      "await expect(page).toHaveURL",
      "await expectPageFitsViewport(page)",
    ]);
    expect(config).toContain("timeout: 180_000");
    expect(config).toContain("reuseExistingServer: false");
    expect(config).toContain("...accountingE2ESanitizedChildEnvironment(process.env)");
    expect(config).toContain("ACCOUNTING_E2E_SERVER_READ_ONLY_ENV");
    expect(config).toContain("assertNoAccountingE2ENextEnvironmentFiles(process.cwd())");
    expect(config).toContain("consumeAccountingE2EProductionAcknowledgement(process.env)");
    expect(config).toContain("npm run build && npm run start");
    expect(serverClient).toContain("accountingE2EGuardedServerFetch");
    expect(serverClient).toContain('process.env[ACCOUNTING_E2E_SERVER_READ_ONLY_ENV] === "1"');
    expect(proxy).toContain("accountingE2EGuardedServerFetch");
    expect(proxy).toContain('process.env[ACCOUNTING_E2E_SERVER_READ_ONLY_ENV] === "1"');
    expect(config.indexOf("assertAccountingE2EInputs(process.env, productionReadAcknowledged)")).toBeLessThan(
      config.indexOf("defineConfig({"),
    );
    expect(wrapper).toContain('const OWNER_APPROVAL_FLAG = "--owner-approved-production-readonly"');
    expect(wrapper).toContain("ALLOWED_ENVIRONMENT_KEYS.has(key)");
    expect(wrapper).not.toContain("{ ...process.env }");
    expect(wrapper).toContain('require.resolve("@playwright/test/cli")');
    expect(packageJson).toContain("node 'scripts/run accounting readonly e2e.mjs'");
    expect(`${config}\n${wrapper}`).not.toContain("FARM_OS_ALLOW_PRODUCTION_READONLY_E2E");
    expect(spec).not.toMatch(
      /getByRole\([^)]*(تجهيز|حفظ|تجميد|اعتماد|تنفيذ|تراجع)|getByText\([^)]*(تجهيز|حفظ|تجميد|اعتماد|تنفيذ|تراجع)/,
    );
    expect(spec).not.toMatch(/(readyButton|blockedButton)\.click|locator\([^)]*type="submit"[^)]*\)\.click/);
    expect(spec.indexOf("installRequestGuard(page)")).toBeLessThan(loginGoto);
    expect(spec).toContain('page.context().routeWebSocket("**/*"');
    expect(spec).toContain("await webSocket.close");
    expect(spec).not.toContain("webSocket.url()");
    expect(spec).toContain("await expect(readyButton).toHaveCount(1 - blockedCount)");
  });
});
