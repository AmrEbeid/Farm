import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { ExpenseWizard } from "@/components/ExpenseWizard";

// SPEC-0025 U-1 — the guided expense flow's loader. Pulls everything the wizard's pickers need in one
// round: suppliers, active LEAF expense accounts (grouped by kind), active LEAF cost centers, and active
// custody accounts. finance.read RLS gates the account/center reads in the DB; the page itself is
// role-gated to the budget.write pair so every step of the wizard is actually usable.

export const dynamic = "force-dynamic";

export default async function RecordExpensePage({
  searchParams,
}: {
  searchParams: Promise<{ payment?: string }>;
}) {
  const membership = await requireRole(["owner", "accountant"]);
  const { payment } = await searchParams;
  const initialPayment = payment === "later" ? "later" : "custody";
  const sb = await createClient();

  const [suppliersRes, accountsRes, centersRes, custodyRes] = await Promise.all([
    sb.from("suppliers").select("id, name").eq("org_id", membership.orgId).order("name"),
    sb
      .from("accounts")
      .select("id, code, name_ar, account_type, kind, parent_id, active")
      .eq("org_id", membership.orgId)
      .order("code"),
    sb
      .from("cost_centers")
      .select("id, code, name_ar, parent_id, active")
      .eq("org_id", membership.orgId)
      .order("code"),
    sb
      .from("custody_accounts")
      .select("id, holder_label, active")
      .eq("org_id", membership.orgId)
      .order("holder_label"),
  ]);

  const loadError = suppliersRes.error ?? accountsRes.error ?? centersRes.error ?? custodyRes.error;
  if (loadError) throw new Error("تعذّر تحميل بيانات تسجيل المصروف");

  // Leaf = active with no active children (the only valid posting/allocation targets).
  const accountRows = accountsRes.data ?? [];
  const activeAccountParents = new Set(accountRows.filter((a) => a.active && a.parent_id).map((a) => a.parent_id as string));
  const leafExpenseAccounts = accountRows
    .filter((a) => a.active && a.account_type === "expense" && !activeAccountParents.has(a.id))
    .map((a) => ({ id: a.id, code: a.code, nameAr: a.name_ar, kind: a.kind as string | null }));

  const centerRows = centersRes.data ?? [];
  const activeCenterParents = new Set(centerRows.filter((c) => c.active && c.parent_id).map((c) => c.parent_id as string));
  const leafCenters = centerRows
    .filter((c) => c.active && !activeCenterParents.has(c.id))
    .map((c) => ({ id: c.id, code: c.code, nameAr: c.name_ar }));

  return (
    <div className="p-6">
      <ExpenseWizard
        initialPayment={initialPayment}
        suppliers={(suppliersRes.data ?? []).map((s) => ({ id: s.id, name: s.name }))}
        accounts={leafExpenseAccounts}
        centers={leafCenters}
        custodyAccounts={(custodyRes.data ?? []).filter((c) => c.active).map((c) => ({ id: c.id, label: c.holder_label }))}
      />
    </div>
  );
}
