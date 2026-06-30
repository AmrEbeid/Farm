import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

/** Minimal .env.local loader (no dotenv dependency). */
function loadEnvLocal() {
  const file = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadEnvLocal();

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const ORG = "00000000-0000-0000-0000-000000000001";
const POTASSIUM = "39e22867-fbe2-5cd9-8a76-ce5871a8e8f4";
const FERT_OP = "37c9cce6-6ec4-570a-97a4-b263e2faf5d0";
const PLAN = "5d5d302e-c385-5d0b-94f5-3dc2c9948e79";

const SEED_PASSWORD = "farm-os-pilot";
const SEED_USERS = [
  { role: "owner", email: "owner@ebeid.test", phone: "+201000000001", name: "عمرو عبيد" },
  { role: "farm_manager", email: "manager@ebeid.test", phone: "+201000000002", name: "عبد الجليل أسامة" },
  { role: "agri_engineer", email: "engineer@ebeid.test", phone: "+201000000003", name: "حسام زكي" },
  { role: "accountant", email: "accountant@ebeid.test", phone: "+201000000004", name: "أحمد ماهر" },
  { role: "supervisor", email: "supervisor@ebeid.test", phone: "+201000000005", name: "السيد أبو أحمد" },
  { role: "storekeeper", email: "storekeeper@ebeid.test", phone: "+201000000006", name: "أمين المخزن" },
];

/* eslint-disable @typescript-eslint/no-explicit-any */
type Admin = any;

async function findByEmail(admin: Admin, email: string): Promise<string | null> {
  // page through all users (handles >perPage and any pagination quirk)
  for (let page = 1; page <= 10; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    const users = data?.users ?? [];
    const hit = users.find((x: { email?: string }) => x.email?.toLowerCase() === email);
    if (hit) return hit.id;
    if (users.length < 100) break;
  }
  return null;
}

async function ensureUsers(admin: Admin) {
  for (const u of SEED_USERS) {
    let id: string | null = await findByEmail(admin, u.email);
    if (id) {
      await admin.auth.admin.updateUserById(id, { password: SEED_PASSWORD });
    } else {
      const { data: created, error } = await admin.auth.admin.createUser({
        email: u.email,
        password: SEED_PASSWORD,
        email_confirm: true,
        user_metadata: { name: u.name, role: u.role },
      });
      if (error || !created?.user) {
        // race / already-exists: fall back to lookup
        id = await findByEmail(admin, u.email);
        if (!id) throw new Error(`createUser ${u.email}: ${error?.message}`);
      } else {
        id = created.user.id;
      }
    }
    await admin.from("people").update({ user_id: id }).eq("phone", u.phone);
    await admin.from("organization_member").delete().eq("org_id", ORG).eq("role", u.role);
    await admin.from("organization_member").insert({ org_id: ORG, user_id: id, role: u.role });
  }
}

/** Reset the loop-mutated state so the e2e is repeatable. */
async function resetLoopState(admin: Admin) {
  // remove any PRs/items created by prior runs
  const { data: prs } = await admin.from("purchase_requests").select("id");
  for (const pr of prs ?? []) {
    await admin.from("purchase_request_items").delete().eq("pr_id", pr.id);
  }
  await admin.from("purchase_requests").delete().eq("org_id", ORG);

  // remove loop-created farm_events + their children
  const { data: events } = await admin.from("farm_event").select("id").eq("plan_id", PLAN);
  for (const ev of events ?? []) {
    await admin.from("quantities").delete().eq("event_id", ev.id);
    await admin.from("event_locations").delete().eq("event_id", ev.id);
  }
  await admin.from("farm_event").delete().eq("plan_id", PLAN);

  // remove movements created by the loop (keep the opening-balance receipt on 2025-06-01)
  await admin
    .from("inventory_movements")
    .delete()
    .eq("item_id", POTASSIUM)
    .in("type", ["reserve", "release", "issue", "receipt"])
    .neq("occurred_at", "2025-06-01T00:00:00+00:00");
  // be safe: delete any receipt that is not the opening balance
  await admin
    .from("inventory_movements")
    .delete()
    .eq("item_id", POTASSIUM)
    .gt("occurred_at", "2025-06-02T00:00:00+00:00");

  // reset the bin to seed values
  await admin
    .from("inventory_bin")
    .update({ on_hand: 300, reserved: 0, ordered: 0, projected: 300 })
    .eq("item_id", POTASSIUM)
    .eq("location", "main");

  // reset the fertilization op + drop any extra ops created by the builder
  await admin.from("plan_operations").update({ status: "planned" }).eq("id", FERT_OP);
  await admin
    .from("plan_operations")
    .delete()
    .eq("plan_id", PLAN)
    .not("id", "in", `(${FERT_OP},51c53834-b97d-58fa-8721-3b4c269c7633,9175e5ce-3b3c-582d-8bd3-f23c6cc6f119)`);
}

export default async function globalSetup() {
  const local = URL.includes("127.0.0.1") || URL.includes("localhost");
  if (!local || process.env.FARM_OS_ALLOW_LOCAL_E2E_RESET !== "1") {
    throw new Error(
      "Refusing mutating Playwright setup. This legacy wedge loop may only run against an explicitly approved local target with FARM_OS_ALLOW_LOCAL_E2E_RESET=1.",
    );
  }
  const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
  await ensureUsers(admin);
  await resetLoopState(admin);
}
