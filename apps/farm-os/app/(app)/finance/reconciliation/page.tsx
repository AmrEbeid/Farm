import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { Alert, Card, EmptyState, KpiCard, Tag } from "@/components/ui";
import { SimpleTable, type SimpleColumn, type SimpleRow } from "@/components/SimpleTable";
import { fmtDate } from "@/lib/dates";
import { num } from "@/lib/money";
import {
  BATCH_STATUS_AR,
  RECONCILIATION_MAX_BATCHES,
  type BatchStatus,
} from "@/lib/reconciliation review";
import { ManifestStagingCard } from "./staging upload";

export const dynamic = "force-dynamic";

type BatchRow = {
  id: string;
  source_label: string | null;
  source_workbook_sha256: string | null;
  status: string;
  created_at: string;
  result_summary: { batch_row_count?: number } | null;
};

function statusMeta(status: string): { label: string; tone: string } {
  const meta = BATCH_STATUS_AR[status as BatchStatus];
  return meta ?? { label: status, tone: "neutral" };
}

export default async function ReconciliationListPage() {
  const m = await requireRole(["owner", "accountant"]);
  const sb = await createClient();

  const { data, error } = await sb
    .from("reconciliation_batches")
    .select("id, source_label, source_workbook_sha256, status, created_at, result_summary")
    .eq("org_id", m.orgId)
    .order("created_at", { ascending: false })
    .limit(RECONCILIATION_MAX_BATCHES);
  if (error) throw error;

  const batches = (data ?? []) as BatchRow[];
  const pendingReview = batches.filter((b) => b.status === "staged").length;
  const awaitingApproval = batches.filter((b) => b.status === "reviewed").length;
  const approved = batches.filter((b) => b.status === "approved").length;

  const statusById = new Map(batches.map((b) => [b.id, b.status] as const));

  const columns: SimpleColumn[] = [
    { id: "source", header: "الدفعة" },
    {
      id: "status",
      header: "الحالة",
      sortable: false,
      render: (row) => {
        const meta = statusMeta(statusById.get(row.id) ?? "");
        return <Tag tone={meta.tone as never}>{meta.label}</Tag>;
      },
    },
    { id: "rows", header: "عدد الصفوف", numeric: true },
    { id: "created", header: "أُنشئت" },
  ];

  const rows: SimpleRow[] = batches.map((b) => {
    const meta = statusMeta(b.status);
    const label =
      b.source_label?.trim() ||
      (b.source_workbook_sha256 ? `دفتر ${b.source_workbook_sha256.slice(0, 8)}` : "دفعة تسوية");
    const staged = b.result_summary?.batch_row_count;
    return {
      id: b.id,
      href: `/finance/reconciliation/${b.id}`,
      source: label,
      status: meta.label,
      rows: typeof staged === "number" ? staged : "—",
      created: fmtDate(b.created_at),
    } as SimpleRow;
  });

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">مراجعة التسويات</h1>
          <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
            مراجعة دفعات التسوية المُجهَّزة قبل اعتمادها — بدون ترحيل أو تعديل بيانات فعلية.
          </p>
        </div>
        <Link
          href="/accounting"
          className="rounded-md px-3 py-2 text-sm"
          style={{ border: "1px solid var(--line)", color: "var(--ink)" }}
        >
          المحاسبة
        </Link>
      </header>

      <Alert
        tone="info"
        title="مراجعة فقط"
        description="هذه الصفحة لمراجعة الدفعات المُجهَّزة واتخاذ قرار لكل صف ثم التجميد والاعتماد. لا تُرحِّل ولا تُنشئ ولا تُعدِّل أي مصروف أو بيع أو قيد فعلي."
      />

      {/* Staging is the entry point of the workflow, so it stays available whether or not any batch
          exists yet — including on the empty state, where it is the only thing to do. */}
      <ManifestStagingCard />

      {batches.length === 0 ? (
        <EmptyState
          title="لا توجد دفعات تسوية مُجهَّزة"
          description="لم تُجهَّز أي دفعة تسوية بعد. ستظهر هنا الدفعات المُجهَّزة الخاصة بمؤسستك عند توفّرها."
        />
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-3">
            <KpiCard label="قيد المراجعة" value={num(pendingReview)} />
            <KpiCard label="بانتظار الاعتماد" value={num(awaitingApproval)} />
            <KpiCard label="معتمدة" value={num(approved)} />
          </section>

          <Card title={`الدفعات (${num(batches.length)})`}>
            <SimpleTable
              columns={columns}
              rows={rows}
              ariaLabel="دفعات التسوية"
              empty="لا توجد دفعات"
            />
            <p className="mt-3 text-xs" style={{ color: "var(--ink-muted)" }}>
              تُعرض أحدث {num(RECONCILIATION_MAX_BATCHES)} دفعة على الأكثر. افتح الدفعة لمراجعة صفوفها.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
