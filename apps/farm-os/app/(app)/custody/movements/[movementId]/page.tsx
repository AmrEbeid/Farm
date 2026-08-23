import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, Breadcrumbs, Card, DescriptionList, StatusPill } from "@/components/ui";
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
  let transferCounterpart: { id: string; holderLabel: string } | null = null;
  if (movement.transfer_group_id) {
    const { data: counterpart, error: counterpartError } = await sb
      .from("custody_movements")
      .select("id, custody_accounts!inner(holder_label)")
      .eq("org_id", member.orgId)
      .eq("custody_accounts.org_id", member.orgId)
      .eq("transfer_group_id", movement.transfer_group_id)
      .neq("id", movement.id)
      .limit(1)
      .maybeSingle();
    if (counterpartError) throw counterpartError;
    const counterpartAccount = normalizeOne(counterpart?.custody_accounts);
    if (counterpart && counterpartAccount) {
      transferCounterpart = { id: counterpart.id, holderLabel: counterpartAccount.holder_label };
    }
  }
  const { amount, isIncoming, eligible } = custodyMovementDisplayState(movement);
  const status = movement.reversal_of
    ? { label: "حركة عكسية", pill: "warning" as const }
    : movement.reversed_by
      ? { label: "تم عكسها", pill: "blocked" as const }
      : { label: "سارية", pill: "active" as const };
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-5 p-4" data-testid="custody-movement-360">
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

      <section aria-labelledby="movement-money-title" className="border-s-4 px-3 py-2" style={{ borderColor: isIncoming ? "var(--success-fg)" : "var(--warning-fg)", background: "var(--surface)" }}>
        <p id="movement-money-title" className="text-xs" style={{ color: "var(--ink-muted)" }}>{isIncoming ? "نقد دخل العهدة" : "نقد خرج من العهدة"}</p>
        <strong className="block text-xl tabular-nums">{custodyMovementAmountEgp(amount)}</strong>
        <p className="text-xs" style={{ color: "var(--ink-muted)" }}>{account.holder_label} · {movement.movement_type}</p>
      </section>

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
            ...(movement.reversal_reason ? [{ id: "reversal-reason", term: "سبب التصحيح", description: movement.reversal_reason }] : []),
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

      {(movement.expense_id || movement.payment_request_id || movement.journal_entry_id || movement.transfer_group_id) && (
        <section aria-labelledby="movement-links-title" className="flex flex-col gap-2">
          <h2 id="movement-links-title" className="text-sm font-bold">الروابط المالية</h2>
          <ul className="divide-y" style={{ borderColor: "var(--line)" }}>
            {movement.expense_id && (
              <li className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>المصروف الذي أنشأ الحركة</span>
                <Link href={`/expenses/${movement.expense_id}`} className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4" style={{ color: "var(--brand)" }}>فتح المصروف</Link>
              </li>
            )}
            {movement.payment_request_id && (
              <li className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>طلب الصرف المرتبط</span>
                <Link href={`/custody/request/${movement.payment_request_id}`} className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4" style={{ color: "var(--brand)" }}>فتح طلب الصرف</Link>
              </li>
            )}
            {movement.journal_entry_id && (
              <li className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>القيد المحاسبي · مرجع <bdi dir="ltr">{movement.journal_entry_id.slice(0, 8)}</bdi></span>
                <Link href="/accounting" className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4" style={{ color: "var(--brand)" }}>فتح دفتر القيود</Link>
              </li>
            )}
            {movement.transfer_group_id && (
              <li className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>الطرف المقابل لتحويل العهدة</span>
                {transferCounterpart ? (
                  <Link href={`/custody/movements/${transferCounterpart.id}`} className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4" style={{ color: "var(--brand)" }}>
                    فتح حركة {transferCounterpart.holderLabel}
                  </Link>
                ) : <StatusPill status="warning">الرابط المقابل غير متاح</StatusPill>}
              </li>
            )}
          </ul>
        </section>
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
    </main>
  );
}
