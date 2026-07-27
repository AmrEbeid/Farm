import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  executeGate,
  rollbackGate,
  validateRollbackReason,
  summarizeResultSummary,
  parseExecuteOutcome,
  parseRollbackOutcome,
  executionFailureMessage,
  ROLLBACK_REASON_MAX,
  EXECUTION_FAILURE_AR,
} from "../reconciliation review";

const ACTIONS = readFileSync(
  join(process.cwd(), "app", "(app)", "finance", "reconciliation", "actions.ts"),
  "utf8",
);
const CONTROLS = readFileSync(
  join(process.cwd(), "app", "(app)", "finance", "reconciliation", "[batchId]", "controls.tsx"),
  "utf8",
);
const PAGE = readFileSync(
  join(process.cwd(), "app", "(app)", "finance", "reconciliation", "[batchId]", "page.tsx"),
  "utf8",
);

describe("execute gate — owner only, approved only", () => {
  it("lets an owner execute an approved batch", () => {
    expect(executeGate("approved", "owner")).toEqual({ canExecute: true, reason: null });
  });

  it("refuses every non-owner role, even on an approved batch", () => {
    for (const role of ["accountant", "farm_manager", "worker", "agronomist"]) {
      const gate = executeGate("approved", role);
      expect(gate.canExecute, `role ${role} must not execute`).toBe(false);
      expect(gate.reason).toBe("التنفيذ للمالك فقط.");
    }
  });

  it("refuses every batch status that is not approved", () => {
    for (const status of ["staged", "reviewed", "executing", "executed", "failed", "rolled_back"]) {
      const gate = executeGate(status, "owner");
      expect(gate.canExecute, `status ${status} must not execute`).toBe(false);
      expect(gate.reason).toBe("لا يُنفَّذ إلا بعد اعتماد الدفعة.");
    }
  });
});

describe("rollback gate — owner only, executed only", () => {
  it("lets an owner roll back an executed batch", () => {
    expect(rollbackGate("executed", "owner")).toEqual({ canRollback: true, reason: null });
  });

  it("refuses every non-owner role, even on an executed batch", () => {
    for (const role of ["accountant", "farm_manager", "worker"]) {
      const gate = rollbackGate("executed", role);
      expect(gate.canRollback, `role ${role} must not roll back`).toBe(false);
      expect(gate.reason).toBe("التراجع للمالك فقط.");
    }
  });

  it("says so plainly when the batch is already rolled back, rather than repeating the state rule", () => {
    expect(rollbackGate("rolled_back", "owner")).toEqual({
      canRollback: false,
      reason: "تم التراجع عن هذه الدفعة بالفعل.",
    });
  });

  it("refuses every other batch status", () => {
    for (const status of ["staged", "reviewed", "approved", "executing", "failed"]) {
      const gate = rollbackGate(status, "owner");
      expect(gate.canRollback, `status ${status} must not roll back`).toBe(false);
      expect(gate.reason).toBe("لا يمكن التراجع إلا عن دفعة مُنفَّذة.");
    }
  });

  it("checks the role BEFORE the status, so an accountant never learns a batch is rollbackable", () => {
    expect(rollbackGate("rolled_back", "accountant").reason).toBe("التراجع للمالك فقط.");
    expect(executeGate("approved", "accountant").reason).toBe("التنفيذ للمالك فقط.");
  });
});

describe("rollback reason — mandatory, trimmed, bounded", () => {
  it("rejects a missing, empty or whitespace-only reason", () => {
    for (const value of [undefined, null, "", "   ", "\n\t ", 42, {}]) {
      const result = validateRollbackReason(value);
      expect(result.ok, `value ${JSON.stringify(value)} must be rejected`).toBe(false);
      if (!result.ok) expect(result.error).toBe("سبب التراجع مطلوب ولا يمكن أن يكون فارغًا.");
    }
  });

  it("trims exactly as the RPC does, so the audited reason matches what was typed", () => {
    const result = validateRollbackReason("  تصحيح خطأ ترحيل  ");
    expect(result).toEqual({ ok: true, reason: "تصحيح خطأ ترحيل" });
  });

  it("accepts a reason exactly at the RPC's bound and rejects one character more", () => {
    expect(validateRollbackReason("س".repeat(ROLLBACK_REASON_MAX)).ok).toBe(true);
    const tooLong = validateRollbackReason("س".repeat(ROLLBACK_REASON_MAX + 1));
    expect(tooLong.ok).toBe(false);
    // The numeric bound stays 500; the message must render it in Arabic-Indic digits like every
    // other number this app shows, so pin the exact rendered text AND the exact Western absence.
    if (!tooLong.ok) {
      expect(tooLong.error).toBe("سبب التراجع طويل جدًا (الحد ٥٠٠ حرفًا).");
      expect(tooLong.error).not.toContain("500");
      expect(tooLong.error).not.toMatch(/[0-9]/);
    }
  });

  it("keeps the bound itself a plain number, so the comparison never depends on formatting", () => {
    expect(ROLLBACK_REASON_MAX).toBe(500);
    expect(validateRollbackReason("س".repeat(500)).ok).toBe(true);
    expect(validateRollbackReason("س".repeat(501)).ok).toBe(false);
  });

  it("measures the bound AFTER trimming, matching the RPC's trim-then-bound order", () => {
    expect(validateRollbackReason(`   ${"س".repeat(ROLLBACK_REASON_MAX)}   `).ok).toBe(true);
  });
});

describe("result_summary display — truthful, redacted, never fabricated", () => {
  it("renders the execution summary counts", () => {
    expect(summarizeResultSummary({ executed_rows: 3, skipped_rows: 1 })).toEqual([
      { key: "executed_rows", label: "صفوف نُفِّذت", kind: "count", count: 3 },
      { key: "skipped_rows", label: "صفوف متجاوَزة", kind: "count", count: 1 },
    ]);
  });

  it("renders the rollback summary counts and the owner's own reason", () => {
    const lines = summarizeResultSummary({
      rolled_back_at: "2026-07-27T00:00:00Z",
      rollback_reason: "  إلغاء تصحيح غير صحيح  ",
      reversed_journals: 2,
      reinstated_journals: 1,
      zero_value_rows: 0,
      ledger_rows_reversed: 2,
      rows_marked_reversed: 1,
    });
    expect(lines.map((l) => l.key)).toEqual([
      "reversed_journals",
      "reinstated_journals",
      "zero_value_rows",
      "ledger_rows_reversed",
      "rows_marked_reversed",
      "rollback_reason",
    ]);
    expect(lines).toContainEqual({
      key: "rollback_reason",
      label: "سبب التراجع",
      kind: "text",
      text: "إلغاء تصحيح غير صحيح",
    });
    // A real zero must survive as 0, not be dropped as falsy.
    expect(lines).toContainEqual({
      key: "zero_value_rows",
      label: "صفوف بقيمة صفرية",
      kind: "count",
      count: 0,
    });
  });

  it("NEVER surfaces the row-level safe_locator", () => {
    const lines = summarizeResultSummary({
      failure_code: "locked_period",
      safe_locator: "11111111-1111-4111-8111-111111111111",
    });
    expect(lines.map((l) => l.key)).toEqual(["failure_code"]);
    expect(JSON.stringify(lines)).not.toContain("11111111");
  });

  it("maps every known failure code to Arabic and never leaks a raw one", () => {
    for (const code of [...Object.keys(EXECUTION_FAILURE_AR), "brand_new_code"]) {
      expect(summarizeResultSummary({ failure_code: code })).toEqual([
        {
          key: "failure_code",
          label: "سبب الفشل",
          kind: "text",
          text: EXECUTION_FAILURE_AR[code] ?? "فشل غير مصنَّف",
        },
      ]);
    }
  });

  it("drops a malformed or unknown key instead of guessing a number", () => {
    expect(
      summarizeResultSummary({
        executed_rows: "3",
        skipped_rows: null,
        reversed_journals: Number.NaN,
        some_future_key: 9,
      }),
    ).toEqual([]);
  });

  it("returns nothing for a null / non-object / array summary", () => {
    for (const value of [null, undefined, "x", 5, [1, 2]]) {
      expect(summarizeResultSummary(value)).toEqual([]);
    }
  });
});

// ── The release-blocker regression. fn_execute_reconciliation_batch catches a non-transient failure,
//    records it on the batch, and RETURNS {status:"failed", …} with NO PostgREST error — so a caller
//    that trusts `error` alone tells the owner the money posted when nothing did. These are executable
//    assertions against the real parser, not source-shape checks. ────────────────────────────────────
const SAFE_LOCATOR = "11111111-1111-4111-8111-111111111111";

describe("parseExecuteOutcome — a RETURNED failure is a failure", () => {
  it("accepts the executed verdict", () => {
    expect(parseExecuteOutcome({ batch_id: "b", status: "executed", executed_rows: 3 })).toEqual({
      ok: true,
      status: "executed",
      idempotent: false,
    });
  });

  it("accepts the idempotent repeat of an already-executed batch", () => {
    expect(parseExecuteOutcome({ batch_id: "b", status: "executed", idempotent: true })).toEqual({
      ok: true,
      status: "executed",
      idempotent: true,
    });
  });

  it("REJECTS a returned `failed` verdict even though PostgREST reported no error", () => {
    const outcome = parseExecuteOutcome({
      batch_id: "b",
      status: "failed",
      failure_code: "locked_period",
      safe_locator: SAFE_LOCATOR,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toContain(EXECUTION_FAILURE_AR.locked_period);
      expect(outcome.error).toContain("لم يُرحَّل أي شيء");
    }
  });

  it("maps every known failure code to its own Arabic reason", () => {
    for (const [code, label] of Object.entries(EXECUTION_FAILURE_AR)) {
      const outcome = parseExecuteOutcome({ status: "failed", failure_code: code });
      expect(outcome.ok, `code ${code} must not report success`).toBe(false);
      if (!outcome.ok) expect(outcome.error).toContain(label);
    }
  });

  it("never leaks the row-level safe_locator, whatever the failure code", () => {
    for (const code of [...Object.keys(EXECUTION_FAILURE_AR), "brand_new_code", undefined]) {
      const outcome = parseExecuteOutcome({ status: "failed", failure_code: code, safe_locator: SAFE_LOCATOR });
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.error).not.toContain(SAFE_LOCATOR);
    }
  });

  it("degrades an unknown or missing failure code instead of echoing it raw", () => {
    for (const code of ["brand_new_code", undefined, null, 7, {}]) {
      const outcome = parseExecuteOutcome({ status: "failed", failure_code: code });
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.error).toContain("فشل غير مصنَّف");
        expect(outcome.error).not.toContain("brand_new_code");
      }
    }
  });

  it("rejects the idempotent repeat of a FAILED batch, which carries no failure_code at all", () => {
    const outcome = parseExecuteOutcome({ batch_id: "b", status: "failed", idempotent: true });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain("فشل غير مصنَّف");
  });

  it("rejects the idempotent repeat of a rolled-back batch, which posted nothing", () => {
    const outcome = parseExecuteOutcome({ status: "rolled_back", idempotent: true });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain("سبق التراجع عنها");
  });

  it("fails CLOSED on a malformed, empty or unexpected response body", () => {
    for (const value of [
      null,
      undefined,
      "executed",
      5,
      true,
      [],
      [{ status: "executed" }],
      {},
      { status: "" },
      { status: "   " },
      { status: 5 },
      { status: null },
      { status: "executing" },
      { status: "approved" },
      { executed_rows: 3 },
    ]) {
      const outcome = parseExecuteOutcome(value);
      expect(outcome.ok, `${JSON.stringify(value)} must not report success`).toBe(false);
      if (!outcome.ok) expect(outcome.error).toContain("ردّ غير متوقَّع");
    }
  });

  it("treats a non-boolean `idempotent` as not idempotent rather than guessing", () => {
    const outcome = parseExecuteOutcome({ status: "executed", idempotent: "yes" });
    expect(outcome).toEqual({ ok: true, status: "executed", idempotent: false });
  });
});

describe("executionFailureMessage — Arabic only, raw codes never", () => {
  it("uses the shared failure map so the summary line and the action message cannot drift", () => {
    expect(executionFailureMessage("integrity_check")).toContain(
      EXECUTION_FAILURE_AR.integrity_check,
    );
  });

  it("says 'unclassified' for anything it does not recognise", () => {
    for (const code of ["nope", "", undefined, null, 3, []]) {
      expect(executionFailureMessage(code)).toContain("فشل غير مصنَّف");
    }
  });
});

describe("parseRollbackOutcome — the undo is read, not assumed", () => {
  it("accepts the rolled_back verdict and its idempotent repeat", () => {
    expect(parseRollbackOutcome({ status: "rolled_back", reversed_journals: 2 })).toEqual({
      ok: true,
      status: "rolled_back",
      idempotent: false,
    });
    expect(parseRollbackOutcome({ status: "rolled_back", idempotent: true })).toEqual({
      ok: true,
      status: "rolled_back",
      idempotent: true,
    });
  });

  it("fails CLOSED on every other body, including a stale `executed`", () => {
    for (const value of [null, undefined, {}, [], "rolled_back", { status: "executed" }, { status: "failed" }]) {
      const outcome = parseRollbackOutcome(value);
      expect(outcome.ok, `${JSON.stringify(value)} must not report success`).toBe(false);
      if (!outcome.ok) expect(outcome.error).toContain("ردّ غير متوقَّع");
    }
  });
});

// ── Source contracts. These assert the wiring the DB cannot: that the money actions go through the
//    user-session client, re-check the owner role, validate before the RPC, and revalidate both
//    routes — and that the UI never uses a native confirm(). ─────────────────────────────────────────
describe("server action contracts (source)", () => {
  it("both money actions require the owner role explicitly", () => {
    expect(ACTIONS).toMatch(/export async function executeBatch[\s\S]*?requireRole\(\["owner"\]\)/);
    expect(ACTIONS).toMatch(/export async function rollbackBatch[\s\S]*?requireRole\(\["owner"\]\)/);
  });

  it("both money actions validate the uuid BEFORE any RPC call", () => {
    expect(ACTIONS).toMatch(
      /export async function executeBatch[\s\S]*?if \(!isUuid\(batchId\)\)[\s\S]*?sb\.rpc\("fn_execute_reconciliation_batch"/,
    );
    expect(ACTIONS).toMatch(
      /export async function rollbackBatch[\s\S]*?if \(!isUuid\(candidate\.batchId\)\)[\s\S]*?sb\.rpc\("fn_rollback_reconciliation_batch"/,
    );
  });

  it("the rollback action validates the reason before the RPC", () => {
    expect(ACTIONS).toMatch(
      /export async function rollbackBatch[\s\S]*?validateRollbackReason\(candidate\.reason\)[\s\S]*?sb\.rpc\("fn_rollback_reconciliation_batch"/,
    );
  });

  it("both money actions revalidate the list and the detail route", () => {
    expect(ACTIONS).toMatch(
      /sb\.rpc\("fn_execute_reconciliation_batch"[\s\S]*?revalidateReconciliation\(batchId\)/,
    );
    expect(ACTIONS).toMatch(
      /sb\.rpc\("fn_rollback_reconciliation_batch"[\s\S]*?revalidateReconciliation\(/,
    );
  });

  it("reads the RPC RESPONSE on both money paths — `error` alone is not the verdict", () => {
    // fn_execute_reconciliation_batch returns {status:"failed"} with NO PostgREST error, so an action
    // that destructured only `{ error }` reported ok:true on a batch that atomically posted nothing.
    expect(ACTIONS).toMatch(
      /const \{ data, error \} = await sb\.rpc\("fn_execute_reconciliation_batch"[\s\S]*?parseExecuteOutcome\(data\)/,
    );
    expect(ACTIONS).toMatch(
      /const \{ data, error \} = await sb\.rpc\("fn_rollback_reconciliation_batch"[\s\S]*?parseRollbackOutcome\(data\)/,
    );
    // …and neither may return an unconditional success after the call.
    expect(ACTIONS).toMatch(/outcome\.ok \? \{ ok: true \} : \{ ok: false, error: outcome\.error \}/);
  });

  it("never surfaces the row-level safe_locator from any code path", () => {
    expect(ACTIONS).not.toContain("safe_locator");
  });

  it("never reaches for the service role — every call uses the user-session client", () => {
    expect(ACTIONS).not.toMatch(/service[_-]?role/i);
    expect(ACTIONS).toMatch(/import \{ createClient \} from "@\/lib\/supabase\/server"/);
  });

  it("maps 23514 away from the stock-engine default on both money paths", () => {
    // lib/errors.ts maps 23514 to "المخزون غير كافٍ…", which is nonsense for a finance RPC.
    for (const map of ["EXECUTE_PERM", "ROLLBACK_PERM"]) {
      const block = ACTIONS.slice(ACTIONS.indexOf(`const ${map}`));
      expect(block).toMatch(/"23514":/);
      expect(block.slice(0, block.indexOf("};"))).not.toContain("المخزون");
    }
  });

  it("maps every SQLSTATE the two RPCs can raise", () => {
    for (const map of ["EXECUTE_PERM", "ROLLBACK_PERM"]) {
      const block = ACTIONS.slice(ACTIONS.indexOf(`const ${map}`));
      const body = block.slice(0, block.indexOf("};"));
      for (const code of ['"42501"', '"22023"', '"23514"', '"55000"', "P0002"]) {
        expect(body, `${map} must map ${code}`).toContain(code);
      }
    }
    const rollback = ACTIONS.slice(ACTIONS.indexOf("const ROLLBACK_PERM"));
    expect(rollback.slice(0, rollback.indexOf("};"))).toContain('"23502"');
  });
});

describe("batch page + controls contracts (source)", () => {
  it("gates both money controls on the owner role in the client too", () => {
    expect(CONTROLS).toContain('const isOwner = role === "owner"');
    expect(CONTROLS).toContain('const showExecute = isOwner && status === "approved"');
    expect(CONTROLS).toMatch(/const showRollback = isOwner &&/);
  });

  it("uses an in-flow confirmation, never a native browser confirm", () => {
    expect(CONTROLS).not.toMatch(/\bwindow\.confirm\b|\bconfirm\(/);
    expect(CONTROLS).toContain('confirming === "execute"');
    expect(CONTROLS).toContain('confirming === "rollback"');
  });

  it("blocks the rollback submit until a reason is typed", () => {
    expect(CONTROLS).toContain("disabled={pending !== null || reason.trim().length === 0}");
  });

  it("caps the rollback reason textarea at the SAME bound the RPC enforces, by importing it", () => {
    // Imported, not re-typed: a literal here could drift from the RPC's 500-character rule.
    expect(CONTROLS).toContain("maxLength={ROLLBACK_REASON_MAX}");
    expect(CONTROLS).toMatch(
      /import \{ ROLLBACK_REASON_MAX \} from "@\/lib\/reconciliation review"/,
    );
  });

  it("states the money impact and the reversal/irreversibility in Arabic", () => {
    // JSX wraps long Arabic copy across lines, so compare against a whitespace-normalised source —
    // the assertion is about the words shown to the owner, not about where the formatter broke them.
    const flat = CONTROLS.replace(/\s+/g, " ");
    expect(flat).toContain("أرقام الأرباح والإيرادات ستتغيّر");
    expect(flat).toContain("أرقام الأرباح والإيرادات ستعود كما كانت قبل التنفيذ");
    expect(flat).toContain("بقيود جديدة، دون حذف أي سجل");
    expect(flat).toContain("لا يمكن تنفيذ هذه الدفعة مرة أخرى بعد التراجع");
    expect(flat).toContain("يُلغى فقط بعملية «تراجع» تُنشئ قيودًا عكسية وتُعيد القيود الأصلية");
  });

  it("labels both money buttons in Arabic", () => {
    expect(CONTROLS).toContain("تنفيذ الدفعة (ترحيل مالي)");
    expect(CONTROLS).toContain("التراجع عن التنفيذ");
    expect(CONTROLS).toContain("تأكيد التنفيذ");
    expect(CONTROLS).toContain("تأكيد التراجع");
  });

  it("keeps the controls compact — no decorative KPI card or heading for the money actions", () => {
    const bar = CONTROLS.slice(
      CONTROLS.indexOf("function BatchActionBar"),
      CONTROLS.indexOf("export function ReconciliationControls"),
    );
    expect(bar).not.toMatch(/<KpiCard|<h1|<h2|<h3/);
  });

  it("counts executed rows with a bounded head query against execution_result, not a constant", () => {
    expect(PAGE).toContain('.select("id", { count: "exact", head: true })');
    expect(PAGE).toContain('.in("execution_result", ["posted", "reversed"])');
    expect(PAGE).not.toContain("executed: 0,");
    expect(PAGE).toContain("executed,");
  });

  it("passes the truthful count and the redacted summary into the controls", () => {
    expect(PAGE).toContain("executedRows={counts.executed}");
    expect(PAGE).toContain("summaryLines={summaryLines}");
    expect(PAGE).toContain("summarizeResultSummary(batch.result_summary)");
  });

  it("still restricts the page itself to owner and accountant", () => {
    expect(PAGE).toContain('requireRole(["owner", "accountant"])');
  });

  it("scopes every batch read to the caller's org so RLS is not the only guard", () => {
    expect(PAGE).toContain('.eq("org_id", m.orgId)');
  });
});
