import { requireRole } from "@/lib/auth";
import { egp, num } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { Alert, Card, EmptyState, KpiCard } from "@/components/ui";
import { AccountsTreeManager, type AccountNode } from "@/components/AccountsTreeManager";

export const dynamic = "force-dynamic";

const POSTING_KINDS = new Set(["operating", "drawing", "capex"]);

function asNumber(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export default async function AccountsPage() {
  await requireRole(["owner", "accountant"]);
  const sb = await createClient();

  const { data, error } = await sb
    .from("v_account_rollup")
    .select(
      "account_id, parent_id, code, name_ar, account_type, normal_balance, kind, active, is_system, sort_order, debit, credit, balance",
    )
    .order("sort_order", { ascending: true, nullsFirst: false })
    .order("code", { ascending: true });
  if (error) throw error;

  const rows = data ?? [];
  const activeParentIds = new Set(
    rows.flatMap((row) => (row.active && row.parent_id ? [row.parent_id] : [])),
  );
  const postingLeaves = rows.filter(
    (row) => row.active && row.kind && POSTING_KINDS.has(row.kind) && !activeParentIds.has(row.account_id),
  );
  const operatingBalance = rows
    .filter((row) => row.parent_id == null && row.kind === "operating")
    .reduce((sum, row) => sum + asNumber(row.balance), 0);
  const drawingBalance = rows
    .filter((row) => row.parent_id == null && row.kind === "drawing")
    .reduce((sum, row) => sum + asNumber(row.balance), 0);
  const capexBalance = rows
    .filter((row) => row.parent_id == null && row.kind === "capex")
    .reduce((sum, row) => sum + asNumber(row.balance), 0);

  const nodes: AccountNode[] = rows.map((row) => ({
    id: row.account_id,
    code: row.code,
    nameAr: row.name_ar,
    accountType: row.account_type as AccountNode["accountType"],
    normalBalance: row.normal_balance as AccountNode["normalBalance"],
    parentId: row.parent_id,
    kind: row.kind as AccountNode["kind"],
    isSystem: row.is_system,
    sortOrder: row.sort_order,
    active: row.active,
    debit: asNumber(row.debit),
    credit: asNumber(row.credit),
    balance: asNumber(row.balance),
  }));

  return (
    <div className="flex flex-col gap-5 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">شجرة الحسابات</h1>
        <p style={{ color: "var(--ink-muted)" }}>
          صنّف المصروفات، مسحوبات المالك، والمصروفات الرأسمالية في شجرة حسابات مستقلة مرتبطة بالقيود.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiCard label="الحسابات النشطة" value={num(nodes.filter((node) => node.active).length)} />
        <KpiCard label="حسابات ربط المصروفات" value={num(postingLeaves.length)} />
        <KpiCard label="رصيد التشغيلي" value={egp(operatingBalance)} />
        <KpiCard label="رأسمالي ومسحوبات" value={egp(capexBalance + drawingBalance)} />
      </div>

      <Alert
        tone="info"
        title="الحسابات النظامية تحمي مسار القيود والعهدة؛ يمكن إعادة تسميتها فقط. الحساب المستخدم في قيود أو مصروفات يُؤرشف أو يُدمج ولا يُحذف."
      />

      <Card title="شجرة الحسابات">
        {nodes.length === 0 ? (
          <EmptyState title="لا توجد حسابات بعد" description="أضف حسابًا رئيسيًا لبدء بناء الشجرة." />
        ) : (
          <AccountsTreeManager nodes={nodes} />
        )}
      </Card>
    </div>
  );
}
