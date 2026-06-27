// Stage 11 (SPEC-0005 §2 / CLAUDE.md lethal-trifecta) — the عبدالجليل assistant CAPABILITY BOUNDARY.
// This is NOT the AI; it is the deny-by-default gate that ANY future AI tool layer MUST pass every call
// through, so the assistant can never exceed the four trifecta-breaking controls:
//   §2.1 no elevated credentials (no service_role / admin / bypassrls — RLS-scoped session only)
//   §2.2 read-only, RLS-scoped RPC tools ONLY (no write RPC; no compensation/PII; no raw service access)
//   §2.3 no mass outbound (no send/email/sms/whatsapp/notify/webhook — only output is the chat reply)
//   permission parity (SPEC-0006): compensation/payroll is NEVER surfaced to the AI.
//
// Pure + deny-by-default: anything not explicitly allow-listed as a read tool is refused. Tested.

// The ONLY tools the assistant may call — read-only, RLS-scoped read RPCs (the model never touches raw
// tables or the service role). New assistant read RPCs get added HERE explicitly, after review.
export const ASSISTANT_READ_TOOLS: ReadonlySet<string> = new Set<string>([
  "fn_stock_coverage", // existing read RPC (the stock wedge) — RLS-scoped, no PII
  // future (each reviewed before adding): fn_assistant_farm_summary, fn_assistant_plan_status, …
]);

const WRITE_RPC = /^fn_(save|archive|add|create|set|update|delete|execute|post|reserve|record|run|assign|revert|bin)_/i;
const SENSITIVE = /(compensation|payroll|salary|wage|\brate\b|phone|email|pii)/i;
const OUTBOUND = /(send|email|sms|whatsapp|notify|webhook|outbound|\bmail\b|broadcast)/i;
const PRIVILEGED = /(service.?role|bypassrls|set.?role|admin|superuser)/i;

export interface PolicyDecision {
  allowed: boolean;
  reason?: string; // why it was refused (for audit/telemetry)
}

/**
 * Decide whether the assistant may invoke `tool`. DENY-BY-DEFAULT: only an explicitly allow-listed
 * read RPC is permitted; every privileged / outbound / sensitive / write / unknown name is refused.
 * The checks run refusal-first so a name that matches several forbidden classes still refuses.
 */
export function assistantMayCall(tool: string): PolicyDecision {
  const t = typeof tool === "string" ? tool.trim() : "";
  if (t === "") return { allowed: false, reason: "empty tool name (deny-by-default)" };
  if (PRIVILEGED.test(t)) return { allowed: false, reason: "no elevated credentials (§2.1)" };
  if (OUTBOUND.test(t)) return { allowed: false, reason: "no outbound/send (§2.3 — breaks the trifecta)" };
  if (SENSITIVE.test(t)) return { allowed: false, reason: "no compensation/PII (§2.2, SPEC-0006 parity)" };
  if (WRITE_RPC.test(t)) return { allowed: false, reason: "read-only — no write RPC (§2.2)" };
  if (ASSISTANT_READ_TOOLS.has(t)) return { allowed: true };
  return { allowed: false, reason: "not on the read allow-list (deny-by-default)" };
}

/**
 * Assert the data client the assistant is handed is the RLS-scoped session client, never a privileged
 * one (§2.1). A future AI route calls this with the client kind before any tool runs.
 */
export function assertRlsScopedClient(kind: "session" | "service_role" | "admin"): void {
  if (kind !== "session") {
    throw new Error("assistant must use the RLS-scoped session client, never a privileged one (§2.1)");
  }
}
