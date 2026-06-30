import type { ReactNode } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { Card, DescriptionList, EmptyState, KpiCard } from "@/components/ui";
import { SimpleTable, type SimpleColumn } from "@/components/SimpleTable";
import { fmtDate } from "@/lib/dates";
import { num } from "@/lib/money";
import { EMP_TYPE_AR, OP_STATUS_AR, SUBTYPE_AR, isExecutableOpStatus } from "@/lib/labels";

export default async function Person360Page({
  params,
}: {
  params: Promise<{ personId: string }>;
}) {
  const { personId } = await params;
  await requireRole(["owner", "farm_manager", "agri_engineer", "accountant"]);
  const sb = await createClient();

  const [
    { data: person, error: personError },
    { data: people, error: peopleError },
    { data: operations, error: operationsError },
    { data: performedEvents, error: performedError },
    { data: assignedEvents, error: assignedError },
  ] = await Promise.all([
    sb
      .from("people")
      .select("id, name, position, employment_type, active, reports_to_person_id")
      .eq("id", personId)
      .maybeSingle(),
    sb
      .from("people")
      .select("id, name, position, employment_type, active, reports_to_person_id")
      .order("name"),
    sb
      .from("plan_operations")
      .select("id, plan_id, subtype, planned_at, status, est_cost")
      .eq("responsible_person_id", personId)
      .order("planned_at")
      .limit(20),
    sb
      .from("farm_event")
      .select("id, subtype, status, occurred_at, notes")
      .eq("performed_by_person_id", personId)
      .order("occurred_at", { ascending: false })
      .limit(12),
    sb
      .from("farm_event")
      .select("id, subtype, status, occurred_at, notes")
      .eq("assigned_to_person_id", personId)
      .order("occurred_at", { ascending: false })
      .limit(12),
  ]);
  if (personError) throw personError;
  if (peopleError) throw peopleError;
  if (operationsError) throw operationsError;
  if (performedError) throw performedError;
  if (assignedError) throw assignedError;

  if (!person)
    return (
      <div className="p-6">
        <EmptyState title="الشخص غير موجود." description="قد يكون محذوفًا أو الرابط غير صحيح." icon="🔍" />
      </div>
    );

  const manager = (people ?? []).find((p) => p.id === person.reports_to_person_id);
  const directReports = (people ?? []).filter((p) => p.reports_to_person_id === person.id);
  const openOperations = (operations ?? []).filter((op) => isExecutableOpStatus(op.status));

  const operationColumns: SimpleColumn[] = [
    { id: "subtype", header: "العملية" },
    { id: "planned_at", header: "التاريخ" },
    { id: "status", header: "الحالة", kind: "status" },
  ];
  const operationRows = (operations ?? []).map((op) => ({
    id: op.id,
    href: `/plans/${op.plan_id}`,
    subtype: SUBTYPE_AR[op.subtype ?? ""] ?? "عملية",
    planned_at: op.planned_at ? fmtDate(op.planned_at) : "—",
    status: OP_STATUS_AR[op.status ?? "planned"] ?? "غير معروف",
  }));

  const eventColumns: SimpleColumn[] = [
    { id: "subtype", header: "النشاط" },
    { id: "occurred_at", header: "التاريخ" },
    { id: "status", header: "الحالة", kind: "status" },
    { id: "notes", header: "ملاحظات" },
  ];
  const performedRows = (performedEvents ?? []).map((event) => ({
    id: event.id,
    subtype: SUBTYPE_AR[event.subtype ?? ""] ?? "نشاط",
    occurred_at: event.occurred_at ? fmtDate(event.occurred_at) : "—",
    status: OP_STATUS_AR[event.status ?? ""] ?? "غير معروف",
    notes: event.notes ?? "—",
  }));

  const reportColumns: SimpleColumn[] = [
    { id: "name", header: "الاسم" },
    { id: "position", header: "الوظيفة" },
    { id: "type", header: "نوع التوظيف" },
    { id: "active", header: "نشط", kind: "tag-ok" },
  ];
  const reportRows = directReports.map((report) => ({
    id: report.id,
    href: `/people/${report.id}`,
    name: report.name,
    position: report.position ?? "—",
    type: report.employment_type ? EMP_TYPE_AR[report.employment_type] ?? "غير معروف" : "—",
    active: report.active ? "نشط" : "",
  }));

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{person.name}</h1>
          <p style={{ color: "var(--ink-muted)" }}>
            {person.position ?? "عضو فريق"} · {person.employment_type ? EMP_TYPE_AR[person.employment_type] ?? "غير معروف" : "—"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <HeaderLink href="/people/dashboard">لوحة الفريق</HeaderLink>
          <HeaderLink href="/people">دليل الفريق</HeaderLink>
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="عمليات مفتوحة" value={num(openOperations.length)} />
        <KpiCard label="أنشطة مسندة" value={num((assignedEvents ?? []).length)} />
        <KpiCard label="أنشطة منفّذة" value={num((performedEvents ?? []).length)} />
        <KpiCard label="مرؤوسون مباشرون" value={num(directReports.length)} />
      </section>

      <Card title="ملف الشخص">
        <DescriptionList
          items={[
            { id: "position", term: "الوظيفة", description: person.position ?? "—" },
            {
              id: "employment_type",
              term: "نوع التوظيف",
              description: person.employment_type ? EMP_TYPE_AR[person.employment_type] ?? "غير معروف" : "—",
            },
            { id: "manager", term: "المدير المباشر", description: manager?.name ?? "—" },
            { id: "active", term: "الحالة", description: person.active ? "نشط" : "غير نشط" },
          ]}
        />
      </Card>

      <section className="grid gap-4 xl:grid-cols-2">
        <Card title="العمليات المسندة">
          {operationRows.length === 0 ? (
            <EmptyState title="لا توجد عمليات مسندة" />
          ) : (
            <SimpleTable columns={operationColumns} rows={operationRows} empty="—" />
          )}
        </Card>
        <Card title="أنشطة منفّذة">
          {performedRows.length === 0 ? (
            <EmptyState title="لا توجد أنشطة منفّذة" />
          ) : (
            <SimpleTable columns={eventColumns} rows={performedRows} empty="—" />
          )}
        </Card>
      </section>

      <Card title="المرؤوسون المباشرون">
        {reportRows.length === 0 ? (
          <EmptyState title="لا يوجد مرؤوسون مباشرون" />
        ) : (
          <SimpleTable columns={reportColumns} rows={reportRows} empty="—" />
        )}
      </Card>
    </div>
  );
}

function HeaderLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-9 items-center justify-center rounded-md px-3 text-sm font-semibold"
      style={{
        color: "var(--brand)",
        background: "var(--surface)",
        border: "1px solid var(--line)",
      }}
    >
      {children}
    </Link>
  );
}
