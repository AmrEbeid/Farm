"use client";

// Contextual help drawer (SPEC-0014 A2). Renders the 5-question PageHelp content
// (lib/page-help.ts) for the current page in a side drawer — opens in place, no
// navigation. Presentational only; no data access. Arabic-first (CLAUDE.md #2).

import { useState } from "react";
import { Drawer, Button } from "@/components/ui";
import { helpForPath } from "@/lib/page-help";

function Section({ q, a }: { q: string; a: string }) {
  return (
    <div>
      <div className="font-bold">{q}</div>
      <div style={{ color: "var(--ink-muted)" }}>{a}</div>
    </div>
  );
}

/** Help affordance for the current route, falling back to the active nav id. */
export function HelpDrawer({ pathname, fallbackHelpId }: { pathname: string; fallbackHelpId: string }) {
  const [open, setOpen] = useState(false);
  const help = helpForPath(pathname, fallbackHelpId);
  if (!help) return null;

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} aria-label="مساعدة هذه الصفحة">
        ؟
      </Button>
      <Drawer open={open} onClose={() => setOpen(false)} title={`مساعدة: ${help.title}`} side="end" closeLabel="إغلاق">
        <div className="flex flex-col gap-3 text-sm">
          <Section q="ما هذه الصفحة؟" a={help.what} />
          <Section q="لماذا توجد؟" a={help.why} />
          <Section q="متى أستخدمها؟" a={help.when} />
          <Section q="كيف أستخدمها؟" a={help.how} />
          <Section q="أخطاء شائعة" a={help.avoid} />
        </div>
      </Drawer>
    </>
  );
}
