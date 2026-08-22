"use client";

import { useState } from "react";
import { saveMarketingWorkspaceControl } from "@/app/(app)/marketing/actions";
import type { Json } from "@/lib/database.types.ext";
import type { WorkspaceControl } from "@/lib/marketing/workspace/content-types";

function initialText(value: Json | undefined, fallback = ""): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : fallback;
}

export function SourceControlInput({
  control,
  domId,
  controlKey,
  areaId,
  orgId,
  savedValue,
  canWrite,
  liveTargetId,
}: {
  control: WorkspaceControl;
  domId?: string;
  controlKey: string;
  areaId: string;
  orgId: string;
  savedValue?: Json;
  canWrite: boolean;
  liveTargetId: string;
}) {
  const [textValue, setTextValue] = useState(() => initialText(savedValue, control.value ?? ""));
  const [checked, setChecked] = useState(() => typeof savedValue === "boolean" ? savedValue : false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accessibleLabel = control.label || control.placeholder || control.id || "حقل المصدر";

  async function persist(value: string | boolean) {
    if (!canWrite) return;
    setPending(true);
    setError(null);
    const result = await saveMarketingWorkspaceControl({ orgId, areaId, controlKey, value });
    setPending(false);
    if (!result.ok) setError(result.error ?? "تعذّر حفظ الحقل");
  }

  if (control.kind === "button") {
    return (
      <button
        id={domId}
        type="button"
        className="rounded border px-2 py-1 text-sm"
        style={{ borderColor: "var(--line)" }}
        data-source-binding="live-workflow"
        title="فتح الأداة الحية المرتبطة"
        onClick={() => document.getElementById(liveTargetId)?.scrollIntoView({ behavior: "smooth", block: "start" })}
      >
        {control.label}
      </button>
    );
  }
  if (control.kind === "checkbox") {
    return (
      <input
        id={domId}
        type="checkbox"
        checked={checked}
        disabled={!canWrite || pending}
        aria-label={accessibleLabel}
        data-source-binding="database-draft"
        aria-invalid={error ? true : undefined}
        title={error ?? undefined}
        onChange={(event) => {
          setChecked(event.target.checked);
          void persist(event.target.checked);
        }}
      />
    );
  }
  if (control.kind === "select") {
    return (
      <select
        id={domId}
        value={textValue}
        disabled={!canWrite || pending}
        aria-label={accessibleLabel}
        data-source-binding="database-draft"
        aria-invalid={error ? true : undefined}
        title={error ?? undefined}
        onChange={(event) => setTextValue(event.target.value)}
        onBlur={() => void persist(textValue)}
      >
        <option value="">{control.placeholder ?? "—"}</option>
        {(control.options ?? []).map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    );
  }
  if (control.kind === "textarea") {
    return (
      <textarea
        id={domId}
        value={textValue}
        disabled={!canWrite || pending}
        aria-label={accessibleLabel}
        placeholder={control.placeholder}
        rows={3}
        className="w-full"
        data-source-binding="database-draft"
        aria-invalid={error ? true : undefined}
        title={error ?? undefined}
        onChange={(event) => setTextValue(event.target.value)}
        onBlur={() => void persist(textValue)}
      />
    );
  }
  return (
    <input
      id={domId}
      type={control.type ?? "text"}
      value={textValue}
      disabled={!canWrite || pending}
      aria-label={accessibleLabel}
      placeholder={control.placeholder}
      data-source-binding="database-draft"
      aria-invalid={error ? true : undefined}
      title={error ?? undefined}
      onChange={(event) => setTextValue(event.target.value)}
      onBlur={() => void persist(textValue)}
    />
  );
}
