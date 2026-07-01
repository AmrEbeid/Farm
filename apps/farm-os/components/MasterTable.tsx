"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Alert, useToast } from "@/components/ui";
import { FilterableTable } from "@/components/FilterableTable";
import { type SimpleColumn, type SimpleRow } from "@/components/SimpleTable";

/** A create-form field (drives the inline add form). Writes go through the page's gated server action. */
export type MasterField = {
  key: string;
  label: string;
  type?: "text" | "number";
  required?: boolean;
  maxLength?: number;
};

export type MasterFormValues = Record<string, string | number | null>;

/**
 * SPEC-0017 — one-declaration master-data screen (ported from the Owner's Zeal admin SimpleMasterTable,
 * adapted to Farm's stack): header + a role-gated inline create form built from typed `fields`, over the
 * existing FilterableTable (search + CSV export). The whole point is reuse — a new admin screen is one
 * <MasterTable> + a gated server action.
 *
 * SECURITY (differs from Zeal): writes go through the page-supplied `onCreate` SERVER ACTION, which calls
 * the gated RPC / RLS-checked path (NOT direct client DML), and audit is server-side. canWrite only hides
 * the affordance; the action re-checks the permission server-side.
 */
export function MasterTable({
  title,
  description,
  columns,
  rows,
  fields,
  canWrite,
  onCreate,
  addLabel = "+ إضافة",
  searchColumns,
  placeholder,
  exportFilename,
  empty,
}: {
  title: string;
  description?: string;
  columns: SimpleColumn[];
  rows: SimpleRow[];
  fields: MasterField[];
  canWrite: boolean;
  onCreate: (values: MasterFormValues) => Promise<{ ok: boolean; error?: string }>;
  addLabel?: string;
  searchColumns?: string[];
  placeholder?: string;
  exportFilename?: string;
  empty?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setMsg(null);
    const values: MasterFormValues = {};
    for (const f of fields) {
      const raw = (form[f.key] ?? "").trim();
      values[f.key] = raw === "" ? null : f.type === "number" ? Number(raw) : raw;
    }
    let r: { ok: boolean; error?: string };
    try {
      r = await onCreate(values);
    } catch {
      // A network reject must not strand the spinner. This is a clear retry message, not
      // offline support: there's no service worker / IndexedDB outbox / queued replay, so a
      // submission made while offline is NOT queued — the user must retry once back online.
      // Queued/replayed offline submissions are a planned future release.
      r = { ok: false, error: "تعذّر الاتصال بالخادم. تحقّق من الاتصال وحاول مرة أخرى." };
    }
    setPending(false);
    if (r.ok) {
      setOpen(false);
      setForm({});
      // Targeted re-fetch of the Server Component tree (not a full page reload) — the
      // list re-renders with fresh data while a toast confirms the write succeeded.
      toast.ok("تمت الإضافة بنجاح");
      router.refresh();
    } else {
      setMsg({ tone: "danger", text: r.error ?? "تعذّر الحفظ" });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{title}</h1>
          {description && <p style={{ color: "var(--ink-muted)" }}>{description}</p>}
        </div>
        {canWrite && !open && (
          <Button variant="ghost" onClick={() => setOpen(true)}>
            {addLabel}
          </Button>
        )}
      </header>

      {canWrite && open && (
        <form onSubmit={submit} className="flex flex-col gap-3 rounded-lg border p-4" style={{ borderColor: "var(--border)" }}>
          <div role="alert" aria-live="assertive" aria-atomic="true">
            {msg && <Alert tone={msg.tone} title={msg.text} />}
          </div>
          {fields.map((f) => (
            <Field key={f.key} label={`${f.label}${f.required ? " *" : ""}`} id={`mt-${f.key}`}>
              <Input
                id={`mt-${f.key}`}
                type={f.type === "number" ? "number" : "text"}
                min={f.type === "number" ? 0 : undefined}
                maxLength={f.maxLength}
                required={f.required}
                value={form[f.key] ?? ""}
                onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
              />
            </Field>
          ))}
          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "جارٍ الحفظ…" : "حفظ"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              إلغاء
            </Button>
          </div>
        </form>
      )}

      <FilterableTable
        columns={columns}
        rows={rows}
        ariaLabel={title}
        empty={empty}
        searchColumns={searchColumns}
        placeholder={placeholder}
        exportFilename={exportFilename}
      />
    </div>
  );
}
