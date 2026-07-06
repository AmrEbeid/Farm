import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

// ---- env + admin client (verification only; the loop itself runs via the UI/RLS) ----
function env(k: string): string {
  if (process.env[k]) return process.env[k]!;
  const file = path.join(__dirname, "..", ".env.local");
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[1] === k) return m[2].replace(/^["']|["']$/g, "");
  }
  throw new Error(`missing env ${k}`);
}
const admin = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false },
});

const POTASSIUM = "39e22867-fbe2-5cd9-8a76-ce5871a8e8f4";
const PLAN = "5d5d302e-c385-5d0b-94f5-3dc2c9948e79";
const FERT_OP = "37c9cce6-6ec4-570a-97a4-b263e2faf5d0";

async function login(page: Page, email: string) {
  // global-setup already made the seeded users sign-in-able (email+password).
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", "farm-os-pilot");
  await page.getByRole("button", { name: "دخول", exact: true }).click();
  await page.waitForURL(/\/dashboard|\/m|\/inventory/, { timeout: 15_000 });
  // confirm the server sees the session (a role dashboard / mobile / inventory
  // heading renders); otherwise a later RSC nav would bounce back to /login.
  await expect(
    page.getByRole("heading", { name: /لوحة تحكم|الميدان|المخزون/ }),
  ).toBeVisible({ timeout: 15_000 });
}

async function logout(page: Page) {
  await page.getByRole("button", { name: "خروج" }).click();
  await page.waitForURL(/\/login/, { timeout: 15_000 });
}

async function bin() {
  const { data } = await admin
    .from("inventory_bin")
    .select("on_hand, reserved")
    .eq("item_id", POTASSIUM)
    .eq("location", "main")
    .single();
  return { onHand: Number(data?.on_hand), reserved: Number(data?.reserved) };
}

test("wedge loop: coverage → PR(reserve) → budget gate → owner approve → receipt → execute → PvA", async ({
  page,
}) => {
  // ---------------------------------------------------------------- step 1+2: manager sees the plan + checks
  await login(page, "manager@ebeid.test");
  await page.goto(`/plans/${PLAN}`);
  await page.getByRole("button", { name: "إعادة فحص الخطة" }).click();
  await expect(page.getByText("الخطة محظورة بفحص المخزون")).toBeVisible({ timeout: 15_000 });

  // ---------------------------------------------------------------- step 3: stock coverage shows the shortage
  await page.goto(`/inventory/${POTASSIUM}/coverage`);
  await expect(page.getByText("نقص متوقع").first()).toBeVisible();
  // available 300 and recommend 300 are rendered as Arabic-Indic numerals (٣٠٠)
  await expect(page.getByText("٣٠٠").first()).toBeVisible();

  const before = await bin();
  expect(before.onHand).toBe(300);
  expect(before.reserved).toBe(0);

  // ---------------------------------------------------------------- step 4: create PR (reserves 500)
  await page.getByRole("button", { name: "إنشاء طلب شراء" }).click();
  await page.waitForURL(/\/budget\/.*\/check/, { timeout: 15_000 });

  // reservation posted: available dropped, on_hand unchanged
  const afterReserve = await bin();
  expect(afterReserve.onHand).toBe(300);
  expect(afterReserve.reserved).toBe(500);

  // ---------------------------------------------------------------- step 5: budget gate routes to owner
  await expect(page.getByText(/تجاوز للموازنة|اعتماد المالك/)).toBeVisible();
  await expect(page.getByRole("button", { name: "تصدير CSV" })).toBeVisible();
  const [budgetDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "تصدير CSV" }).click(),
  ]);
  expect(budgetDownload.suggestedFilename()).toBe(`plan-${PLAN}-budget-check.csv`);
  const budgetDownloadPath = await budgetDownload.path();
  expect(budgetDownloadPath).toBeTruthy();
  const budgetCsv = fs.readFileSync(budgetDownloadPath!, "utf8");
  expect(budgetCsv).toContain("تكلفة هذه الخطة");
  expect(budgetCsv).toContain("السقف للمراجعة");
  expect(budgetCsv).toContain("42000");
  expect(budgetCsv).toContain("مصدر الفعلي");
  expect(budgetCsv).toContain("غير متاح");
  await page.getByRole("link", { name: "الذهاب إلى طلب الشراء للاعتماد" }).click();
  await page.waitForURL(/\/purchase-requests\//, { timeout: 15_000 });
  const prUrl = page.url();
  const prId = prUrl.split("/purchase-requests/")[1].split(/[?#]/)[0];

  // manager submits for approval (cannot self-approve)
  await page.getByRole("button", { name: "إرسال للاعتماد" }).click();
  await expect(page.getByText("مرسل").first()).toBeVisible({ timeout: 15_000 });

  // ---------------------------------------------------------------- step 6: owner approves (audit written)
  await logout(page);
  await login(page, "owner@ebeid.test");
  await page.goto(prUrl);
  await page.getByRole("button", { name: /اعتماد/ }).click();
  await expect(page.getByText("معتمد").first()).toBeVisible({ timeout: 15_000 });

  // DB: PR approved + audit_log row exists
  const { data: prRow } = await admin
    .from("purchase_requests")
    .select("status, approved_by, requested_by")
    .eq("id", prId)
    .single();
  expect(prRow?.status).toBe("approved");
  expect(prRow?.approved_by).not.toBe(prRow?.requested_by); // author ≠ approver (AP-2)
  const { count: auditCount } = await admin
    .from("audit_log")
    .select("*", { count: "exact", head: true })
    .eq("entity_type", "purchase_request")
    .eq("action", "UPDATE");
  expect(auditCount ?? 0).toBeGreaterThan(0);

  // ---------------------------------------------------------------- step 7: storekeeper receives stock
  await logout(page);
  await login(page, "storekeeper@ebeid.test");
  await page.goto(prUrl);
  await page.getByRole("button", { name: "تسجيل الاستلام" }).click();
  await expect(page.getByText("مُستلم").first()).toBeVisible({ timeout: 15_000 });

  // DB: on_hand rose by the received qty (300 → 600)
  const afterReceipt = await bin();
  expect(afterReceipt.onHand).toBe(600);

  // ---------------------------------------------------------------- step 8: supervisor executes the operation
  await logout(page);
  await login(page, "supervisor@ebeid.test");
  await page.goto(`/m/execute/${FERT_OP}`);
  await page.fill("#qty", "480");
  await page.getByRole("button", { name: "إنهاء العملية" }).click();
  await page.waitForURL(/\/m\?done=1/, { timeout: 15_000 });

  // DB: operation done, stock issued (600 - 480 = 120), reservation cleared
  const { data: opRow } = await admin
    .from("plan_operations")
    .select("status")
    .eq("id", FERT_OP)
    .single();
  expect(opRow?.status).toBe("done");
  const afterIssue = await bin();
  expect(afterIssue.onHand).toBe(120);
  expect(afterIssue.reserved).toBe(0);

  // ---------------------------------------------------------------- step 9+10: planned-vs-actual variance
  await page.goto(`/reports/${PLAN}/pva`);
  // planned 500 kg / 42,000 vs actual 480 kg / 40,320 → variance −1,680 (−4%)
  await expect(page.getByText("المخطط مقابل الفعلي").first()).toBeVisible();
  await expect(page.getByText(/١٬٦٨٠|1,680/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "تصدير CSV" })).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "تصدير CSV" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe(`plan-${PLAN}-pva.csv`);
  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  const csv = fs.readFileSync(downloadPath!, "utf8");
  expect(csv).toContain("تكلفة مخططة");
  expect(csv).toContain("42000");
  expect(csv).toContain("40320");
  expect(csv).not.toContain("تكلفة العمالة المخططة");

  // DB sanity on the recorded actuals
  const { data: ev } = await admin
    .from("farm_event")
    .select("data")
    .eq("plan_id", PLAN)
    .eq("status", "done")
    .limit(1)
    .single();
  const d = (ev?.data ?? {}) as { actual_qty?: number; actual_cost?: number };
  expect(d.actual_qty).toBe(480);
  expect(d.actual_cost).toBe(40320);
});
