import { expect, test, type Page } from "@playwright/test";
import {
  accountingE2EBaseUrl,
  accountingE2EBatchId,
  accountingE2ECredentials,
  accountingE2ERequestIsReadOnly,
  assertDistinctAccountingE2EAccounts,
  type AccountingE2ECredentials,
  type AccountingE2ERole,
} from "../lib/accounting e2e safety";

const approvedOrigin = accountingE2EBaseUrl(process.env);
const batchId = accountingE2EBatchId(process.env);
const credentialsByRole = {
  owner: accountingE2ECredentials(process.env, "owner"),
  accountant: accountingE2ECredentials(process.env, "accountant"),
  denied: accountingE2ECredentials(process.env, "denied"),
} as const;
assertDistinctAccountingE2EAccounts(credentialsByRole);

async function login(page: Page, credentials: AccountingE2ECredentials) {
  await page.goto("/login");
  expect(new URL(page.url()).origin).toBe(approvedOrigin);
  await page.locator("#email").fill(credentials.email);
  await page.locator("#password").fill(credentials.password);
  await page.getByRole("button", { name: "دخول", exact: true }).click();
  await page.waitForURL(/\/dashboard(?:[/?#]|$)/, { timeout: 20_000 });
  expect(new URL(page.url()).origin).toBe(approvedOrigin);
}

async function enforceReadOnlyRequests(page: Page) {
  await page.context().route("**/*", async (route) => {
    const request = route.request();
    if (!accountingE2ERequestIsReadOnly(request.method())) {
      await route.abort();
      test.abort(`Blocked non-read-only ${request.method()} request after authentication.`);
      return;
    }
    await route.continue();
  });
}

async function verifyFinanceRole(page: Page, role: Exclude<AccountingE2ERole, "denied">) {
  await login(page, credentialsByRole[role]);
  await enforceReadOnlyRequests(page);
  await expect(
    page.getByText(role === "owner" ? "المالك" : "محاسب", { exact: true }).first(),
  ).toBeVisible();

  await page.goto("/finance/reconciliation");
  await expect(page.getByRole("heading", { name: "مراجعة التسويات" })).toBeVisible();
  await expect(page.getByRole("table", { name: "دفعات التسوية" })).toBeVisible();

  const detailPath = `/finance/reconciliation/${encodeURIComponent(batchId)}`;
  await page.goto(detailPath);
  await expect(page).toHaveURL(new RegExp(`${batchId}$`));
  await expect(page.getByText("الصفوف", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "تقرير القبول" })).toBeVisible();

  await page.goto(`${detailPath}?quality=missing_source_amount`);
  await expect(page).toHaveURL(/quality=missing_source_amount/);
  await expect(page.locator("#quality")).toHaveValue("missing_source_amount");

  await page.getByRole("link", { name: "تقرير القبول" }).click();
  await expect(page).toHaveURL(new RegExp(`${batchId}/acceptance$`));
  await expect(page.getByRole("heading", { name: /تقرير قبول التسوية/ })).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "تنزيل سجل الصفوف (CSV)" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.csv$/i);
}

for (const role of ["owner", "accountant"] as const) {
  test(`${role} can read the complete reconciliation acceptance path`, async ({ page }) => {
    await verifyFinanceRole(page, role);
  });
}

test("a non-finance role is redirected away from reconciliation", async ({ page }) => {
  await login(page, credentialsByRole.denied);
  await enforceReadOnlyRequests(page);
  await page.goto("/finance/reconciliation");
  await expect(page).toHaveURL(/\/(?:dashboard\/manager|m|inventory\/dashboard)(?:[/?#]|$)/);
  await expect(page.getByRole("heading", { name: "مراجعة التسويات" })).toHaveCount(0);
});
