import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  ACCOUNTING_E2E_BROWSER_RUNTIME_ERROR,
  ACCOUNTING_E2E_FINANCE_DASHBOARD_HEADINGS,
  accountingE2EBaseUrl,
  accountingE2EParseCsv,
  accountingE2EAuthOrigin,
  accountingE2EBatchId,
  accountingE2ECredentials,
  accountingE2EDeniedRole,
  accountingE2ERoleLandingUrlPattern,
  accountingE2EWidthSnapshotFits,
  assertDistinctAccountingE2EAccounts,
  createAccountingE2ERequestPolicy,
  recordAccountingE2EBrowserRuntimeError,
  type AccountingE2EBrowserRuntimeError,
  type AccountingE2ECredentials,
  type AccountingE2EFarmRole,
  type AccountingE2EFinanceRole,
  type AccountingE2EWidthSnapshot,
} from "../lib/accounting e2e safety";
import { ACCEPTANCE_CSV_COLUMNS } from "../lib/reconciliation acceptance";

const approvedOrigin = accountingE2EBaseUrl(process.env);
const approvedAuthOrigin = accountingE2EAuthOrigin(process.env);
const batchId = accountingE2EBatchId(process.env);
const deniedRole = accountingE2EDeniedRole(process.env);
const deniedLandingUrl = accountingE2ERoleLandingUrlPattern(approvedOrigin, deniedRole);
const credentialsByRole = {
  owner: accountingE2ECredentials(process.env, "owner"),
  accountant: accountingE2ECredentials(process.env, "accountant"),
  denied: accountingE2ECredentials(process.env, "denied"),
} as const;
assertDistinctAccountingE2EAccounts(credentialsByRole);

const browserRuntimeErrors = new WeakMap<BrowserContext, AccountingE2EBrowserRuntimeError[]>();

test.beforeEach(async ({ context }) => {
  const errors: AccountingE2EBrowserRuntimeError[] = [];
  browserRuntimeErrors.set(context, errors);
  const install = (page: Page) => {
    page.on("pageerror", () =>
      recordAccountingE2EBrowserRuntimeError(errors, ACCOUNTING_E2E_BROWSER_RUNTIME_ERROR.page),
    );
    page.on("console", (message) => {
      if (message.type() === "error") {
        recordAccountingE2EBrowserRuntimeError(errors, ACCOUNTING_E2E_BROWSER_RUNTIME_ERROR.console);
      }
    });
  };
  context.pages().forEach(install);
  context.on("page", install);
});

test.afterEach(async ({ context }) => {
  const errors = browserRuntimeErrors.get(context);
  expect(errors).toBeDefined();
  await context.close();
  expect(errors).toEqual([]);
});

const roleLabels = {
  owner: "المالك",
  accountant: "محاسب",
  farm_manager: "مدير المزرعة",
  agri_engineer: "مهندس زراعي",
  supervisor: "مشرف ميداني",
  storekeeper: "أمين مخزن",
} as const;

const INCOME_CSV_REGRESSION_START = "2019-01-01";
const INCOME_CSV_REGRESSION_END = "2026-08-24";
const RECONCILIATION_ACCEPTANCE_EXPECTED_ROWS = 698;

// A route's heading is either shared by both finance roles, or role-specific (/finance/dashboard).
type AccountingReadRoute = {
  path: string;
  heading: string | Readonly<Record<AccountingE2EFinanceRole, string>>;
};

function routeHeading(route: AccountingReadRoute, role: AccountingE2EFinanceRole): string {
  return typeof route.heading === "string" ? route.heading : route.heading[role];
}

function routeHeadings(route: AccountingReadRoute): readonly string[] {
  return typeof route.heading === "string" ? [route.heading] : Object.values(route.heading);
}

const DAILY_ACCOUNTING_READ_GROUPS = {
  hubs: [
    { path: "/record", heading: "ماذا تريد أن تسجّل؟" },
    { path: "/approvals", heading: "راجع — ما يحتاج قرارك" },
    { path: "/reports", heading: "التقارير" },
    { path: "/insights", heading: "الرؤى" },
  ],
  money: [
    { path: "/finance/dashboard", heading: ACCOUNTING_E2E_FINANCE_DASHBOARD_HEADINGS },
    { path: "/budgets", heading: "الموازنات" },
    { path: "/expenses", heading: "المصروفات" },
    { path: "/custody", heading: "العهدة وطلبات الصرف" },
    { path: "/transactions", heading: "المعاملات" },
  ],
  ledger: [
    { path: "/accounting", heading: "المحاسبة" },
    { path: "/finance/accounts", heading: "دليل الحسابات" },
    { path: "/finance/periods", heading: "الفترات المحاسبية" },
  ],
  reports: [
    { path: "/finance/reports", heading: "تقارير مراكز التكلفة" },
    { path: "/finance/revenue-reports", heading: "تقارير الإيرادات والذمم" },
    {
      path: "/finance/income-statement",
      heading: "قائمة الدخل",
    },
    { path: "/finance/balance-sheet", heading: "قائمة المركز المالي" },
    { path: "/finance/budget-vs-actual", heading: "الموازنة مقابل الفعلي" },
    { path: "/finance/season", heading: "لوحة الموسم" },
    { path: "/finance/custody-reports", heading: "تقارير العهدة والصرف" },
  ],
} as const satisfies Record<string, readonly AccountingReadRoute[]>;

const FINANCE_ONLY_READ_GROUPS = {
  insights: [{ path: "/insights", heading: "الرؤى" }],
  money: DAILY_ACCOUNTING_READ_GROUPS.money.filter(
    ({ path }) => path !== "/finance/dashboard" && path !== "/budgets" && path !== "/expenses",
  ),
  ledger: DAILY_ACCOUNTING_READ_GROUPS.ledger,
  reports: DAILY_ACCOUNTING_READ_GROUPS.reports,
  controls: [
    { path: "/finance/reconciliation", heading: "مراجعة التسويات" },
    { path: "/finance/close", heading: "إقفال الشهر" },
  ],
} as const satisfies Record<string, readonly AccountingReadRoute[]>;

async function installRequestGuard(page: Page) {
  const decideRequest = createAccountingE2ERequestPolicy(approvedOrigin, approvedAuthOrigin);
  await page.context().route("**/*", async (route) => {
    const request = route.request();
    if (decideRequest(request.method(), request.url()) !== "blocked") {
      await route.continue();
      return;
    }
    await route.abort();
    test.abort(`Blocked non-approved ${request.method()} request during accounting acceptance.`);
  });
  await page.context().routeWebSocket("**/*", async (webSocket) => {
    await webSocket.close({ code: 1008, reason: "Accounting acceptance is HTTP read-only." });
    test.abort("Blocked WebSocket during accounting acceptance.");
  });
}

async function expectPageFitsViewport(page: Page) {
  await page.evaluate(() => document.fonts.ready);

  let previousWidths = "";
  let stableSince = 0;
  let widths: AccountingE2EWidthSnapshot = {
    viewport: 0,
    document: 0,
    body: 0,
    shellMain: null,
  };
  await expect
    .poll(
      async () => {
        widths = await page.evaluate(() => {
          const shellMain = document.querySelector<HTMLElement>(".fos-appshell__main");
          return {
            viewport: document.documentElement.clientWidth,
            document: document.documentElement.scrollWidth,
            body: document.body.scrollWidth,
            shellMain: shellMain
              ? { client: shellMain.clientWidth, scroll: shellMain.scrollWidth }
              : null,
          };
        });
        const currentWidths = JSON.stringify(widths);
        const now = Date.now();
        if (currentWidths !== previousWidths) {
          previousWidths = currentWidths;
          stableSince = now;
        }
        return (
          accountingE2EWidthSnapshotFits(widths) &&
          now - stableSince >= 300
        );
      },
      {
        message: "page width must remain stable and fit the viewport for 300ms",
        timeout: 3_000,
        intervals: [100],
      },
    )
    .toBe(true);
  expect(accountingE2EWidthSnapshotFits(widths)).toBe(true);
}

async function gotoReadOnly(page: Page, path: string) {
  await page.goto(path);
  await expectPageFitsViewport(page);
}

async function login(
  page: Page,
  credentials: AccountingE2ECredentials,
  role: AccountingE2EFarmRole,
) {
  await installRequestGuard(page);
  await gotoReadOnly(page, "/login");
  expect(new URL(page.url()).origin).toBe(approvedOrigin);
  await page.locator("#email").fill(credentials.email);
  await page.locator("#password").fill(credentials.password);
  await page.getByRole("button", { name: "دخول", exact: true }).click();
  await page.waitForURL(accountingE2ERoleLandingUrlPattern(approvedOrigin, role), { timeout: 20_000 });
  expect(new URL(page.url()).origin).toBe(approvedOrigin);
  await expectPageFitsViewport(page);
}

async function expectAuthenticatedIdentity(
  page: Page,
  credentials: AccountingE2ECredentials,
  roleLabel: string,
) {
  await gotoReadOnly(page, "/profile");
  expect(new URL(page.url()).origin).toBe(approvedOrigin);
  await expect(page.getByRole("heading", { name: "الملف الشخصي", exact: true })).toBeVisible();
  const details = page.locator("dl");
  await expect(details.locator("dt", { hasText: "البريد الإلكتروني" }).locator("+ dd")).toHaveText(
    credentials.email,
  );
  await expect(details.locator("dt", { hasText: "الدور" }).locator("+ dd")).toHaveText(roleLabel);
  await expectPageFitsViewport(page);
}

async function verifyMonthCloseReadOnly(page: Page) {
  await gotoReadOnly(page, "/finance/close");
  await expect(page).toHaveURL(/\/finance\/close(?:[/?#]|$)/);
  await expect(page.getByRole("heading", { name: "إقفال الشهر" })).toBeVisible();
  await expect(page.getByText(/الفحص يغطي الدفاتر الحية من .*؛ الأرشيف الأقدم خارج هذه اللقطة\./)).toBeVisible();
  await expect(page.getByText("قفل الفترة المحاسبية", { exact: true })).toBeVisible();

  const periodStart = page.locator('input[name="period_start"]');
  const periodEnd = page.locator('input[name="period_end"]');
  await expect(periodStart).toHaveAttribute("readonly", "");
  await expect(periodEnd).toHaveAttribute("readonly", "");
  await expect(periodStart).toHaveValue(/^\d{4}-\d{2}-01$/);
  await expect(periodEnd).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);

  const readyButton = page.getByRole("button", {
    name: "إقفال الفترة",
    exact: true,
  });
  const blockedButton = page.getByRole("button", {
    name: "عالج المعلّقات",
    exact: true,
  });
  const blockedCount = await blockedButton.count();
  expect(blockedCount).toBeLessThanOrEqual(1);
  await expect(readyButton).toHaveCount(1 - blockedCount);
  if (blockedCount === 1) {
    await expect(blockedButton).toBeDisabled();
    await expect(page.getByText("راجع قبل القفل", { exact: true })).toHaveCount(0);
  } else {
    await expect(readyButton).toBeEnabled();
    await expect(page.getByText("راجع قبل القفل", { exact: true })).toBeVisible();
  }
  await expectPageFitsViewport(page);
}

async function verifyAccountingReads(
  page: Page,
  routes: readonly AccountingReadRoute[],
  role: AccountingE2EFinanceRole,
) {
  for (const route of routes) {
    await test.step(`read ${route.path}`, async () => {
      const heading = routeHeading(route, role);
      await gotoReadOnly(page, route.path);
      expect(new URL(page.url()).origin).toBe(approvedOrigin);
      await expect(page).toHaveURL(new RegExp(`${route.path.replaceAll("/", "\\/")}(?:[/?#]|$)`));
      await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
      await expectPageFitsViewport(page);
    });
  }
}

async function verifyFinanceRoleIdentity(page: Page, role: AccountingE2EFinanceRole) {
  await login(page, credentialsByRole[role], role);
  await expectAuthenticatedIdentity(page, credentialsByRole[role], roleLabels[role]);
}

async function verifyMoneyEntryForms(page: Page) {
  const forms: ReadonlyArray<
    readonly [string, string | RegExp, ("custody" | "later")?]
  > = [
    ["/record/scale", "⚖️ الميزان — تسليم حمولة"],
    ["/record/expense?payment=custody", "سجّل مصروفًا", "custody"],
    ["/record/expense?payment=later", "سجّل مصروفًا", "later"],
    ["/record/custody-in", "استلمت عهدة من المالك"],
    ["/record/price", "حدّدت سعر بيع"],
    ["/record/collect", /حصّلت فلوسًا من عميل|لا مبيعات عليها مستحقات الآن/],
  ];
  for (const [path, heading, expectedPayment] of forms) {
    await gotoReadOnly(page, path);
    expect(new URL(page.url()).origin).toBe(approvedOrigin);
    await expect(
      page.getByText(heading, { exact: typeof heading === "string" }).first(),
    ).toBeVisible();
    if (expectedPayment) {
      await page.locator("#w-cat").fill("فحص قراءة فقط");
      await page.locator("#w-total").fill("1");
      await page.getByRole("button", { name: "التالي ←", exact: true }).click();
      await page.getByRole("button", { name: "التالي ←", exact: true }).click();
      await expect(page.locator("#w-pay")).toHaveValue(expectedPayment);
    }
    await expectPageFitsViewport(page);
  }
}

async function verifyActivePersonAttendancePicker(page: Page) {
  await gotoReadOnly(page, "/people/attendance");
  await expect(page).toHaveURL(/\/people\/attendance(?:[/?#]|$)/);
  await expect(page.getByRole("heading", { name: "تسجيل الحضور", exact: true })).toBeVisible();

  const picker = page.locator("#labor-person");
  await expect(picker).toBeVisible();
  await expect(picker.locator("option").first()).toHaveText("اختر عضو فريق");
  const optionSummary = await picker.locator("option").evaluateAll((nodes) => {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const people = nodes.slice(1);
    return {
      count: people.length,
      validIds: people.every((node) => uuid.test((node as HTMLOptionElement).value)),
      named: people.every((node) => Boolean(node.textContent?.trim())),
    };
  });
  expect(optionSummary.count).toBeGreaterThan(0);
  expect(optionSummary.validIds).toBe(true);
  expect(optionSummary.named).toBe(true);
  await expectPageFitsViewport(page);
}

async function expectPdfDownload(page: Page, linkName: string) {
  const link = page.getByRole("link", { name: linkName, exact: true });
  const href = await link.getAttribute("href");
  expect(href).not.toBeNull();
  const downloadUrl = new URL(href!, page.url()).toString();
  const [download, response] = await Promise.all([
    page.waitForEvent("download"),
    page.waitForResponse(
      (candidate) => candidate.url() === downloadUrl && candidate.request().method() === "GET",
    ),
    link.click(),
  ]);
  expect(response.status()).toBe(200);
  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toContain("application/pdf");
  expect(response.headers()["content-disposition"]).toMatch(/^attachment;.*\.pdf/i);
  expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
  const stream = await download.createReadStream();
  expect(stream).not.toBeNull();

  const prefix: number[] = [];
  const eof = [0x25, 0x25, 0x45, 0x4f, 0x46];
  const pdfWhitespace = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
  const tail: number[] = [];
  let totalBytes = 0;
  for await (const chunk of stream!) {
    const bytes = chunk as Uint8Array;
    totalBytes += bytes.length;
    for (const byte of bytes) {
      if (prefix.length === 5) break;
      prefix.push(byte);
    }
    for (const byte of bytes) {
      tail.push(byte);
      if (tail.length > 64) tail.shift();
    }
  }
  while (tail.length > 0 && pdfWhitespace.has(tail[tail.length - 1])) tail.pop();
  expect(prefix).toEqual([0x25, 0x50, 0x44, 0x46, 0x2d]);
  expect(tail.slice(-eof.length)).toEqual(eof);
  expect(totalBytes).toBeGreaterThan(1_000);
}

async function expectCsvDownloads(
  page: Page,
  expectedHeader: string,
  expectedFilenames: readonly string[],
) {
  const buttons = page.getByRole("button", { name: "تصدير CSV", exact: true });
  const count = await buttons.count();
  const observedFilenames: string[] = [];

  for (let index = 0; index < count; index += 1) {
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      buttons.nth(index).click(),
    ]);
    observedFilenames.push(download.suggestedFilename());
    const stream = await download.createReadStream();
    expect(stream).not.toBeNull();
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream!) chunks.push(chunk as Uint8Array);
    const bytes = Buffer.concat(chunks);
    const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(3));
    const [header = "", ...rows] = text.split("\r\n");
    expect({
      hasBom,
      headerMatches: header === expectedHeader,
      hasData: rows.some((row) => row.length > 0),
    }).toEqual({ hasBom: true, headerMatches: true, hasData: true });
  }

  expect({
    countMatches: observedFilenames.length === expectedFilenames.length,
    uniqueFilenames: new Set(observedFilenames).size === observedFilenames.length,
    exactFilenames: observedFilenames.every(
      (filename, index) => filename === expectedFilenames[index],
    ),
  }).toEqual({ countMatches: true, uniqueFilenames: true, exactFilenames: true });
}

async function verifyStatementDownloads(page: Page) {
  await gotoReadOnly(page, "/finance/income-statement");
  await expect(page.getByRole("link", { name: "حزمة PDF", exact: true })).toBeVisible();
  await expectPageFitsViewport(page);
  await expectPdfDownload(page, "حزمة PDF");

  await gotoReadOnly(
    page,
    `/finance/income-statement?start=${INCOME_CSV_REGRESSION_START}&end=${INCOME_CSV_REGRESSION_END}`,
  );
  const incomeStart = await page.locator('input[name="start"]').inputValue();
  const incomeEnd = await page.locator('input[name="end"]').inputValue();
  expect({
    startMatches: incomeStart === INCOME_CSV_REGRESSION_START,
    endMatches: incomeEnd === INCOME_CSV_REGRESSION_END,
  }).toEqual({ startMatches: true, endMatches: true });
  await expectCsvDownloads(
    page,
    "الحساب,الاسم,المبلغ",
    [
      `income-statement-revenue-${incomeStart}-to-${incomeEnd}.csv`,
      `income-statement-expenses-${incomeStart}-to-${incomeEnd}.csv`,
    ],
  );

  await gotoReadOnly(page, "/finance/balance-sheet");
  await expect(page.getByRole("link", { name: "PDF", exact: true })).toBeVisible();
  await expectPageFitsViewport(page);
  await expectPdfDownload(page, "PDF");
  const asOf = await page.locator('input[name="asOf"]').inputValue();
  const balanceButtons = page.getByRole("button", { name: "تصدير CSV", exact: true });
  const balanceSectionLabels = await balanceButtons.evaluateAll((nodes) =>
    nodes.map((node) => node.closest("section")?.querySelector("h2")?.textContent?.trim() ?? ""),
  );
  const balanceKindByLabel: Readonly<Record<string, string>> = {
    "الموارد": "assets",
    "الالتزامات": "liabilities",
    "حقوق المالك": "equity",
  };
  expect({
    hasSections: balanceSectionLabels.length > 0,
    uniqueSections: new Set(balanceSectionLabels).size === balanceSectionLabels.length,
    knownSections: balanceSectionLabels.every((label) => Boolean(balanceKindByLabel[label])),
    validDate: /^\d{4}-\d{2}-\d{2}$/.test(asOf),
  }).toEqual({ hasSections: true, uniqueSections: true, knownSections: true, validDate: true });
  await expectCsvDownloads(
    page,
    "الحساب,الاسم,الرصيد",
    balanceSectionLabels.map(
      (label) => `balance-sheet-${balanceKindByLabel[label]}-${asOf}.csv`,
    ),
  );
}

async function verifyCostCenterReportModes(page: Page) {
  await gotoReadOnly(page, "/finance/reports");
  await expect(page.getByRole("heading", { name: "تقارير مراكز التكلفة", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "ملخص سريع", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("المصفوفة: الحساب × السنة × المركز", { exact: true })).toHaveCount(0);
  await expectPageFitsViewport(page);

  await gotoReadOnly(page, "/finance/reports?view=history");
  await expect(page).toHaveURL(/\/finance\/reports\?view=history$/);
  await expect(page.getByRole("link", { name: "التحليل السنوي", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("heading", {
      name: "المصفوفة: الحساب × السنة × المركز",
      exact: true,
    }),
  ).toBeVisible();
  await expectPageFitsViewport(page);
}

async function verifyAccountingControls(page: Page) {
  await gotoReadOnly(page, "/finance/reconciliation");
  await expect(page.getByRole("heading", { name: "مراجعة التسويات" })).toBeVisible();
  await expect(page.getByRole("table", { name: "دفعات التسوية" })).toBeVisible();
  await expectPageFitsViewport(page);

  const detailPath = `/finance/reconciliation/${encodeURIComponent(batchId)}`;
  await gotoReadOnly(page, detailPath);
  await expect(page).toHaveURL(new RegExp(`${batchId}$`));
  await expect(page.getByText("الصفوف", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "تقرير القبول" })).toBeVisible();
  await expectPageFitsViewport(page);

  await gotoReadOnly(page, `${detailPath}?quality=missing_source_amount`);
  await expect(page).toHaveURL(/quality=missing_source_amount/);
  await expect(page.locator("#quality")).toHaveValue("missing_source_amount");
  await expectPageFitsViewport(page);

  await page.getByRole("link", { name: "تقرير القبول" }).click();
  await expect(page).toHaveURL(new RegExp(`${batchId}/acceptance$`));
  await expect(page.getByRole("heading", { name: /تقرير قبول التسوية/ })).toBeVisible();
  await expectPageFitsViewport(page);

  const reportDigest =
    (await page.getByTestId("acceptance-package-digest").textContent())?.trim() ?? "";
  const reportRowCount = Number(
    await page.getByTestId("acceptance-completeness").getAttribute("data-row-count"),
  );

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "تنزيل سجل الصفوف (CSV)" }).click(),
  ]);
  const downloadPath = await download.path();
  if (!downloadPath) throw new Error("Accounting acceptance CSV download has no local path.");
  const bytes = await readFile(downloadPath);
  const hasBom =
    bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const csv = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(3));
  const [header = [], ...rows] = accountingE2EParseCsv(csv);
  const expectedHeaders = ACCEPTANCE_CSV_COLUMNS.map(({ header: label }) => label);
  const expectedFilename =
    `reconciliation-acceptance-${batchId}-${reportDigest.slice(0, 12)}.csv`;

  // Assert aggregate evidence only. Annex cells, identifiers and financial values never enter logs.
  expect({
    digestShape: /^[0-9a-f]{64}$/.test(reportDigest),
    filenameMatches: download.suggestedFilename() === expectedFilename,
    hasBom,
    headerMatches:
      header.length === expectedHeaders.length &&
      header.every((value, index) => value === expectedHeaders[index]),
    reportRowCountMatchesExpected:
      reportRowCount === RECONCILIATION_ACCEPTANCE_EXPECTED_ROWS,
    rowCountMatchesReport: rows.length === reportRowCount,
    rowCountMatchesExpected: rows.length === RECONCILIATION_ACCEPTANCE_EXPECTED_ROWS,
    everyRowComplete: rows.every((row) => row.length === expectedHeaders.length),
    everyRowMatchesDigest: rows.every((row) => row[0] === reportDigest),
  }).toEqual({
    digestShape: true,
    filenameMatches: true,
    hasBom: true,
    headerMatches: true,
    reportRowCountMatchesExpected: true,
    rowCountMatchesReport: true,
    rowCountMatchesExpected: true,
    everyRowComplete: true,
    everyRowMatchesDigest: true,
  });

  await verifyMonthCloseReadOnly(page);
}

for (const role of ["owner", "accountant"] as const) {
  for (const [group, routes] of Object.entries(DAILY_ACCOUNTING_READ_GROUPS)) {
    test(`${role} can read the ${group} accounting routes`, async ({ page }) => {
      await verifyFinanceRoleIdentity(page, role);
      await verifyAccountingReads(page, routes, role);
    });
  }
  test(`${role} can read both cost-center report modes`, async ({ page }) => {
    await verifyFinanceRoleIdentity(page, role);
    await verifyCostCenterReportModes(page);
  });
  test(`${role} can open daily money-entry forms without submitting`, async ({ page }) => {
    await verifyFinanceRoleIdentity(page, role);
    await verifyMoneyEntryForms(page);
  });
  test(`${role} can read reconciliation and month close`, async ({ page }) => {
    await verifyFinanceRoleIdentity(page, role);
    await verifyAccountingControls(page);
  });
  test(`${role} can download the statement PDF and CSV files`, async ({ page }) => {
    await verifyFinanceRoleIdentity(page, role);
    await verifyStatementDownloads(page);
  });
}

test("owner can open the active-person attendance picker without submitting", async ({ page }) => {
  await verifyFinanceRoleIdentity(page, "owner");
  await verifyActivePersonAttendancePicker(page);
});

for (const [group, routes] of Object.entries(FINANCE_ONLY_READ_GROUPS)) {
  test(`a non-finance role is denied the ${group} accounting routes`, async ({ page }) => {
    await login(page, credentialsByRole.denied, deniedRole);
    await expectAuthenticatedIdentity(page, credentialsByRole.denied, roleLabels[deniedRole]);
    for (const route of routes) {
      await test.step(`deny ${route.path}`, async () => {
        await gotoReadOnly(page, route.path);
        await expect(page).toHaveURL(deniedLandingUrl);
        for (const heading of routeHeadings(route)) {
          await expect(page.getByRole("heading", { name: heading, exact: true })).toHaveCount(0);
        }
        await expectPageFitsViewport(page);
      });
    }
  });
}

test("a non-finance role is denied finance-only money-entry forms", async ({ page }) => {
  await login(page, credentialsByRole.denied, deniedRole);
  await expectAuthenticatedIdentity(page, credentialsByRole.denied, roleLabels[deniedRole]);
  for (const path of ["/record/expense", "/record/custody-in", "/record/collect", "/record/price"]) {
    await gotoReadOnly(page, path);
    expect(new URL(page.url()).origin).toBe(approvedOrigin);
    await expect(page).toHaveURL(deniedLandingUrl);
    await expectPageFitsViewport(page);
  }
});
