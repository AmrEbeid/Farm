import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, Breadcrumbs, Card, DescriptionList } from "@/components/ui";
import { Entity360Header } from "@/components/Entity360Header";
import { requireRole } from "@/lib/auth";
import {
  custodyMovementAmountEgp,
  custodyMovementDisplayState,
} from "@/lib/custody-movement-detail";
import { fmtDate, fmtDateTime } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/uuid";
import { ReverseCustodyMovementForm } from "./ReverseCustodyMovementForm";

export const dynamic = "force-dynamic";

function normalizeOne<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

function todayInCairo(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export default async function CustodyMovementPage({
  params,
}: {
  params: Promise<{ movementId: string }>;
}) {
  const { movementId } = await params;
  if (!isUuid(movementId)) notFound();
  const member = await requireRole(["owner", "accountant"]);
  const sb = await createClient();
  const { data: movement, error } = await sb
    .from("custody_movements")
    .select(
      "id, custody_account_id, occurred_at, movement_type, amount_in::text, amount_out::text, note, expense_id, payment_request_id, journal_entry_id, transfer_group_id, reversal_of, reversal_reason, reversed_by, reversed_at, created_at, custody_accounts!inner(holder_label)",
    )
    .eq("id", movementId)
    .eq("org_id", member.orgId)
    .eq("custody_accounts.org_id", member.orgId)
    .maybeSingle();
  if (error) throw error;
  if (!movement) notFound();
  const account = normalizeOne(movement.custody_accounts);
  if (!account) notFound();
  const { amount, isIncoming, eligible } = custodyMovementDisplayState(movement);
  const status = movement.reversal_of
    ? { label: "حركة عكسية", pill: "warning" as const }
    : movement.reversed_by
      ? { label: "تم عكسها", pill: "blocked" as const }
      : { label: "سارية", pill: "active" as const };
  return (
    <div className="flex flex-col gap-6 p-6">
      <Breadcrumbs
        ariaLabel="المسار"
        items={[
          { id: "custody", label: "العهدة", href: "/custody" },
          { id: "movement", label: "حركة عهدة" },
        ]}
      />
      <Entity360Header
        title="حركة عهدة"
        subtitle={`${fmtDate(movement.occurred_at)} · ${account?.holder_label ?? "حساب عهدة"}`}
        pills={[{ status: status.pill, label: status.label }]}
        actions={<Link href="/custody">العودة إلى العهدة</Link>}
      />

      <Card title="بيانات الحركة">
        <DescriptionList
          layout="inline"
          items={[
            { id: "date", term: "التاريخ", description: fmtDate(movement.occurred_at) },
            { id: "holder", term: "العهدة لدى", description: account?.holder_label ?? "—" },
            { id: "type", term: "نوع الحركة", description: movement.movement_type },
            { id: "direction", term: "الاتجاه", description: isIncoming ? "وارد" : "صادر" },
            { id: "amount", term: "المبلغ", description: custodyMovementAmountEgp(amount) },
            { id: "note", term: "الملاحظات", description: movement.note ?? "—" },
            { id: "created", term: "وقت التسجيل", description: fmtDateTime(movement.created_at) },
          ]}
        />
      </Card>

      {movement.reversal_of && (
        <Alert
          tone="info"
          title="هذه حركة عكسية مرتبطة بالحركة الأصلية."
          description={
            <Link href={`/custody/movements/${movement.reversal_of}`}>فتح الحركة الأصلية</Link>
          }
        />
      )}
      {movement.reversed_by && (
        <Alert
          tone="info"
          title={`تم عكس هذه الحركة${movement.reversed_at ? ` في ${fmtDateTime(movement.reversed_at)}` : ""}.`}
          description={
            <Link href={`/custody/movements/${movement.reversed_by}`}>فتح حركة العكس</Link>
          }
        />
      )}

      {eligible ? (
        <Card title="سجّلت استلام التمويل بالخطأ؟">
          <ReverseCustodyMovementForm movementId={movement.id} today={todayInCairo()} />
        </Card>
      ) : !movement.reversal_of && !movement.reversed_by ? (
        <Alert
          tone="info"
          title="هذه الحركة لا تُعكس من هذا المسار."
          description="حركات المصروفات وطلبات الصرف والتحويلات لها مسارات تصحيح منفصلة لحماية الربط المحاسبي."
        />
      ) : null}
    </div>
  );
}
