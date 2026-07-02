"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Alert, useToast } from "@/components/ui";
import { useSubmit } from "@/components/useSubmit";
import { createSupplier } from "@/app/(app)/suppliers/actions";

/** Add-supplier form, shown only to inventory.write roles (the page gates it). */
export function AddSupplier() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [terms, setTerms] = useState("");
  const [lead, setLead] = useState("");
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const { pending, submit } = useSubmit();
  const router = useRouter();
  const toast = useToast();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const r = await submit(() =>
      createSupplier({
        name,
        phone: phone || null,
        terms: terms || null,
        leadTimeDays: lead ? Number(lead) : null,
      }),
    );
    if (r.ok) {
      setOpen(false);
      setName("");
      setPhone("");
      setTerms("");
      setLead("");
      toast.ok("تمت إضافة المورّد بنجاح");
      router.refresh();
    } else {
      setMsg({ tone: "danger", text: r.error ?? "تعذّر الحفظ" });
    }
  }

  if (!open) {
    return (
      <div>
        <Button variant="ghost" onClick={() => setOpen(true)}>
          + إضافة مورّد
        </Button>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-3 rounded-lg border p-4"
      style={{ borderColor: "var(--line)" }}
    >
      {msg && <Alert tone={msg.tone} title={msg.text} />}
      <Field label="اسم المورّد" id="s-name">
        <Input id="s-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
      </Field>
      <Field label="الهاتف" id="s-phone">
        <Input id="s-phone" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} />
      </Field>
      <Field label="شروط التعامل" id="s-terms">
        <Input id="s-terms" value={terms} onChange={(e) => setTerms(e.target.value)} maxLength={200} />
      </Field>
      <Field label="مدة التوريد (أيام)" id="s-lead">
        <Input id="s-lead" type="number" min={0} value={lead} onChange={(e) => setLead(e.target.value)} />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "جارٍ الحفظ…" : "حفظ المورّد"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          إلغاء
        </Button>
      </div>
    </form>
  );
}
