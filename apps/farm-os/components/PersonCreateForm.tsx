"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field, Input, Select, Alert, type SelectOption } from "@/components/ui";
import { useSubmit } from "@/components/useSubmit";
import { createPerson } from "@/app/(app)/people/actions";
import { EMP_TYPE_AR } from "@/lib/labels";

const TYPE_OPTIONS: SelectOption[] = Object.entries(EMP_TYPE_AR).map(([value, label]) => ({
  value,
  label,
}));

const ACTIVE_OPTIONS: SelectOption[] = [
  { value: "true", label: "نشط" },
  { value: "false", label: "غير نشط" },
];

export interface ManagerOption {
  id: string;
  name: string;
}

/**
 * Onboard a new team member (SPEC-0006 — all 4 employment types, including يومي/مقاول which had no
 * create path before). Gated by the page to `people.write` roles (owner/farm_manager); the server
 * action re-enforces the same gate via RLS regardless.
 */
export function PersonCreateForm({ managers }: { managers: ManagerOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { pending, submit } = useSubmit();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [position, setPosition] = useState("");
  const [employmentType, setEmploymentType] = useState("");
  const [reportsTo, setReportsTo] = useState("");
  const [active, setActive] = useState("true");

  const managerOptions: SelectOption[] = [
    { value: "", label: "بدون مدير مباشر" },
    ...managers.map((p) => ({ value: p.id, label: p.name })),
  ];

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await submit(() =>
      createPerson({
        name,
        position: position || null,
        employmentType: employmentType || null,
        reportsToPersonId: reportsTo || null,
        active: active === "true",
      }),
    );
    if (res.ok) {
      setOpen(false);
      setName("");
      setPosition("");
      setEmploymentType("");
      setReportsTo("");
      setActive("true");
      router.refresh();
    } else {
      setError(res.error ?? "تعذّر إضافة عضو الفريق");
    }
  }

  if (!open) {
    return (
      <Button variant="primary" onClick={() => setOpen(true)}>
        + إضافة عضو فريق
      </Button>
    );
  }

  return (
    <Card title="عضو فريق جديد">
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <div aria-live="assertive" aria-atomic="true">
          {error && <Alert tone="danger" title={error} />}
        </div>
        <Field label="الاسم *" id="person-name">
          <Input id="person-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
        </Field>
        <Field label="الوظيفة" id="person-position">
          <Input id="person-position" value={position} onChange={(e) => setPosition(e.target.value)} maxLength={120} />
        </Field>
        <Field label="نوع التوظيف" id="person-type">
          <Select
            id="person-type"
            options={TYPE_OPTIONS}
            placeholder="اختر نوع التوظيف"
            value={employmentType}
            onChange={(e) => setEmploymentType(e.target.value)}
          />
        </Field>
        <Field label="يتبع" id="person-manager">
          <Select
            id="person-manager"
            options={managerOptions}
            value={reportsTo}
            onChange={(e) => setReportsTo(e.target.value)}
          />
        </Field>
        <Field label="الحالة" id="person-active">
          <Select
            id="person-active"
            options={ACTIVE_OPTIONS}
            value={active}
            onChange={(e) => setActive(e.target.value)}
          />
        </Field>
        <div className="flex gap-2">
          <Button type="submit" variant="primary" loading={pending}>
            حفظ
          </Button>
          <Button type="button" variant="ghost" onClick={() => { setOpen(false); setError(null); }}>
            إلغاء
          </Button>
        </div>
      </form>
    </Card>
  );
}
