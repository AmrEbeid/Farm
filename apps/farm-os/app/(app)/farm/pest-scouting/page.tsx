import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import { fmtDate } from "@/lib/dates";
import { num } from "@/lib/money";
import { trapStatus } from "@/lib/pest-scouting";
import { TRAP_STATUS_AR, INCIDENT_SEVERITY_AR } from "@/lib/labels";
import { type SimpleColumn } from "@/components/SimpleTable";
import { MasterTable, type MasterField } from "@/components/MasterTable";
import { PrintButton } from "@/components/print-button";
import {
  registerTrapFromForm,
  logCatchFromForm,
  reportIncidentFromForm,
  updateTrapFromForm,
} from "@/app/(app)/farm/pest-scouting/actions";

// Roles that pass authorize('op.execute') — the same gate the pest-scouting tables' RLS WITH CHECK
// enforces (RPW-1: placing/checking a trap and logging a catch are FIELD activities, the same roles
// who record any other field observation — see migration 20260701300000's header for the full
// op.execute-vs-structure.write reasoning).
const WRITE_ROLES = ["owner", "farm_manager", "agri_engineer", "supervisor"];

type OneOrMany<T> = T | T[] | null;
function one<T>(v: OneOrMany<T>): T | null {
  return (Array.isArray(v) ? v[0] : v) ?? null;
}

export default async function PestScoutingPage() {
  const m = await requireMembership();
  const sb = await createClient();

  const [{ data: traps, error: trapsError }, { data: catches, error: catchesError }, { data: incidents, error: incidentsError }] =
    await Promise.all([
      sb
        .from("pest_traps")
        .select(
          "id, code, label, installed_at, lure_changed_at, status, notes, sectors(name), hawshat(name), lines(line_no, line_code)",
        )
        .order("code"),
      sb
        .from("pest_trap_catches")
        .select("id, trap_id, checked_at, catch_count, notes, pest_traps(code, label)")
        .order("checked_at", { ascending: false })
        .limit(100),
      sb
        .from("pest_incidents")
        .select("id, reported_at, severity, notes, response_action, pest_traps(code), assets(id_tag)")
        .order("reported_at", { ascending: false })
        .limit(50),
    ]);
  if (trapsError) throw trapsError;
  if (catchesError) throw catchesError;
  if (incidentsError) throw incidentsError;

  // Latest checked_at per trap, derived from the already-fetched (checked_at DESC) catch log — the
  // first row seen per trap_id is its latest check. No SQL view (see lib/pest-scouting.ts header).
  const lastCheckedByTrap = new Map<string, string>();
  for (const c of catches ?? []) {
    if (c.trap_id && !lastCheckedByTrap.has(c.trap_id)) lastCheckedByTrap.set(c.trap_id, c.checked_at);
  }

  const trapRows = (traps ?? []).map((t) => {
    const sector = one<{ name: string }>(t.sectors);
    const hawsha = one<{ name: string }>(t.hawshat);
    const line = one<{ line_no: number; line_code: string | null }>(t.lines);
    const location =
      [sector?.name, hawsha?.name, line ? `خط ${line.line_no}` : null].filter(Boolean).join(" / ") || "—";

    const derived = trapStatus({
      installedAt: t.installed_at,
      lureChangedAt: t.lure_changed_at,
      lastCheckedAt: lastCheckedByTrap.get(t.id) ?? null,
      status: t.status as "active" | "removed",
    });

    return {
      row: {
        id: t.id,
        code: t.code,
        label: t.label,
        location,
        installedAt: fmtDate(t.installed_at),
        lureChangedAt: fmtDate(t.lure_changed_at),
        daysSinceLure: derived.daysSinceLureChange != null ? num(derived.daysSinceLureChange) : "—",
        needsLure: derived.needsLureChange ? "تحتاج تغيير" : "",
        lastChecked: fmtDate(lastCheckedByTrap.get(t.id) ?? null),
        daysSinceCheck: derived.daysSinceLastCheck != null ? num(derived.daysSinceLastCheck) : "—",
        overdueCheck: derived.overdueCheck ? "متأخر" : "",
        status: TRAP_STATUS_AR[t.status] ?? t.status,
      },
      needsAttention: derived.needsLureChange || derived.overdueCheck,
    };
  });

  const trapColumns: SimpleColumn[] = [
    { id: "code", header: "الكود" },
    { id: "label", header: "اسم المصيدة" },
    { id: "location", header: "الموقع" },
    { id: "installedAt", header: "تاريخ التركيب" },
    { id: "lureChangedAt", header: "آخر تغيير فرمون" },
    { id: "daysSinceLure", header: "أيام منذ تغيير الفرمون", numeric: true },
    { id: "needsLure", header: "يحتاج فرمون", kind: "tag-warn" },
    { id: "daysSinceCheck", header: "أيام منذ آخر فحص", numeric: true },
    { id: "overdueCheck", header: "فحص متأخر", kind: "tag-danger" },
    { id: "status", header: "الحالة" },
  ];

  const attentionRows = trapRows.filter((r) => r.needsAttention).map((r) => r.row);
  const allTrapRows = trapRows.map((r) => r.row);

  const catchRows = (catches ?? []).slice(0, 100).map((c) => {
    const trap = one<{ code: string; label: string }>(c.pest_traps);
    return {
      id: c.id,
      trap: trap ? `${trap.code} — ${trap.label}` : "—",
      checkedAt: fmtDate(c.checked_at),
      catchCount: num(c.catch_count),
      notes: c.notes ?? "—",
    };
  });
  const catchColumns: SimpleColumn[] = [
    { id: "trap", header: "المصيدة" },
    { id: "checkedAt", header: "تاريخ الفحص" },
    { id: "catchCount", header: "عدد الصيد", numeric: true },
    { id: "notes", header: "ملاحظات" },
  ];

  const incidentRows = (incidents ?? []).map((i) => {
    const trap = one<{ code: string }>(i.pest_traps);
    const asset = one<{ id_tag: string | null }>(i.assets);
    return {
      id: i.id,
      anchor: [trap?.code, asset?.id_tag].filter(Boolean).join(" / ") || "—",
      reportedAt: fmtDate(i.reported_at),
      severity: INCIDENT_SEVERITY_AR[i.severity] ?? i.severity,
      responseAction: i.response_action ?? "—",
      notes: i.notes ?? "—",
    };
  });
  const incidentColumns: SimpleColumn[] = [
    { id: "anchor", header: "المصيدة / النخلة" },
    { id: "reportedAt", header: "تاريخ البلاغ" },
    { id: "severity", header: "الدرجة" },
    { id: "responseAction", header: "إجراء الاستجابة" },
    { id: "notes", header: "ملاحظات" },
  ];

  const canWrite = WRITE_ROLES.includes(m.role);

  const trapFields: MasterField[] = [
    { key: "code", label: "كود المصيدة", required: true, maxLength: 40 },
    { key: "label", label: "اسم المصيدة (مثال: مصيدة ٣ - قطاع أ)", required: true, maxLength: 120 },
    { key: "installedAt", label: "تاريخ التركيب (YYYY-MM-DD)", required: true, maxLength: 10 },
    { key: "sectorCode", label: "رمز القطاع (اختياري)", maxLength: 20 },
    { key: "hawshaCode", label: "رمز الحوشة (اختياري)", maxLength: 20 },
    { key: "lineCode", label: "رمز الخط (اختياري)", maxLength: 20 },
    { key: "lureChangedAt", label: "تاريخ تغيير الفرمون (اختياري)", maxLength: 10 },
    { key: "notes", label: "ملاحظات", maxLength: 300 },
  ];

  const updateTrapFields: MasterField[] = [
    { key: "trapCode", label: "كود المصيدة", required: true, maxLength: 40 },
    { key: "lureChangedAt", label: "تاريخ تغيير الفرمون الجديد (YYYY-MM-DD)", maxLength: 10 },
    { key: "status", label: "الحالة الجديدة (active / removed، اختياري)", maxLength: 20 },
    { key: "notes", label: "ملاحظات", maxLength: 300 },
  ];

  const catchFields: MasterField[] = [
    { key: "trapCode", label: "كود المصيدة", required: true, maxLength: 40 },
    { key: "checkedAt", label: "تاريخ الفحص (YYYY-MM-DD)", required: true, maxLength: 10 },
    { key: "catchCount", label: "عدد الصيد", type: "number", required: true },
    { key: "notes", label: "ملاحظات", maxLength: 300 },
  ];

  const incidentFields: MasterField[] = [
    { key: "trapCode", label: "كود المصيدة (اختياري)", maxLength: 40 },
    { key: "palmIdTag", label: "رقم تعريف النخلة (اختياري)", maxLength: 60 },
    { key: "reportedAt", label: "تاريخ البلاغ (YYYY-MM-DD)", required: true, maxLength: 10 },
    { key: "severity", label: "الدرجة (watch / suspected / confirmed)", required: true, maxLength: 20 },
    { key: "responseAction", label: "إجراء الاستجابة (مثال: جدولة رش وقائي)", maxLength: 200 },
    { key: "notes", label: "ملاحظات", maxLength: 300 },
  ];

  return (
    <div className="flex flex-col gap-8 p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">مكافحة سوسة النخيل الحمراء</h1>
          <p style={{ color: "var(--ink-muted)" }}>
            سجل المصائد الفرمونية، الرصد الأسبوعي، وبلاغات الاشتباه بالإصابة. سجل ميداني للبيانات الحقيقية —
            وليس نظام إنذار آلي.
          </p>
        </div>
        <PrintButton label="طباعة سجل المكافحة" />
      </header>

      <MasterTable
        title="المصائد التي تحتاج انتباه الآن"
        description="مصائد تجاوز فرمونها ٩٠ يومًا، أو لم تُفحص منذ أكثر من ١٠ أيام"
        columns={trapColumns}
        rows={attentionRows}
        fields={updateTrapFields}
        canWrite={canWrite}
        onCreate={updateTrapFromForm}
        addLabel="+ تحديث مصيدة (فرمون / حالة)"
        exportFilename="pest-traps-attention"
        empty="لا توجد مصائد تحتاج انتباهًا الآن"
      />

      <MasterTable
        title="سجل المصائد"
        description="كل المصائد الفرمونية المسجلة بموقعها وحالتها"
        columns={trapColumns}
        rows={allTrapRows}
        fields={trapFields}
        canWrite={canWrite}
        onCreate={registerTrapFromForm}
        addLabel="+ تسجيل مصيدة جديدة"
        searchColumns={["code", "label", "location"]}
        placeholder="ابحث بالكود أو الاسم أو الموقع…"
        exportFilename="pest-traps"
        empty="لا توجد مصائد مسجلة بعد"
      />

      <MasterTable
        title="سجل الرصد الأسبوعي"
        description="آخر ١٠٠ عملية رصد لعدد الصيد في كل مصيدة"
        columns={catchColumns}
        rows={catchRows}
        fields={catchFields}
        canWrite={canWrite}
        onCreate={logCatchFromForm}
        addLabel="+ تسجيل رصد جديد"
        searchColumns={["trap"]}
        placeholder="ابحث باسم المصيدة…"
        exportFilename="pest-trap-catches"
        empty="لا يوجد رصد مسجل بعد"
      />

      <MasterTable
        title="بلاغات الاشتباه بالإصابة"
        description="بلاغ ميداني بدرجة الاشتباه وإجراء الاستجابة — ليس تشخيصًا نهائيًا"
        columns={incidentColumns}
        rows={incidentRows}
        fields={incidentFields}
        canWrite={canWrite}
        onCreate={reportIncidentFromForm}
        addLabel="+ بلاغ اشتباه جديد"
        exportFilename="pest-incidents"
        empty="لا توجد بلاغات مسجلة"
      />
    </div>
  );
}
