"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert, Button, EmptyState, Field, Input, Select, Tag, Textarea } from "@/components/ui";
import { AccountPicker } from "@/components/AccountPicker";
import type { PickableAccount } from "@/lib/account-options";
import { num } from "@/lib/money";
import type { DecisionInput, ResultSummaryLine } from "@/lib/reconciliation review";
// The ONE runtime value this client bundle takes from the (space-named) reconciliation module: the
// rollback reason bound, so the textarea cannot silently accept text the RPC will reject. It is a
// plain number constant — importing the value keeps the UI cap and the RPC cap from ever drifting.
import { ROLLBACK_REASON_MAX } from "@/lib/reconciliation review";
import {
  reviewRow,
  freezeBatch,
  approveBatch,
  executeBatch,
  rollbackBatch,
  searchCorrectionTargets,
  type ActionResult,
  type CorrectionTarget,
} from "../actions";

export interface Option {
  id: string;
  label: string;
}
/** Sectors/hawshat carry their parent id so the sale form can filter descendants by the chosen parent. */
export interface SectorOption extends Option {
  farmId: string;
}
export interface HawshaOption extends Option {
  sectorId: string;
}
export interface OptionList {
  accounts: PickableAccount[];
  costCenters: Option[];
  suppliers: Option[];
  buyers: Option[];
  farms: Option[];
  sectors: SectorOption[];
  hawshat: HawshaOption[];
}
export interface RowExpensePrefill {
  category: string;
  description: string;
  kind: string;
  account_id: string;
  cost_center_id: string;
  supplier_id: string;
  payment_decision: string;
}
export interface RowSalePrefill {
  crop: string;
  quantity: number | null;
  unit: string;
  unit_price: number | null;
  recorded_total: number | null;
  buyer_id: string;
  cost_center_id: string;
  farm_id: string;
  sector_id: string;
  hawsha_id: string;
  season: string;
  delivery_date: string;
  notes: string;
  historical_date_decision: string;
  effective_date: string;
}
export interface RowVM {
  id: string;
  classification: string;
  classificationLabel: string;
  evidenceLabel: string;
  provenanceLabel: string;
  sourceAmountLabel: string;
  sourceDateLabel: string;
  invalidDate: boolean;
  reviewState: string;
  disposition: string;
  reviewReason: string | null;
  targetTable: string | null;
  frozen: boolean;
  executionResult: string;
  targetDetails: string[];
  expense: RowExpensePrefill;
  sale: RowSalePrefill;
  correctsExpenseId: string;
  correctsSaleId: string;
}

// Local display maps (kept here so the client bundle never pulls the whole spaced-filename module in
// at runtime; the authoritative Arabic maps live in lib/reconciliation review.ts and are used
// server-side). ROLLBACK_REASON_MAX above is the deliberate exception: it is a bare numeric const, so
// the bundler inlines the literal — the built client chunk carries `maxLength:500`, not an import.
const REVIEW_STATE: Record<string, { label: string; tone: string }> = {
  unreviewed: { label: "بدون قرار", tone: "warning" },
  reviewed: { label: "تمت المراجعة", tone: "info" },
  frozen: { label: "مُجمَّد", tone: "accent" },
  executed: { label: "مُنفَّذ", tone: "ok" },
  rejected: { label: "مرفوض", tone: "danger" },
};
const DISPOSITION_LABEL: Record<string, string> = { include: "تضمين", hold: "تعليق" };
const KIND_OPTS = [
  { value: "operating", label: "تشغيلي" },
  { value: "drawing", label: "مسحوبات مالك" },
  { value: "capex", label: "رأسمالي" },
];
const PAYMENT_OPTS = [
  { value: "routed_now", label: "ترحيل تاريخي على خزينة المزرعة" },
];
const HISTORICAL_OPTS = [
  { value: "", label: "— بدون —" },
  { value: "use_source_text_date", label: "تاريخ نص المصدر" },
  { value: "use_matched_production_date", label: "تاريخ الإنتاج المطابق" },
  { value: "manual_override", label: "تحديد يدوي" },
];

type Msg = { tone: "ok" | "danger"; text: string } | null;

async function run(fn: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await fn();
  } catch {
    return { ok: false, error: "تعذّر الاتصال بالخادم. حاول مرة أخرى." };
  }
}

function idOptions(placeholder: string, list: Option[]) {
  return [{ value: "", label: placeholder }, ...list.map((o) => ({ value: o.id, label: o.label }))];
}

function toNum(value: string): number | null {
  const t = value.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : Number.NaN;
}

function CorrectionTargetPicker({
  id,
  targetTable,
  value,
  onChange,
}: {
  id: string;
  targetTable: "expenses" | "sales";
  value: string;
  onChange: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [targets, setTargets] = useState<CorrectionTarget[]>([]);
  const [selectedLabel, setSelectedLabel] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function search() {
    setPending(true);
    setError("");
    const result = await searchCorrectionTargets({ targetTable, query });
    setPending(false);
    if (!result.ok) {
      setTargets([]);
      setError(result.error);
      return;
    }
    setTargets(result.targets);
    if (result.targets.length === 0) setError("لا توجد نتائج مطابقة. جرّب التاريخ أو المبلغ.");
  }

  return (
    <div className="flex flex-col gap-2">
      {value && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Tag tone="ok">{selectedLabel || "تم اختيار السجل المراد تصحيحه"}</Tag>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              onChange("");
              setSelectedLabel("");
            }}
          >
            تغيير
          </Button>
        </div>
      )}
      {!value && (
        <>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id={id}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="ابحث بالتاريخ أو المبلغ أو الوصف"
            />
            <Button type="button" variant="ghost" loading={pending} disabled={pending} onClick={search}>
              بحث
            </Button>
          </div>
          {error && (
            <p className="text-xs" role="alert" style={{ color: "var(--danger)" }}>
              {error}
            </p>
          )}
          {targets.length > 0 && (
            <div className="flex max-h-48 flex-col gap-1 overflow-y-auto" role="list">
              {targets.map((target) => (
                <button
                  key={target.id}
                  type="button"
                  className="rounded-md px-3 py-2 text-start text-sm"
                  style={{ border: "1px solid var(--line)", background: "var(--surface)" }}
                  onClick={() => {
                    onChange(target.id);
                    setSelectedLabel(target.label);
                  }}
                >
                  {target.label}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── One row: read-only provenance + (when editable) an inline review form. ─────────────────────────
function RowCard({
  row,
  batchId,
  classification,
  editable,
  options,
}: {
  row: RowVM;
  batchId: string;
  classification: string;
  editable: boolean;
  options: OptionList;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  const decided = row.reviewState !== "unreviewed";
  const initialAction: "review" | "hold" | "reject" =
    row.reviewState === "rejected" ? "reject" : row.disposition === "include" ? "review" : "hold";
  const [action, setAction] = useState<"review" | "hold" | "reject">(initialAction);
  const [target, setTarget] = useState<"expenses" | "sales">(
    (row.targetTable as "expenses" | "sales" | null) ?? "expenses",
  );
  const [reason, setReason] = useState(row.reviewReason ?? "");
  const [exp, setExp] = useState<RowExpensePrefill>(row.expense);
  const [sale, setSale] = useState({
    ...row.sale,
    quantity: row.sale.quantity == null ? "" : String(row.sale.quantity),
    unit_price: row.sale.unit_price == null ? "" : String(row.sale.unit_price),
    recorded_total: row.sale.recorded_total == null ? "" : String(row.sale.recorded_total),
  });
  const [correctsExpenseId, setCorrectsExpenseId] = useState(row.correctsExpenseId);
  const [correctsSaleId, setCorrectsSaleId] = useState(row.correctsSaleId);

  const isCorrection = classification === "amount_correction_candidate";
  const state = REVIEW_STATE[row.reviewState] ?? { label: row.reviewState, tone: "neutral" };

  function buildDecision(): DecisionInput {
    if (action === "hold") return { action: "hold", reason };
    if (action === "reject") return { action: "reject", reason };
    if (target === "expenses") {
      return {
        action: "review",
        target_table: "expenses",
        reason,
        classification,
        expense: {
          category: exp.category,
          description: exp.description,
          kind: exp.kind,
          account_id: exp.account_id,
          cost_center_id: exp.cost_center_id,
          supplier_id: exp.supplier_id,
          payment_decision: exp.payment_decision,
        },
        corrects_expense_id: correctsExpenseId || null,
      };
    }
    return {
      action: "review",
      target_table: "sales",
      reason,
      classification,
      sale: {
        crop: sale.crop,
        quantity: toNum(sale.quantity),
        unit: sale.unit,
        unit_price: toNum(sale.unit_price),
        recorded_total: toNum(sale.recorded_total),
        buyer_id: sale.buyer_id,
        cost_center_id: sale.cost_center_id,
        farm_id: sale.farm_id,
        sector_id: sale.sector_id,
        hawsha_id: sale.hawsha_id,
        season: sale.season,
        delivery_date: sale.delivery_date,
        notes: sale.notes,
        historical_date_decision: sale.historical_date_decision,
        effective_date: sale.effective_date,
      },
      corrects_sale_id: correctsSaleId || null,
    };
  }

  async function submit() {
    if (reason.trim().length === 0) {
      setMsg({ tone: "danger", text: "سبب القرار مطلوب ولا يمكن أن يكون فارغًا." });
      return;
    }
    if (action === "review" && target === "expenses" && exp.payment_decision.trim() === "") {
      setMsg({ tone: "danger", text: "قرار الترحيل على خزينة المزرعة مطلوب." });
      return;
    }
    setPending(true);
    setMsg(null);
    const r = await run(() => reviewRow({ rowId: row.id, batchId, decision: buildDecision() }));
    setPending(false);
    if (r.ok) {
      setMsg({ tone: "ok", text: "تم حفظ القرار." });
      setOpen(false);
      router.refresh();
    } else {
      setMsg({ tone: "danger", text: r.error ?? "تعذّر حفظ القرار." });
    }
  }

  return (
    <div
      className="flex flex-col gap-3 rounded-lg p-4"
      style={{ border: "1px solid var(--line)", backgroundColor: "var(--surface)" }}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <Tag tone="neutral">{row.classificationLabel}</Tag>
            <Tag tone={state.tone as never}>{state.label}</Tag>
            <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
              {row.reviewState === "unreviewed"
                ? "بدون قرار (الوضع الافتراضي)"
                : (DISPOSITION_LABEL[row.disposition] ?? row.disposition)}
            </span>
            {row.invalidDate && <Tag tone="warning">تاريخ غير صالح</Tag>}
          </div>
          <div className="text-sm font-medium">{row.evidenceLabel}</div>
          <div className="text-xs" style={{ color: "var(--ink-muted)" }}>{row.provenanceLabel}</div>
          <div className="flex flex-wrap gap-x-4 text-xs" style={{ color: "var(--ink-muted)" }}>
            <span>المبلغ المصدر: {row.sourceAmountLabel}</span>
            <span>تاريخ المصدر: {row.sourceDateLabel}</span>
          </div>
          {row.reviewReason && (
            <div className="text-xs" style={{ color: "var(--ink-muted)" }}>
              السبب: {row.reviewReason}
            </div>
          )}
          {row.targetDetails.length > 0 && (
            <div
              className="mt-1 flex flex-wrap gap-x-4 gap-y-1 rounded-md px-3 py-2 text-xs"
              style={{ background: "var(--surface-raised)", color: "var(--ink)" }}
            >
              {row.targetDetails.map((detail) => (
                <span key={detail}>{detail}</span>
              ))}
            </div>
          )}
        </div>
        {editable && !row.frozen && (
          <Button variant="ghost" size="sm" onClick={() => setOpen((v) => !v)}>
            {open ? "إغلاق" : decided ? "تعديل القرار" : "مراجعة"}
          </Button>
        )}
      </div>

      {open && editable && !row.frozen && (
        <div className="flex flex-col gap-3 border-t pt-3" style={{ borderColor: "var(--line)" }}>
          <Field label="القرار" id={`action-${row.id}`}>
            <Select
              id={`action-${row.id}`}
              value={action}
              onChange={(e) => setAction(e.target.value as "review" | "hold" | "reject")}
              options={[
                { value: "review", label: "تضمين (مراجعة كاملة)" },
                { value: "hold", label: "تعليق" },
                { value: "reject", label: "رفض" },
              ]}
            />
          </Field>

          {action === "review" && (
            <Field label="الوجهة" id={`target-${row.id}`}>
              <Select
                id={`target-${row.id}`}
                value={target}
                onChange={(e) => setTarget(e.target.value as "expenses" | "sales")}
                options={[
                  { value: "expenses", label: "مصروف" },
                  { value: "sales", label: "بيع" },
                ]}
              />
            </Field>
          )}

          {action === "review" && target === "expenses" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="التصنيف (بند)" id={`exp-cat-${row.id}`} required>
                <Input
                  id={`exp-cat-${row.id}`}
                  value={exp.category}
                  onChange={(e) => setExp({ ...exp, category: e.target.value })}
                />
              </Field>
              <Field label="نوع المصروف" id={`exp-kind-${row.id}`} required>
                <Select
                  id={`exp-kind-${row.id}`}
                  value={exp.kind}
                  onChange={(e) => setExp({ ...exp, kind: e.target.value, account_id: "" })}
                  placeholder="— اختر —"
                  options={KIND_OPTS}
                />
              </Field>
              <Field label="الحساب المحاسبي" id={`exp-acc-${row.id}`} required>
                <AccountPicker
                  id={`exp-acc-${row.id}`}
                  value={exp.account_id}
                  onChange={(accountId) => setExp({ ...exp, account_id: accountId })}
                  accounts={options.accounts.filter((account) => account.kind === exp.kind)}
                  required
                />
              </Field>
              <Field label="الوصف" id={`exp-desc-${row.id}`}>
                <Input
                  id={`exp-desc-${row.id}`}
                  value={exp.description}
                  onChange={(e) => setExp({ ...exp, description: e.target.value })}
                />
              </Field>
              <Field label="مركز التكلفة" id={`exp-cc-${row.id}`}>
                <Select
                  id={`exp-cc-${row.id}`}
                  value={exp.cost_center_id}
                  onChange={(e) => setExp({ ...exp, cost_center_id: e.target.value })}
                  options={idOptions("— بدون —", options.costCenters)}
                />
              </Field>
              <Field label="المورد" id={`exp-sup-${row.id}`}>
                <Select
                  id={`exp-sup-${row.id}`}
                  value={exp.supplier_id}
                  onChange={(e) => setExp({ ...exp, supplier_id: e.target.value })}
                  options={idOptions("— بدون —", options.suppliers)}
                />
              </Field>
              <Field label="قرار الدفع" id={`exp-pay-${row.id}`} required>
                <Select
                  id={`exp-pay-${row.id}`}
                  value={exp.payment_decision}
                  onChange={(e) => setExp({ ...exp, payment_decision: e.target.value })}
                  options={PAYMENT_OPTS}
                  placeholder="اختر قرار الترحيل"
                  required
                />
              </Field>
              {isCorrection && (
                <Field label="المصروف المراد تصحيحه" id={`exp-corr-${row.id}`} required>
                  <CorrectionTargetPicker
                    id={`exp-corr-${row.id}`}
                    targetTable="expenses"
                    value={correctsExpenseId}
                    onChange={setCorrectsExpenseId}
                  />
                </Field>
              )}
            </div>
          )}

          {action === "review" && target === "sales" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="المحصول" id={`sl-crop-${row.id}`} required>
                <Input
                  id={`sl-crop-${row.id}`}
                  value={sale.crop}
                  onChange={(e) => setSale({ ...sale, crop: e.target.value })}
                />
              </Field>
              <Field label="الكمية" id={`sl-qty-${row.id}`} required>
                <Input
                  id={`sl-qty-${row.id}`}
                  type="number"
                  inputMode="decimal"
                  value={sale.quantity}
                  onChange={(e) => setSale({ ...sale, quantity: e.target.value })}
                />
              </Field>
              <Field label="سعر الوحدة" id={`sl-price-${row.id}`} required>
                <Input
                  id={`sl-price-${row.id}`}
                  type="number"
                  inputMode="decimal"
                  value={sale.unit_price}
                  onChange={(e) => setSale({ ...sale, unit_price: e.target.value })}
                />
              </Field>
              <Field label="الإجمالي المُسجَّل" id={`sl-total-${row.id}`} required>
                <Input
                  id={`sl-total-${row.id}`}
                  type="number"
                  inputMode="decimal"
                  value={sale.recorded_total}
                  onChange={(e) => setSale({ ...sale, recorded_total: e.target.value })}
                />
              </Field>
              <Field label="الوحدة" id={`sl-unit-${row.id}`}>
                <Input
                  id={`sl-unit-${row.id}`}
                  value={sale.unit}
                  onChange={(e) => setSale({ ...sale, unit: e.target.value })}
                />
              </Field>
              <Field label="المشتري" id={`sl-buyer-${row.id}`}>
                <Select
                  id={`sl-buyer-${row.id}`}
                  value={sale.buyer_id}
                  onChange={(e) => setSale({ ...sale, buyer_id: e.target.value })}
                  options={idOptions("— بدون —", options.buyers)}
                />
              </Field>
              <Field label="مركز التكلفة" id={`sl-cc-${row.id}`}>
                <Select
                  id={`sl-cc-${row.id}`}
                  value={sale.cost_center_id}
                  onChange={(e) => setSale({ ...sale, cost_center_id: e.target.value })}
                  options={idOptions("— بدون —", options.costCenters)}
                />
              </Field>
              <Field label="المزرعة" id={`sl-farm-${row.id}`}>
                <Select
                  id={`sl-farm-${row.id}`}
                  value={sale.farm_id}
                  // Changing the farm clears the now-inconsistent sector + hawsha (descendant clearing).
                  onChange={(e) => setSale({ ...sale, farm_id: e.target.value, sector_id: "", hawsha_id: "" })}
                  options={idOptions("— بدون —", options.farms)}
                />
              </Field>
              <Field label="القطاع" id={`sl-sector-${row.id}`}>
                <Select
                  id={`sl-sector-${row.id}`}
                  value={sale.sector_id}
                  disabled={!sale.farm_id}
                  // Sectors are filtered to the chosen farm; changing the sector clears the hawsha.
                  onChange={(e) => setSale({ ...sale, sector_id: e.target.value, hawsha_id: "" })}
                  options={idOptions(
                    sale.farm_id ? "— بدون —" : "اختر المزرعة أولًا",
                    options.sectors.filter((s) => s.farmId === sale.farm_id),
                  )}
                />
              </Field>
              <Field label="الحوشة" id={`sl-haw-${row.id}`}>
                <Select
                  id={`sl-haw-${row.id}`}
                  value={sale.hawsha_id}
                  disabled={!sale.sector_id}
                  onChange={(e) => setSale({ ...sale, hawsha_id: e.target.value })}
                  options={idOptions(
                    sale.sector_id ? "— بدون —" : "اختر القطاع أولًا",
                    options.hawshat.filter((h) => h.sectorId === sale.sector_id),
                  )}
                />
              </Field>
              <Field label="الموسم" id={`sl-season-${row.id}`}>
                <Input
                  id={`sl-season-${row.id}`}
                  value={sale.season}
                  onChange={(e) => setSale({ ...sale, season: e.target.value })}
                />
              </Field>
              <Field label="تاريخ التسليم" id={`sl-deliv-${row.id}`}>
                <Input
                  id={`sl-deliv-${row.id}`}
                  type="date"
                  value={sale.delivery_date}
                  onChange={(e) => setSale({ ...sale, delivery_date: e.target.value })}
                />
              </Field>
              <Field label="قرار التاريخ التاريخي" id={`sl-hist-${row.id}`}>
                <Select
                  id={`sl-hist-${row.id}`}
                  value={sale.historical_date_decision}
                  onChange={(e) => setSale({ ...sale, historical_date_decision: e.target.value })}
                  options={HISTORICAL_OPTS}
                />
              </Field>
              <Field label="التاريخ الفعلي" id={`sl-eff-${row.id}`}>
                <Input
                  id={`sl-eff-${row.id}`}
                  type="date"
                  value={sale.effective_date}
                  onChange={(e) => setSale({ ...sale, effective_date: e.target.value })}
                />
              </Field>
              <Field label="ملاحظات" id={`sl-notes-${row.id}`}>
                <Input
                  id={`sl-notes-${row.id}`}
                  value={sale.notes}
                  onChange={(e) => setSale({ ...sale, notes: e.target.value })}
                />
              </Field>
              {isCorrection && (
                <Field label="البيع المراد تصحيحه" id={`sl-corr-${row.id}`} required>
                  <CorrectionTargetPicker
                    id={`sl-corr-${row.id}`}
                    targetTable="sales"
                    value={correctsSaleId}
                    onChange={setCorrectsSaleId}
                  />
                </Field>
              )}
            </div>
          )}

          <Field label="سبب القرار (إلزامي)" id={`reason-${row.id}`} required>
            <Textarea
              id={`reason-${row.id}`}
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>

          <div role="alert" aria-live="assertive" aria-atomic="true">
            {msg && <Alert tone={msg.tone} title={msg.text} />}
          </div>

          <div className="flex gap-2">
            <Button onClick={submit} loading={pending} disabled={pending}>
              حفظ القرار
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              إلغاء
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Batch-level action bar: freeze / approve / execute / rollback, in ONE compact strip. ───────────
// Only the controls that apply to the batch's CURRENT status are rendered, and the two money actions
// (execute, rollback) are owner-only — an accountant sees the same truthful status and result summary
// but no mutation control at all. Both money actions are two-step: the button reveals an inline
// confirmation strip stating the money impact in Arabic. No native browser dialog is ever used —
// a source-contract test forbids one outright, because a native dialog cannot carry Arabic RTL copy
// explaining the money impact and is not reachable by the same keyboard/AT path as the rest of the UI.
export type MoneyAction = "execute" | "rollback";

function BatchActionBar({
  batchId,
  status,
  role,
  canFreeze,
  freezeReason,
  canApprove,
  approveReason,
  canExecute,
  executeReason,
  canRollback,
  rollbackReason,
  executedRows,
  summaryLines,
}: {
  batchId: string;
  status: string;
  role: string;
  canFreeze: boolean;
  freezeReason: string | null;
  canApprove: boolean;
  approveReason: string | null;
  canExecute: boolean;
  executeReason: string | null;
  canRollback: boolean;
  rollbackReason: string | null;
  executedRows: number;
  summaryLines: ResultSummaryLine[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState<"freeze" | "approve" | MoneyAction | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [confirming, setConfirming] = useState<MoneyAction | null>(null);
  const [reason, setReason] = useState("");

  const isOwner = role === "owner";
  // Freeze is only meaningful while the batch is still editable; hiding it afterwards is what keeps
  // this strip to a single line once a batch reaches the money stages. The four are mutually
  // exclusive by status, which is why a single blocked-reason line below can serve all of them.
  const showFreeze = status === "staged";
  const showApprove = isOwner && status === "reviewed";
  const showExecute = isOwner && status === "approved";
  const showRollback = isOwner && (status === "executed" || status === "rolled_back");

  // Only the reason for the control the user can actually SEE is worth showing; a hidden control's
  // gate reason would just be noise (and, for a non-owner, would narrate a permission they lack).
  const blockedReason =
    [
      { show: showFreeze, allowed: canFreeze, reason: freezeReason },
      { show: showApprove, allowed: canApprove, reason: approveReason },
      { show: showExecute, allowed: canExecute, reason: executeReason },
      { show: showRollback, allowed: canRollback, reason: rollbackReason },
    ].find((gate) => gate.show && !gate.allowed)?.reason ?? null;

  /**
   * One shape for all four batch actions: mark pending, clear the last message, call the server
   * action, then either report the Arabic error or run the action's own cleanup and refresh.
   */
  async function runBatchAction(
    kind: "freeze" | "approve" | MoneyAction,
    call: () => Promise<ActionResult>,
    okText: string,
    failText: string,
    onOk?: () => void,
  ) {
    setPending(kind);
    setMsg(null);
    const result = await run(call);
    setPending(null);
    if (!result.ok) {
      setMsg({ tone: "danger", text: result.error ?? failText });
      return;
    }
    onOk?.();
    setMsg({ tone: "ok", text: okText });
    router.refresh();
  }

  function doRollback() {
    // Mirrors the RPC's own rule so the owner keeps their text instead of getting a raw DB error.
    if (reason.trim().length === 0) {
      setMsg({ tone: "danger", text: "سبب التراجع مطلوب ولا يمكن أن يكون فارغًا." });
      return;
    }
    return runBatchAction(
      "rollback",
      () => rollbackBatch({ batchId, reason }),
      "تم التراجع عن الدفعة وإعادة الأرقام كما كانت.",
      "تعذّر التراجع عن الدفعة.",
      () => {
        setConfirming(null);
        setReason("");
      },
    );
  }

  return (
    <div
      className="flex flex-col gap-2 rounded-lg px-4 py-3"
      style={{ border: "1px solid var(--line)", backgroundColor: "var(--surface)" }}
    >
      <div className="flex flex-wrap items-center gap-2">
        {showFreeze && (
          <Button
            size="sm"
            onClick={() =>
              runBatchAction(
                "freeze",
                () => freezeBatch(batchId),
                "تم تجميد الدفعة.",
                "تعذّر التجميد.",
              )
            }
            loading={pending === "freeze"}
            disabled={!canFreeze || pending !== null}
          >
            تجميد الدفعة
          </Button>
        )}
        {showApprove && (
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              runBatchAction(
                "approve",
                () => approveBatch(batchId),
                "تم اعتماد الدفعة.",
                "تعذّر الاعتماد.",
              )
            }
            loading={pending === "approve"}
            disabled={!canApprove || pending !== null}
          >
            اعتماد الدفعة
          </Button>
        )}
        {showExecute && (
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setMsg(null);
              setConfirming((v) => (v === "execute" ? null : "execute"));
            }}
            disabled={!canExecute || pending !== null}
          >
            تنفيذ الدفعة (ترحيل مالي)
          </Button>
        )}
        {showRollback && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setMsg(null);
              setConfirming((v) => (v === "rollback" ? null : "rollback"));
            }}
            disabled={!canRollback || pending !== null}
          >
            التراجع عن التنفيذ
          </Button>
        )}
        {(status === "executed" || status === "rolled_back") && (
          <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
            صفوف نُفِّذت: {num(executedRows)}
          </span>
        )}
        {summaryLines.map((line) => (
          <span key={line.key} className="text-xs" style={{ color: "var(--ink-muted)" }}>
            {line.label}: {line.kind === "count" ? num(line.count) : line.text}
          </span>
        ))}
      </div>

      {blockedReason && (
        <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
          {blockedReason}
        </p>
      )}

      {confirming === "execute" && canExecute && (
        <div
          className="flex flex-col gap-2 rounded-md px-3 py-2"
          style={{ background: "var(--surface-raised)" }}
        >
          <p className="text-xs" style={{ color: "var(--ink)" }}>
            سيُنشئ التنفيذ المصروفات والمبيعات المعتمدة ويُرحّل قيودها على خزينة المزرعة فورًا —
            أرقام الأرباح والإيرادات ستتغيّر. لا يُلغى التنفيذ بحذف أي شيء: يُلغى فقط بعملية «تراجع»
            تُنشئ قيودًا عكسية وتُعيد القيود الأصلية.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              size="sm"
              onClick={() =>
                runBatchAction(
                  "execute",
                  () => executeBatch(batchId),
                  "تم تنفيذ الدفعة وترحيل قيودها.",
                  "تعذّر تنفيذ الدفعة.",
                  () => setConfirming(null),
                )
              }
              loading={pending === "execute"}
              disabled={pending !== null}
            >
              تأكيد التنفيذ
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(null)} disabled={pending !== null}>
              إلغاء
            </Button>
          </div>
        </div>
      )}

      {confirming === "rollback" && canRollback && (
        <div
          className="flex flex-col gap-2 rounded-md px-3 py-2"
          style={{ background: "var(--surface-raised)" }}
        >
          <p className="text-xs" style={{ color: "var(--ink)" }}>
            سيعكس التراجع كل قيد أنشأته هذه الدفعة ويُعيد كل قيد عكسته — بقيود جديدة، دون حذف أي
            سجل. أرقام الأرباح والإيرادات ستعود كما كانت قبل التنفيذ، ولا يمكن تنفيذ هذه الدفعة مرة
            أخرى بعد التراجع.
          </p>
          <Field label="سبب التراجع (إلزامي)" id="rollback-reason" required>
            <Textarea
              id="rollback-reason"
              rows={2}
              maxLength={ROLLBACK_REASON_MAX}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              size="sm"
              onClick={doRollback}
              loading={pending === "rollback"}
              disabled={pending !== null || reason.trim().length === 0}
            >
              تأكيد التراجع
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setConfirming(null);
                setReason("");
              }}
              disabled={pending !== null}
            >
              إلغاء
            </Button>
          </div>
        </div>
      )}

      <div role="alert" aria-live="assertive" aria-atomic="true">
        {msg && <Alert tone={msg.tone} title={msg.text} />}
      </div>
    </div>
  );
}

export function ReconciliationControls({
  batchId,
  status,
  role,
  rows,
  options,
  editable,
  canFreeze,
  freezeReason,
  canApprove,
  approveReason,
  canExecute,
  executeReason,
  canRollback,
  rollbackReason,
  executedRows,
  summaryLines,
  page,
  pageCount,
  from,
  to,
  total,
  hasActiveFilters,
  previousHref,
  nextHref,
}: {
  batchId: string;
  status: string;
  role: string;
  rows: RowVM[];
  options: OptionList;
  editable: boolean;
  canFreeze: boolean;
  freezeReason: string | null;
  canApprove: boolean;
  approveReason: string | null;
  canExecute: boolean;
  executeReason: string | null;
  canRollback: boolean;
  rollbackReason: string | null;
  executedRows: number;
  summaryLines: ResultSummaryLine[];
  page: number;
  pageCount: number;
  from: number;
  to: number;
  total: number;
  hasActiveFilters: boolean;
  previousHref: string;
  nextHref: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <BatchActionBar
        batchId={batchId}
        status={status}
        role={role}
        canFreeze={canFreeze}
        freezeReason={freezeReason}
        canApprove={canApprove}
        approveReason={approveReason}
        canExecute={canExecute}
        executeReason={executeReason}
        canRollback={canRollback}
        rollbackReason={rollbackReason}
        executedRows={executedRows}
        summaryLines={summaryLines}
      />

      <div className="flex flex-col gap-3">
        {rows.length === 0 && hasActiveFilters ? (
          <EmptyState title="لا توجد صفوف تطابق عوامل التصفية" />
        ) : (
          rows.map((row) => (
            <RowCard
              key={row.id}
              row={row}
              batchId={batchId}
              classification={row.classification}
              editable={editable}
              options={options}
            />
          ))
        )}
      </div>

      <nav className="flex items-center justify-between gap-3 text-sm" aria-label="ترقيم الصفحات">
        <span style={{ color: "var(--ink-muted)" }}>
          الصفوف المطابقة: {num(from)}–{num(to)} من {num(total)}
        </span>
        <div className="flex gap-2">
          <PageLink href={previousHref} disabled={page <= 1} label="السابق" />
          <span style={{ color: "var(--ink-muted)" }}>
            صفحة {num(page)} من {num(pageCount)}
          </span>
          <PageLink href={nextHref} disabled={page >= pageCount} label="التالي" />
        </div>
      </nav>
    </div>
  );
}

function PageLink({
  href,
  disabled,
  label,
}: {
  href: string;
  disabled: boolean;
  label: string;
}) {
  if (disabled) {
    return (
      <span className="rounded-md px-3 py-1" style={{ color: "var(--ink-muted)", border: "1px solid var(--line)" }}>
        {label}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className="rounded-md px-3 py-1"
      style={{ border: "1px solid var(--line)", color: "var(--ink)" }}
    >
      {label}
    </Link>
  );
}
