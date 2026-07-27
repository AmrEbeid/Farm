"use client";

/**
 * Arabic-RTL staging control for the reconciliation list page (SPEC-0004 §8.3).
 *
 * Compact and operational on purpose: one real file input, one explicit command, a pending state, a
 * safe error line, and a navigation to the created batch on success. It deliberately does NOT try to
 * look like an import wizard — there is no preview, no dry run, and no partial state, because the
 * staging RPC is atomic and the manifest is generated (and hash-pinned) by the approved tool, not
 * authored here.
 *
 * The copy states plainly what this does: it creates REVIEW ROWS ONLY. No expense, sale, or journal
 * is created or changed by staging.
 */

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button } from "@/components/ui";
// The one runtime value taken from the (space-named) staging module: the byte cap, so the client
// pre-check and the server bound can never drift. The module is pure and side-effect-free, so the
// rest of it (and its own imports) tree-shakes out of this client chunk.
import { RECONCILIATION_MANIFEST_MAX_BYTES } from "@/lib/reconciliation staging";
import { num } from "@/lib/money";
import { stageManifest } from "./actions";

type Msg = { tone: "ok" | "danger"; text: string } | null;

export function ManifestStagingCard() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  async function submit() {
    if (!file) {
      setMsg({ tone: "danger", text: "اختر ملف بيان الدفعة (JSON) أولًا." });
      return;
    }
    // Mirrors the server bound so an oversized file is refused before it is uploaded at all. The
    // server re-checks it (this is a convenience, never the gate).
    if (file.size <= 0 || file.size > RECONCILIATION_MANIFEST_MAX_BYTES) {
      setMsg({
        tone: "danger",
        text:
          file.size <= 0
            ? "الملف فارغ؛ اختر بيان دفعة صالحًا."
            : `الملف أكبر من الحد المسموح (${num(RECONCILIATION_MANIFEST_MAX_BYTES)} بايت).`,
      });
      return;
    }

    setPending(true);
    setMsg(null);
    const body = new FormData();
    body.set("manifest", file);
    let result: Awaited<ReturnType<typeof stageManifest>>;
    try {
      result = await stageManifest(body);
    } catch {
      setPending(false);
      setMsg({ tone: "danger", text: "تعذّر الاتصال بالخادم. حاول مرة أخرى." });
      return;
    }
    setPending(false);
    if (!result.ok) {
      setMsg({ tone: "danger", text: result.error });
      return;
    }
    setMsg({
      tone: "ok",
      text: result.idempotentReplay
        ? "هذه الدفعة مُجهَّزة بالفعل بنفس البيانات؛ لم يُضف أي صف. جارٍ فتحها."
        : "تم تجهيز الدفعة للمراجعة. جارٍ فتحها.",
    });
    setFile(null);
    if (inputRef.current) inputRef.current.value = "";
    router.push(`/finance/reconciliation/${result.batchId}`);
  }

  return (
    <div
      dir="rtl"
      className="flex flex-col gap-2 rounded-lg px-4 py-3"
      style={{ border: "1px solid var(--line)", backgroundColor: "var(--surface)" }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="manifest-file" className="text-sm font-medium">
          تجهيز دفعة من بيان مُولَّد
        </label>
        <input
          ref={inputRef}
          id="manifest-file"
          name="manifest"
          type="file"
          accept=".json,application/json"
          className="text-sm"
          disabled={pending}
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setMsg(null);
          }}
        />
        <Button size="sm" onClick={submit} loading={pending} disabled={pending || !file}>
          تجهيز للمراجعة
        </Button>
      </div>

      <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
        يُنشئ التجهيز صفوف مراجعة فقط ضمن مؤسستك. لا يُنشئ ولا يُعدِّل أي مصروف أو بيع أو قيد
        محاسبي، ولا يغيّر أي رقم مالي — الترحيل يتم لاحقًا بالتنفيذ بعد المراجعة والتجميد والاعتماد.
        استخدم ملف البيان الناتج عن الأداة المعتمدة كما هو، دون تعديل يدوي.
      </p>

      <div role="alert" aria-live="assertive" aria-atomic="true">
        {msg && <Alert tone={msg.tone} title={msg.text} />}
      </div>
    </div>
  );
}
