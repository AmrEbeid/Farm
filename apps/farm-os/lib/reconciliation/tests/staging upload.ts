// Focused coverage for the authenticated manifest-STAGING path (SPEC-0004 §8.3):
//   • the pure guards in `lib/reconciliation staging.ts` (file bound, JSON shape, org binding,
//     defensive outcome parsing, fixed SQLSTATE mapping), and
//   • source-contract assertions on the server action, the client control, and the list page.
//
// The source-contract half exists because the properties that matter most here cannot be observed by
// calling a function: that the action re-requires owner/accountant, that it goes through the
// user-session client and ONLY the gated RPC, that it never accepts an org from the client, that it
// bounds the upload before reading it, and that no direct DML / admin client / service role / network
// helper / temp file ever appears on this path. Those are read off the real files, so a future edit
// that reintroduces one fails here rather than in production.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertManifestOrg,
  checkManifestFile,
  parseManifestText,
  parseStageOutcome,
  RECONCILIATION_MANIFEST_MAX_BYTES,
  STAGE_MANIFEST_FALLBACK_AR,
  STAGE_MANIFEST_PERM,
} from "../../reconciliation staging.ts";
import { toArabicError } from "../../errors.ts";

// Deliberately contains hex letters, so the "differently-cased org_id" case below is a real change.
const ORG = "aaaaaaaa-1111-1111-1111-111111111111";
const OTHER_ORG = "22222222-2222-2222-2222-222222222222";
const BATCH = "33333333-3333-3333-3333-333333333333";

const ROUTE_DIR = join(process.cwd(), "app", "(app)", "finance", "reconciliation");
const ACTIONS_SRC = readFileSync(join(ROUTE_DIR, "actions.ts"), "utf8");
const CONTROL_SRC = readFileSync(join(ROUTE_DIR, "staging upload.tsx"), "utf8");
const PAGE_SRC = readFileSync(join(ROUTE_DIR, "page.tsx"), "utf8");

/** The `stageManifest` function body only — so a guard cannot be "satisfied" by a sibling action. */
const STAGE_ACTION_SRC = (() => {
  const start = ACTIONS_SRC.indexOf("export async function stageManifest");
  expect(start, "stageManifest action not found").toBeGreaterThan(-1);
  const end = ACTIONS_SRC.indexOf("\nconst REVIEW_PERM", start);
  expect(end, "stageManifest body end marker not found").toBeGreaterThan(start);
  return ACTIONS_SRC.slice(start, end);
})();

function fileLike(size: number, text: string): { size: number; text: () => Promise<string> } {
  return { size, text: async () => text };
}

const MANIFEST = { batch: { id: BATCH, org_id: ORG, status: "staged" }, evidence_items: [] };

describe("manifest upload — file bound (checked BEFORE the file is read)", () => {
  it("rejects a missing or wrong form value without elaborating what was received", () => {
    for (const value of [null, undefined, "", "a-string", 42, [], { size: 10 }, { text: () => "" }]) {
      const result = checkManifestFile(value);
      expect(result.ok, `expected rejection for ${JSON.stringify(value) ?? "undefined"}`).toBe(false);
      if (!result.ok) expect(result.error).toBe("اختر ملف بيان الدفعة (JSON) الناتج عن الأداة المعتمدة.");
    }
  });

  it("rejects an empty file", () => {
    const result = checkManifestFile(fileLike(0, ""));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("فارغ");
  });

  it("caps the accepted size at a conservative bound and never above 900,000 bytes", () => {
    expect(RECONCILIATION_MANIFEST_MAX_BYTES).toBeLessThanOrEqual(900_000);
    expect(checkManifestFile(fileLike(RECONCILIATION_MANIFEST_MAX_BYTES, "{}")).ok).toBe(true);
    const over = checkManifestFile(fileLike(RECONCILIATION_MANIFEST_MAX_BYTES + 1, "{}"));
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.error).toContain("أكبر من الحد المسموح");
  });

  it("accepts a bounded non-empty file and hands back the same object", () => {
    const file = fileLike(10, "{}");
    const result = checkManifestFile(file);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.file).toBe(file);
  });
});

describe("manifest upload — JSON shape", () => {
  it("rejects malformed JSON without echoing the input", () => {
    const result = parseManifestText("{ not json");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("الملف ليس JSON صالحًا؛ أعد توليده بالأداة المعتمدة دون تعديل يدوي.");
      expect(result.error).not.toContain("not json");
    }
  });

  it("rejects an array root and every non-object JSON root", () => {
    for (const raw of ["[]", '[{"batch":{}}]', '"text"', "12", "true", "null"]) {
      const result = parseManifestText(raw);
      expect(result.ok, `expected rejection for ${raw}`).toBe(false);
    }
  });

  it("re-applies the byte cap to the read text as a second conservative bound", () => {
    const huge = `{"a":"${"x".repeat(RECONCILIATION_MANIFEST_MAX_BYTES)}"}`;
    const result = parseManifestText(huge);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("أكبر من الحد المسموح");
  });

  it("accepts a plain object root", () => {
    const result = parseManifestText(JSON.stringify(MANIFEST));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.manifest.batch).toBeDefined();
  });
});

describe("manifest upload — org binding", () => {
  it("accepts only a manifest whose batch.org_id is EXACTLY the caller's org", () => {
    expect(assertManifestOrg(MANIFEST, ORG).ok).toBe(true);
  });

  it("rejects a manifest staged for another org", () => {
    const result = assertManifestOrg({ batch: { org_id: OTHER_ORG } }, ORG);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("هذا البيان ليس لمؤسستك؛ لن يُجهَّز أي صف.");
  });

  it("rejects a missing, non-string, differently-cased, or padded batch.org_id", () => {
    for (const batch of [
      {},
      { org_id: null },
      { org_id: 42 },
      { org_id: ` ${ORG} ` },
      { org_id: ORG.toUpperCase() },
    ]) {
      expect(assertManifestOrg({ batch }, ORG).ok, JSON.stringify(batch)).toBe(false);
    }
    expect(assertManifestOrg({}, ORG).ok).toBe(false);
    expect(assertManifestOrg({ batch: [] }, ORG).ok).toBe(false);
  });

  it("fails closed when the caller's org is not a UUID", () => {
    expect(assertManifestOrg(MANIFEST, "not-a-uuid").ok).toBe(false);
  });
});

describe("manifest upload — outcome parsing (only a valid UUID may be reported)", () => {
  it("accepts a staged verdict carrying a real batch id", () => {
    const result = parseStageOutcome({ batch_id: BATCH, status: "staged", idempotent_replay: false });
    expect(result).toEqual({ ok: true, batchId: BATCH, status: "staged", idempotentReplay: false });
  });

  it("treats an idempotent replay as a success on the SAME batch id", () => {
    const result = parseStageOutcome({
      batch_id: BATCH,
      status: "reviewed",
      idempotent_replay: true,
      staged_rows: 0,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.batchId).toBe(BATCH);
      expect(result.idempotentReplay).toBe(true);
    }
  });

  it("fails closed on a malformed body or a batch_id that is not a UUID", () => {
    for (const body of [
      null,
      undefined,
      "staged",
      [],
      [{ batch_id: BATCH, status: "staged" }],
      {},
      { status: "staged" },
      { batch_id: BATCH },
      { batch_id: BATCH, status: "" },
      { batch_id: "not-a-uuid", status: "staged" },
      { batch_id: 42, status: "staged" },
      { batch_id: `${BATCH}; drop table`, status: "staged" },
    ]) {
      const result = parseStageOutcome(body);
      expect(result.ok, JSON.stringify(body) ?? "undefined").toBe(false);
      if (!result.ok) expect(result.error).toContain("ردّ غير متوقَّع");
    }
  });
});

describe("manifest upload — fixed Arabic error mapping", () => {
  it("maps every SQLSTATE the staging RPC raises to its own specific message", () => {
    expect(Object.keys(STAGE_MANIFEST_PERM).sort()).toEqual(["22023", "23502", "23505", "42501"]);
    const messages = Object.values(STAGE_MANIFEST_PERM);
    expect(new Set(messages).size).toBe(messages.length);
  });

  it("names permission, malformed contract, and deterministic conflict distinctly", () => {
    expect(STAGE_MANIFEST_PERM["42501"]).toContain("صلاحية");
    expect(STAGE_MANIFEST_PERM["22023"]).toContain("العقد المطلوب");
    expect(STAGE_MANIFEST_PERM["23505"]).toContain("تعارض");
  });

  it("states that nothing was staged on every failure that could look partial", () => {
    for (const code of ["22023", "23502", "23505"]) {
      expect(STAGE_MANIFEST_PERM[code], code).toContain("لم يُجهَّز أي صف");
    }
  });

  it("falls back to a generic Arabic message — never a raw DB string — for any other code", () => {
    const mapped = toArabicError(
      { code: "XX000", message: 'relation "reconciliation_batches" does not exist' },
      STAGE_MANIFEST_PERM,
      STAGE_MANIFEST_FALLBACK_AR,
    );
    expect(mapped).toBe(STAGE_MANIFEST_FALLBACK_AR);
    expect(mapped).not.toMatch(/[A-Za-z]/);
  });

  it("carries no Western digits or Latin text in any fixed message", () => {
    for (const message of [...Object.values(STAGE_MANIFEST_PERM), STAGE_MANIFEST_FALLBACK_AR]) {
      expect(message, message).not.toMatch(/[0-9A-Za-z]/);
    }
  });
});

describe("manifest upload — server-action source contract", () => {
  it("re-requires owner/accountant BEFORE touching the upload", () => {
    expect(STAGE_ACTION_SRC).toContain('requireRole(["owner", "accountant"])');
    expect(STAGE_ACTION_SRC.indexOf("requireRole")).toBeLessThan(
      STAGE_ACTION_SRC.indexOf("checkManifestFile"),
    );
  });

  it("bounds the file before reading it", () => {
    expect(STAGE_ACTION_SRC.indexOf("checkManifestFile")).toBeLessThan(
      STAGE_ACTION_SRC.indexOf(".text()"),
    );
  });

  it("accepts exactly one manifest upload and rejects missing or duplicate fields", () => {
    expect(STAGE_ACTION_SRC).toContain('formData.getAll("manifest")');
    expect(STAGE_ACTION_SRC).toContain("uploads.length === 1 ? uploads[0] : null");
    expect(STAGE_ACTION_SRC).not.toContain('formData.get("manifest")');
  });

  it("binds the org to the caller's membership and never accepts one from the client", () => {
    expect(STAGE_ACTION_SRC).toContain("p_org: m.orgId");
    expect(STAGE_ACTION_SRC).toContain("assertManifestOrg(parsed.manifest, m.orgId)");
    const orgArgs = [...STAGE_ACTION_SRC.matchAll(/p_org:\s*([^,\n}]+)/g)].map((m) => m[1].trim());
    expect(orgArgs).toEqual(["m.orgId"]);
    expect(STAGE_ACTION_SRC).not.toMatch(/get\(["']org/);
    expect(STAGE_ACTION_SRC).not.toMatch(/\borgId\s*[:=][^;]*formData/);
  });

  it("calls ONLY fn_stage_reconciliation_manifest, through the user-session client", () => {
    expect(STAGE_ACTION_SRC).toContain("await createClient()");
    const rpcs = [...STAGE_ACTION_SRC.matchAll(/\.rpc\(\s*"([^"]+)"/g)].map((match) => match[1]);
    expect(rpcs).toEqual(["fn_stage_reconciliation_manifest"]);
  });

  it("uses no direct DML, admin client, service role, network helper, or temp file", () => {
    for (const forbidden of [
      /\.from\(/,
      /\.insert\(/,
      /\.update\(/,
      /\.upsert\(/,
      /\.delete\(/,
      /createAdminClient/i,
      /service[_ ]?role/i,
      /SUPABASE_SERVICE/,
      /\bfetch\(/,
      /node:fs/,
      /writeFile/,
      /tmpdir/,
    ]) {
      expect(forbidden.test(STAGE_ACTION_SRC), `${forbidden} must not appear`).toBe(false);
    }
  });

  it("reads the RPC verdict rather than trusting the absence of an error", () => {
    expect(STAGE_ACTION_SRC).toContain("parseStageOutcome(data)");
    expect(STAGE_ACTION_SRC).toContain("if (!outcome.ok) return");
    expect(STAGE_ACTION_SRC).toContain("revalidateReconciliation(outcome.batchId)");
  });

  it("never logs or echoes the upload, and never returns a raw DB message", () => {
    expect(STAGE_ACTION_SRC).not.toMatch(/console\./);
    expect(STAGE_ACTION_SRC).not.toMatch(/error\.message/);
    expect(STAGE_ACTION_SRC).not.toMatch(/\.name\b/); // no filename read
    expect(STAGE_ACTION_SRC).toContain("STAGE_MANIFEST_PERM");
    expect(STAGE_ACTION_SRC).toContain("STAGE_MANIFEST_FALLBACK_AR");
  });

  it("does not reach any execution/posting RPC from the staging path", () => {
    for (const posting of ["fn_execute_reconciliation_batch", "fn_approve_reconciliation_batch"]) {
      expect(STAGE_ACTION_SRC).not.toContain(posting);
    }
  });
});

describe("manifest upload — client control + list-page integration", () => {
  it("is a client component using a real file input and an explicit staging command", () => {
    expect(CONTROL_SRC.startsWith('"use client"')).toBe(true);
    expect(CONTROL_SRC).toContain('type="file"');
    expect(CONTROL_SRC).toContain('accept=".json,application/json"');
    expect(CONTROL_SRC).toContain("stageManifest(body)");
    expect(CONTROL_SRC).toContain("تجهيز للمراجعة");
  });

  it("renders Arabic RTL copy stating that staging creates review rows only", () => {
    expect(CONTROL_SRC).toContain('dir="rtl"');
    expect(CONTROL_SRC).toContain("صفوف مراجعة فقط");
    expect(CONTROL_SRC).toMatch(/لا يُنشئ ولا يُعدِّل أي مصروف أو بيع أو قيد/);
  });

  it("has a pending state and a safe error state, and uses no native dialog", () => {
    expect(CONTROL_SRC).toContain("loading={pending}");
    expect(CONTROL_SRC).toContain("disabled={pending || !file}");
    expect(CONTROL_SRC).toContain('role="alert"');
    for (const nativeDialog of [/window\.confirm/, /\bconfirm\(/, /\balert\(/, /\bprompt\(/]) {
      expect(nativeDialog.test(CONTROL_SRC), `${nativeDialog} must not appear`).toBe(false);
    }
  });

  it("navigates to the batch id the server returned, never to a client-built id", () => {
    expect(CONTROL_SRC).toContain("router.push(`/finance/reconciliation/${result.batchId}`)");
  });

  it("mirrors the server byte cap instead of hard-coding a second bound", () => {
    expect(CONTROL_SRC).toContain("RECONCILIATION_MANIFEST_MAX_BYTES");
    expect(CONTROL_SRC).not.toMatch(/900[_,]?000/);
  });

  it("is mounted on the reconciliation list page", () => {
    expect(PAGE_SRC).toContain('import { ManifestStagingCard } from "./staging upload"');
    expect(PAGE_SRC).toContain("<ManifestStagingCard />");
  });

  it("keeps the list page's own headers unchanged in size", () => {
    expect(PAGE_SRC).toContain('<h1 className="text-xl font-bold">مراجعة التسويات</h1>');
    expect(CONTROL_SRC).not.toMatch(/<h[12]\b/);
  });
});
