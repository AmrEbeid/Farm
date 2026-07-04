import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { CustodyInWizard } from "@/components/CustodyInWizard";

// SPEC-0025 U-2 — «استلمت عهدة من المالك»: the cash-IN wizard. One guided step over the live
// fn_record_custody_movement (which posts the funding journal itself). owner/accountant.

export const dynamic = "force-dynamic";

export default async function RecordCustodyInPage() {
  await requireRole(["owner", "accountant"]);
  const sb = await createClient();
  const { data } = await sb.from("custody_accounts").select("id, holder_label, active").order("holder_label");
  return (
    <div className="p-6">
      <CustodyInWizard
        accounts={(data ?? []).filter((c) => c.active).map((c) => ({ id: c.id, label: c.holder_label }))}
      />
    </div>
  );
}
