import { requireRole } from "@/lib/auth";
import { parseAccountingLedgerSnapshot } from "@/lib/accounting ledger snapshot";
import { createClient } from "@/lib/supabase/server";
import { AccountingLedgerView } from "./accounting-ledger-view";

// SPEC-0004 / SPEC-0033 R4h — one exact, bounded accounting snapshot.
export default async function AccountingPage() {
  const member = await requireRole(["owner", "accountant"]);
  const sb = await createClient();
  const snapshotRes = await sb.rpc("fn_accounting_ledger_snapshot", {
    p_org: member.orgId,
    p_entry_limit: 20,
  });
  if (snapshotRes.error) throw snapshotRes.error;
  const snapshot = parseAccountingLedgerSnapshot(snapshotRes.data, member.orgId);

  return <AccountingLedgerView snapshot={snapshot} />;
}
