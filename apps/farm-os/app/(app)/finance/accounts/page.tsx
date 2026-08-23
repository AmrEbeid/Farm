import type { ReactNode } from "react";
import Link from "next/link";
import { BookOpenCheck, CircleDollarSign, Landmark, ReceiptText } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { egpExact } from "@/lib/decimal";
import { createClient } from "@/lib/supabase/server";
import { Alert, EmptyState } from "@/components/ui";
import { PageHeader } from "@/components/PageHeader";
import { AccountsTreeManager } from "@/components/AccountsTreeManager";
import { parseChartOfAccountsSnapshot } from "@/lib/chart-of-accounts-snapshot";

export const dynamic = "force-dynamic";

const ARABIC_INTEGER = new Intl.NumberFormat("ar-EG");

function exactCount(value: string): string {
  return ARABIC_INTEGER.format(BigInt(value));
}

function Metric({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return (
    <div className="min-w-0 border-b py-3 last:border-b-0 sm:border-b-0 sm:px-4 sm:first:ps-0 sm:[&:not(:first-child)]:border-s" style={{ borderColor: "var(--line)" }}>
      <div className="flex items-center gap-2 text-xs" style={{ color: "var(--ink-muted)" }}>{icon}{label}</div>
      <strong className="mt-1 block text-lg tabular-nums">{value}</strong>
    </div>
  );
}

export default async function AccountsPage() {
  const member = await requireRole(["owner", "accountant"]);
  const sb = await createClient();
  const snapshotRes = await sb.rpc("fn_chart_of_accounts_snapshot", { p_org: member.orgId });
  if (snapshotRes.error) throw snapshotRes.error;
  const snapshot = parseChartOfAccountsSnapshot(snapshotRes.data, member.orgId);

  return (
    <main className="flex flex-col gap-5 p-4 sm:p-6">
      <PageHeader
        title="دليل الحسابات"
        subtitle="رتّب أين تُسجّل المصروفات والمسحوبات والأصول، وراجع أثر القيود المرحلة فقط."
        actions={(
          <nav aria-label="روابط محاسبية" className="no-print flex flex-wrap gap-2">
            <Link href="/accounting" className="fos-btn fos-btn--secondary fos-btn--md">دفتر الأستاذ</Link>
            <Link href="/finance/reports" className="fos-btn fos-btn--secondary fos-btn--md">التقارير</Link>
          </nav>
        )}
      />

      <section aria-label="ملخص دليل الحسابات" className="grid border-y sm:grid-cols-2 lg:grid-cols-5" style={{ borderColor: "var(--line)" }}>
        <Metric label="حسابات نشطة" value={exactCount(snapshot.totals.activeCount)} icon={<BookOpenCheck size={16} aria-hidden />} />
        <Metric label="حسابات تسجيل" value={exactCount(snapshot.totals.postingLeafCount)} icon={<ReceiptText size={16} aria-hidden />} />
        <Metric label="تشغيلي مرحل" value={egpExact(snapshot.totals.operatingBalance)} icon={<CircleDollarSign size={16} aria-hidden />} />
        <Metric label="رأسمالي مرحل" value={egpExact(snapshot.totals.capexBalance)} icon={<Landmark size={16} aria-hidden />} />
        <Metric label="مسحوبات مرحلة" value={egpExact(snapshot.totals.drawingBalance)} icon={<CircleDollarSign size={16} aria-hidden />} />
      </section>

      <Alert
        tone="info"
        title="الحساب النظامي يمكن إعادة تسميته فقط. الحساب المستخدم يُؤرشف أو يُدمج ولا يُحذف، وتظل قيوده القديمة محفوظة."
      />

      {snapshot.accounts.length === 0 ? (
        <EmptyState title="لا توجد حسابات بعد" description="أضف حسابًا رئيسيًا لبدء بناء الدليل." />
      ) : (
        <AccountsTreeManager nodes={snapshot.accounts} canWrite={snapshot.canWrite} />
      )}
    </main>
  );
}
