import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { Alert, Card, EmptyState } from "@/components/ui";
import { AccountsTreeManager, type AccountNode } from "@/components/AccountsTreeManager";

// SPEC-0024 S-2 — شجرة الحسابات editor. Read side: pull the org's accounts (finance.read-gated in the
// DB); this page is role-gated to owner/accountant (= budget.write) so the write actions it renders are
// usable. Subtree rollup balances live in the finance reports (S-4), not in the structure editor.

export const dynamic = "force-dynamic";

type AccountRow = {
  id: string;
  code: string;
  name_ar: string;
  account_type: string;
  normal_balance: string;
  parent_id: string | null;
  kind: string | null;
  is_system: boolean;
  sort_order: number | null;
  active: boolean;
};

export default async function AccountsPage() {
  await requireRole(["owner", "accountant"]);
  const sb = await createClient();

  const accountsRes = await sb
    .from("accounts")
    .select("id, code, name_ar, account_type, normal_balance, parent_id, kind, is_system, sort_order, active")
    .order("sort_order", { ascending: true, nullsFirst: false })
    .order("code", { ascending: true });
  if (accountsRes.error) throw accountsRes.error;

  const rows = (accountsRes.data ?? []) as AccountRow[];
  const nodes: AccountNode[] = rows.map((a) => ({
    id: a.id,
    code: a.code,
    nameAr: a.name_ar,
    accountType: a.account_type,
    normalBalance: a.normal_balance,
    parentId: a.parent_id,
    kind: a.kind,
    isSystem: a.is_system,
    sortOrder: a.sort_order,
    active: a.active,
  }));

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>
          شجرة الحسابات
        </h1>
        <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
          صنّف مصروفات وإيرادات المزرعة في شجرة قابلة للتعديل. الحسابات الأساسية للنظام يمكن إعادة تسميتها فقط.
        </p>
      </header>

      <Alert
        tone="info"
        title="الحساب المستخدم في قيد أو مصروف يُؤرشف ولا يُحذف حفاظًا على سجل القيود. الحسابات النظامية تُعاد تسميتها فقط."
      />

      <Card>
        {nodes.length === 0 ? (
          <EmptyState title="لا توجد حسابات بعد — أضف أول حساب رئيسي لبدء بناء الشجرة." />
        ) : (
          <AccountsTreeManager nodes={nodes} />
        )}
      </Card>
    </div>
  );
}
