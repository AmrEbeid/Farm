// السجل النشاط غير المخطط (SPEC-0030 A4, #778). The task-first entry for capturing UNPLANNED field work —
// the /record «نفّذت عملية» card only reaches PLANNED operations (/m), leaving off-plan activity with nowhere
// to go. Here a field role picks the location and records the activity via the existing gated fn_record_event
// path. Server Component; gated to the roles the RPC's op.execute permission actually admits.

import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { StoryLine } from "@/components/StoryLine";
import { UnplannedActivityPicker } from "@/components/UnplannedActivityPicker";

export const dynamic = "force-dynamic";

export default async function RecordActivityPage() {
  await requireRole(["owner", "farm_manager", "agri_engineer", "supervisor"]);
  const sb = await createClient();

  const { data: sectors } = await sb
    .from("sectors")
    .select("id, name")
    .order("name", { ascending: true });
  const rows = (sectors ?? []).map((s) => ({ id: s.id, name: s.name }));

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
      <header>
        <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>سجّل نشاطًا غير مخطط</h1>
        <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
          نفّذت عملًا في الحقل لم يكن ضمن خطة؟ سجّله هنا — فحصًا، ملاحظة، أو عملية — واربطه بالقطاع الذي تمّ فيه.
        </p>
      </header>

      <StoryLine lead={
        rows.length === 0
          ? "لا قطاعات مسجّلة بعد — أضِف قطاعًا من هيكل المزرعة أولًا."
          : "اختر القطاع، ثم صف النشاط الذي تمّ. يُسجَّل في سجل ذلك الموقع فورًا."
      } />

      <UnplannedActivityPicker sectors={rows} />
    </div>
  );
}
