import Link from "next/link";
import { Card } from "@/components/ui";

// Cross-links between the three tied-together financial statements (balance sheet / income statement / period
// lock). Presentational; no data access. Dropped at the foot of each statement page.

const STATEMENTS = [
  { id: "balance-sheet", label: "قائمة المركز المالي", href: "/finance/balance-sheet", icon: "📋" },
  { id: "income-statement", label: "قائمة الدخل", href: "/finance/income-statement", icon: "📈" },
  { id: "periods", label: "الفترات المحاسبية (الإقفال)", href: "/finance/periods", icon: "🔒" },
] as const;

export type StatementId = (typeof STATEMENTS)[number]["id"];

/** Links to the sibling financial statements; `current` omits the self-link. */
export function FinanceStatementsNav({ current }: { current: StatementId }) {
  const others = STATEMENTS.filter((s) => s.id !== current);
  return (
    <Card title="قوائم مالية ذات صلة">
      <div className="flex flex-wrap gap-3">
        {others.map((s) => (
          <Link
            key={s.id}
            href={s.href}
            className="rounded-md px-3 py-2 text-sm font-semibold"
            style={{ border: "1px solid var(--line)", background: "var(--surface)" }}
          >
            {s.icon} {s.label}
          </Link>
        ))}
      </div>
      <p className="mt-2 text-sm" style={{ color: "var(--ink-muted)" }}>
        صافي الربح في قائمة الدخل يطابق صافي الربح في قائمة المركز المالي لنفس التاريخ؛ وإقفال فترة يمنع ترحيل قيد جديد بتاريخها.
      </p>
    </Card>
  );
}
