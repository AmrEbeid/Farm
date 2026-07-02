"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Button, Alert, FormRow, Input, Select, type SelectOption } from "@/components/ui";
import { useSubmit } from "@/components/useSubmit";
import { createPlan } from "@/app/(app)/plans/plans-actions";

const TYPE_OPTIONS: SelectOption[] = [
  { value: "weekly", label: "أسبوعية" },
  { value: "monthly", label: "شهرية" },
  { value: "quarterly", label: "ربع سنوية" },
  { value: "annual", label: "سنوية" },
];

/**
 * Create a new plan (STAGE 4). Whole-farm scope by default; the DB RPC (fn_create_plan) enforces
 * plan.write. On success it navigates to the new plan's page so the user can add operations.
 */
export function PlanCreateForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { pending, submit } = useSubmit();
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<"weekly" | "monthly" | "quarterly" | "annual">("monthly");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (start && end && end < start) {
      setError("تاريخ النهاية يجب أن يكون بعد البداية");
      return;
    }
    setError(null);
    const res = await submit(() =>
      createPlan({ type, periodStart: start || null, periodEnd: end || null }),
    );
    if (res.ok && res.data) {
      router.push(`/plans/${res.data}`);
    } else if (res.ok) {
      setOpen(false);
      router.refresh();
    } else {
      setError(res.error ?? "تعذّر إنشاء الخطة");
    }
  }

  if (!open) {
    return (
      <Button variant="primary" onClick={() => setOpen(true)}>
        إنشاء خطة جديدة
      </Button>
    );
  }

  return (
    <Card title="خطة جديدة">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div aria-live="assertive" aria-atomic="true">
          {error && <Alert tone="danger" title={error} />}
        </div>
        <FormRow id="plan-type" label="النوع">
          <Select
            options={TYPE_OPTIONS}
            value={type}
            onChange={(e) => setType(e.target.value as "weekly" | "monthly" | "quarterly" | "annual")}
          />
        </FormRow>
        <div className="grid grid-cols-2 gap-2">
          <FormRow id="plan-start" label="من تاريخ">
            <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </FormRow>
          <FormRow id="plan-end" label="إلى تاريخ">
            <Input type="date" min={start || undefined} value={end} onChange={(e) => setEnd(e.target.value)} />
          </FormRow>
        </div>
        <div className="flex gap-2">
          <Button type="submit" variant="primary" loading={pending}>إنشاء</Button>
          <Button type="button" variant="ghost" onClick={() => { setOpen(false); setError(null); }}>إلغاء</Button>
        </div>
      </form>
    </Card>
  );
}
