"use client";

// Rule-based "Why?" button (SPEC-0014 A3). Given a field-safe error code, explains
// in plain Arabic why the action was blocked and what to do next (lib/why.ts).
// NO AI — the AI "Why?" is Tier C, gated behind Stage 11. Presentational only.

import { useState } from "react";
import { Drawer, Button } from "@/components/ui";
import { whyFor } from "@/lib/why";

/** Renders a "لماذا؟" affordance for a blocked action's error `code`; nothing if unmapped. */
export function WhyButton({ code }: { code: string | null | undefined }) {
  const [open, setOpen] = useState(false);
  const why = whyFor(code);
  if (!why) return null;

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        لماذا؟
      </Button>
      <Drawer open={open} onClose={() => setOpen(false)} title="لماذا؟" side="end" closeLabel="إغلاق">
        <div className="flex flex-col gap-3 text-sm">
          <p>{why.explanation}</p>
          <div>
            <span className="font-bold">ماذا تفعل: </span>
            {why.next}
          </div>
          {why.rule && <div style={{ color: "var(--ink-muted)" }}>القاعدة: {why.rule}</div>}
        </div>
      </Drawer>
    </>
  );
}
