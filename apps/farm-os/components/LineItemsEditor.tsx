"use client";

import type { ReactNode } from "react";
import { Alert, Button, Card } from "@/components/ui";

// SPEC-0025 U-9 — the shared multi-LINE entry pattern (Owner follow-up §2b.2): one session, many rows;
// each row individually guided/validated/saved; add and remove rows freely; a running saved-count.
// Generic and presentation-only: the caller renders the row fields and owns the save logic, so every
// wizard (plan operations, collections, receipts, attendance…) gets the identical interaction for free.

export interface LineState {
  saved?: boolean;
  error?: string | null;
}

export function LineItemsEditor<L extends LineState>({
  lines,
  renderLine,
  onAdd,
  onRemove,
  onSaveLine,
  pending,
  addLabel = "+ سطر آخر",
  saveLabel = "حفظ السطر ✓",
  savedLabel = "✓ حُفظ",
  header,
}: {
  lines: L[];
  /** Render the row's fields (disabled when the row is saved). */
  renderLine: (line: L, index: number) => ReactNode;
  onAdd: () => void;
  onRemove: (index: number) => void;
  onSaveLine: (index: number) => void;
  pending: boolean;
  addLabel?: string;
  saveLabel?: string;
  savedLabel?: string;
  /** Optional running summary rendered above the rows (e.g. "حُفظ ٢ من ٣"). */
  header?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      {header}
      {lines.map((l, i) => (
        <Card key={i}>
          <div className="flex flex-col gap-2 p-1" style={{ opacity: l.saved ? 0.6 : 1 }}>
            {renderLine(l, i)}
            {l.error && <Alert tone="danger" title={l.error} />}
            <div className="flex gap-2">
              {!l.saved ? (
                <Button onClick={() => onSaveLine(i)} disabled={pending}>
                  {saveLabel}
                </Button>
              ) : (
                <span className="text-sm font-bold" style={{ color: "var(--ok, #1e6b3a)" }}>
                  {savedLabel}
                </span>
              )}
              {!l.saved && lines.length > 1 && (
                <Button variant="ghost" onClick={() => onRemove(i)}>
                  حذف
                </Button>
              )}
            </div>
          </div>
        </Card>
      ))}
      <div>
        <Button variant="ghost" onClick={onAdd}>
          {addLabel}
        </Button>
      </div>
    </div>
  );
}
