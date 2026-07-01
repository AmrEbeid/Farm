"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Drawer, FormRow, Input, Select, type SelectOption } from "@/components/ui";
import { instantiateOperationTemplate } from "@/app/(app)/plans/[planId]/actions";

export interface TemplateOpt {
  id: string;
  name: string;
  subtype: string;
  occurrenceCount: number;
}

/**
 * SPEC-0019 P1-3 "جداول العمليات" — minimal entry point: pick one of the org's named operation
 * templates + an anchor date, then instantiate it onto this plan in one action
 * (fn_instantiate_operation_template, via the same-name server action). Deliberately NOT a
 * template editor — authoring/editing templates from the UI is a follow-up; this PR only ships
 * the pre-seeded starter set + instantiate.
 */
export function OperationTemplatePicker({
  planId,
  templates,
}: {
  planId: string;
  templates: TemplateOpt[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const today = new Date().toISOString().split("T")[0];
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [anchorDate, setAnchorDate] = useState(today);

  const templateOptions: SelectOption[] = templates.map((t) => ({
    value: t.id,
    label: `${t.name} (${t.occurrenceCount} عملية)`,
  }));

  async function submit() {
    if (!templateId) return;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const res = await instantiateOperationTemplate(planId, templateId, anchorDate);
      if (res.ok) {
        setNotice(
          res.deduped > 0
            ? `تم إنشاء ${res.created} عملية جديدة، وتم تجاهل ${res.deduped} عملية مكررة بنفس التاريخ.`
            : `تم إنشاء ${res.created} عملية بنجاح.`,
        );
        router.refresh();
      } else {
        setError(res.error ?? "تعذّر تطبيق البرنامج");
      }
    } catch {
      // Offline-tolerant (non-negotiable #2): a network reject must not strand the spinner.
      setError("تعذّر الاتصال بالخادم. تحقّق من الاتصال وحاول مرة أخرى.");
    } finally {
      setPending(false);
    }
  }

  if (templates.length === 0) return null;

  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        استخدام برنامج جاهز
      </Button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        side="end"
        title="استخدام برنامج عمليات جاهز"
        closeLabel="إغلاق"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              إغلاق
            </Button>
            <Button variant="primary" loading={pending} onClick={submit} disabled={!templateId}>
              تطبيق البرنامج
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <div role="alert" aria-live="assertive" aria-atomic="true">
            {error && <p style={{ color: "var(--danger,#b91c1c)" }}>{error}</p>}
            {notice && <p style={{ color: "var(--ok,#15803d)" }}>{notice}</p>}
          </div>

          <FormRow id="template" label="البرنامج">
            <Select
              options={templateOptions}
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
            />
          </FormRow>

          <FormRow id="anchor_date" label="التاريخ المرجعي (بداية البرنامج)">
            <Input type="date" value={anchorDate} onChange={(e) => setAnchorDate(e.target.value)} />
          </FormRow>
        </div>
      </Drawer>
    </>
  );
}
