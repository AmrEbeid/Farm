import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { TX_ROW_LIMIT } from "@/lib/transactions-ledger";
import { parseTransactionsListContext } from "@/lib/transactions-list-context";
import { parseTransactionsSnapshot } from "@/lib/transactions snapshot";
import { TransactionsListView } from "./transactions-list-view";

// SPEC-0025 U-3 / SPEC-0033 R4e — one bounded, read-only ledger snapshot.
export const dynamic = "force-dynamic";

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; q?: string }>;
}) {
  const m = await requireRole(["owner", "accountant"]);
  const context = parseTransactionsListContext(await searchParams);
  const sb = await createClient();
  const snapshotRes = await sb.rpc("fn_transactions_snapshot", {
    p_org: m.orgId,
    p_row_limit: TX_ROW_LIMIT,
  });
  if (snapshotRes.error) throw snapshotRes.error;
  const snapshot = parseTransactionsSnapshot(snapshotRes.data, m.orgId);
  return <TransactionsListView snapshot={snapshot} context={context} />;
}
