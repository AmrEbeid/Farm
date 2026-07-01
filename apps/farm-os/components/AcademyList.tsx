"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Textarea, Select, Alert, Card } from "@/components/ui";
import {
  saveAcademyContent,
  signoffAcademyContent,
  archiveAcademyContent,
} from "@/app/(app)/academy/actions";
import { fmtDate } from "@/lib/dates";

export interface AcademyItem {
  id: string;
  title: string;
  body: string;
  category: string;
  hasChemical: boolean;
  agronomistName: string | null;
  signedAt: string | null;
  pesticideRegValidUntil: string | null;
  authoritative: boolean;
}

const CATEGORIES = [
  { value: "general", label: "عام" },
  { value: "npk", label: "تسميد (NPK)" },
  { value: "irrigation", label: "ري" },
  { value: "pollination", label: "تلقيح" },
  { value: "pesticide", label: "مكافحة (مبيدات)" },
];
const categoryLabel = (v: string) => CATEGORIES.find((c) => c.value === v)?.label ?? v;

export function AcademyList({
  items,
  orgId,
  canEdit,
}: {
  items: AcademyItem[];
  orgId: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<AcademyItem | "new" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function archive(id: string) {
    setErr(null);
    const r = await archiveAcademyContent({ id, archived: true });
    if (!r.ok) return setErr(r.error);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {err && <Alert tone="danger" title={err} />}

      {canEdit && editing !== "new" && (
        <Button onClick={() => setEditing("new")}>+ محتوى جديد</Button>
      )}

      {editing === "new" && (
        <ContentForm
          orgId={orgId}
          onDone={() => {
            setEditing(null);
            router.refresh();
          }}
          onCancel={() => setEditing(null)}
        />
      )}

      {items.length === 0 && <p className="text-sm text-muted-foreground">لا يوجد محتوى بعد.</p>}

      {items.map((it) =>
        editing && editing !== "new" && editing.id === it.id ? (
          <ContentForm
            key={it.id}
            orgId={orgId}
            item={it}
            onDone={() => {
              setEditing(null);
              router.refresh();
            }}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <Card key={it.id} className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-semibold">{it.title}</h3>
                <span className="text-xs text-muted-foreground">{categoryLabel(it.category)}</span>
              </div>
              <Badge authoritative={it.authoritative} />
            </div>
            {it.body && <p className="mt-2 whitespace-pre-wrap text-sm">{it.body}</p>}
            {it.authoritative ? (
              <p className="mt-2 text-xs text-green-700">
                معتمد من المهندس {it.agronomistName} — {fmtDate(it.signedAt)}
              </p>
            ) : (
              <p className="mt-2 text-xs text-amber-700">
                قالب استرشادي — راجِع مهندسك الزراعي قبل التطبيق (غير معتمد، ولا يُعدّ وصفة)
              </p>
            )}
            {canEdit && (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="ghost" onClick={() => setEditing(it)}>
                  تعديل
                </Button>
                {!it.authoritative && (
                  <SignoffForm item={it} onDone={() => router.refresh()} onError={setErr} />
                )}
                <Button variant="ghost" onClick={() => archive(it.id)}>
                  أرشفة
                </Button>
              </div>
            )}
          </Card>
        ),
      )}
    </div>
  );
}

function Badge({ authoritative }: { authoritative: boolean }) {
  return authoritative ? (
    <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">معتمد</span>
  ) : (
    <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
      قالب استرشادي
    </span>
  );
}

function ContentForm({
  orgId,
  item,
  onDone,
  onCancel,
}: {
  orgId: string;
  item?: AcademyItem;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(item?.title ?? "");
  const [category, setCategory] = useState(item?.category ?? "general");
  const [body, setBody] = useState(item?.body ?? "");
  const [hasChemical, setHasChemical] = useState(item?.hasChemical ?? false);
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setErr(null);
    const r = await saveAcademyContent({
      id: item?.id ?? null,
      orgId,
      title,
      body,
      category,
      hasChemical,
    });
    setPending(false);
    if (!r.ok) return setErr(r.error);
    onDone();
  }

  return (
    <Card className="p-4">
      <form onSubmit={submit} className="space-y-3">
        {err && <Alert tone="danger" title={err} />}
        {item && (
          <Alert
            tone="warning"
            title="تعديل المحتوى سيُلغي أي اعتماد سابق — يجب مراجعته من المهندس الزراعي مجددًا"
          />
        )}
        <Field label="العنوان" id="ac-title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} />
        </Field>
        <Field label="التصنيف" id="ac-cat">
          <Select options={CATEGORIES} value={category} onChange={(e) => setCategory(e.target.value)} />
        </Field>
        <Field label="المحتوى" id="ac-body">
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} maxLength={4000} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={hasChemical}
            onChange={(e) => setHasChemical(e.target.checked)}
          />
          يحتوي على مبيد/مادة كيميائية (يتطلب تسجيلًا مصريًا ساريًا للاعتماد)
        </label>
        <div className="flex gap-2">
          <Button type="submit" disabled={pending}>
            {pending ? "جارٍ الحفظ…" : "حفظ"}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            إلغاء
          </Button>
        </div>
      </form>
    </Card>
  );
}

function SignoffForm({
  item,
  onDone,
  onError,
}: {
  item: AcademyItem;
  onDone: () => void;
  onError: (m: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [regDate, setRegDate] = useState("");
  const [regNumber, setRegNumber] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    const r = await signoffAcademyContent({
      id: item.id,
      agronomistName: name,
      pesticideRegValidUntil: item.hasChemical ? regDate || null : null,
      pesticideRegNumber: item.hasChemical ? regNumber || null : null,
    });
    setPending(false);
    if (!r.ok) return onError(r.error);
    setOpen(false);
    onDone();
  }

  if (!open) {
    return (
      <Button variant="primary" onClick={() => setOpen(true)}>
        اعتماد المهندس
      </Button>
    );
  }
  return (
    <form onSubmit={submit} className="flex w-full flex-wrap items-end gap-2">
      <Field label="اسم المهندس الزراعي" id={`so-name-${item.id}`}>
        <Input value={name} onChange={(e) => setName(e.target.value)} required />
      </Field>
      {item.hasChemical && (
        <Field label="سريان تسجيل المبيد حتى" id={`so-reg-${item.id}`}>
          <Input type="date" value={regDate} onChange={(e) => setRegDate(e.target.value)} required />
        </Field>
      )}
      {item.hasChemical && (
        <Field label="رقم تسجيل المبيد المصري" id={`so-regnum-${item.id}`}>
          <Input value={regNumber} onChange={(e) => setRegNumber(e.target.value)} required />
        </Field>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "…" : "تأكيد الاعتماد"}
      </Button>
    </form>
  );
}
