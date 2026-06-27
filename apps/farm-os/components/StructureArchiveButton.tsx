"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Alert } from "@/components/ui";
import { archiveStructure } from "@/app/(app)/farm/structure-actions";

const LEVEL_AR = {
  sector: "القطاع",
  hawsha: "الحوشة",
  line: "الخط",
  palm: "النخلة",
} as const;

/**
 * Remove (soft-delete) or restore a structure node. "Remove" archives the node AND cascades to its
 * descendants in the DB (fn_archive_structure) — every row + its event history is preserved and
 * reversible. A two-step confirm guards the (reversible, but disruptive) cascade.
 */
export function StructureArchiveButton({
  type,
  id,
  archived,
  redirectTo,
}: {
  type: "sector" | "hawsha" | "line" | "palm";
  id: string;
  archived: boolean;
  /** Where to send the user after a successful REMOVE (e.g. up to the parent). */
  redirectTo?: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(next: boolean) {
    setPending(true);
    setError(null);
    const res = await archiveStructure(type, id, next);
    setPending(false);
    if (!res.ok) {
      setError(res.error ?? "تعذّر تنفيذ العملية");
      return;
    }
    setConfirming(false);
    if (next && redirectTo) router.push(redirectTo);
    else router.refresh();
  }

  if (archived) {
    return (
      <div className="flex flex-col gap-2">
        <div aria-live="assertive">{error && <Alert tone="danger" title={error} />}</div>
        <Alert tone="warning" title={`${LEVEL_AR[type]} مُزالة (مؤرشفة)`} />
        <Button variant="ghost" loading={pending} onClick={() => run(false)}>
          استعادة
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div aria-live="assertive">{error && <Alert tone="danger" title={error} />}</div>
      {confirming ? (
        <div className="flex flex-col gap-2">
          <Alert
            tone="warning"
            title={`سيتم إزالة ${LEVEL_AR[type]} وكل ما بداخلها (قابلة للاستعادة). متابعة؟`}
          />
          <div className="flex gap-2">
            <Button variant="danger" loading={pending} onClick={() => run(true)}>
              تأكيد الإزالة
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              إلغاء
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="danger" onClick={() => setConfirming(true)}>
          إزالة {LEVEL_AR[type]}
        </Button>
      )}
    </div>
  );
}
