"use client";

import { useRef, useTransition } from "react";
import { Button, useToast } from "@/components/ui";
import { createSystemTicket, updateSystemTicket } from "@/app/(app)/support/actions";
import { fmtDate } from "@/lib/dates";

export interface SupportTicket {
  id: string;
  created_by: string | null;
  creator_name: string;
  category: string;
  title: string;
  description: string;
  page_path: string | null;
  expected_result: string | null;
  evidence: string | null;
  urgency: string;
  status: string;
  resolution: string | null;
  created_at: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  bug: "مشكلة",
  edit: "تعديل",
  development: "تطوير جديد",
  idea: "فكرة",
};
const URGENCY_LABELS: Record<string, string> = {
  low: "منخفضة",
  normal: "عادية",
  high: "عالية",
  critical: "عاجلة",
};
const STATUS_LABELS: Record<string, string> = {
  new: "جديد",
  triaged: "تمت المراجعة",
  in_progress: "جارٍ العمل",
  done: "مكتمل",
  blocked: "متوقف",
  rejected: "لن يُنفذ",
};

export function SupportTickets({ tickets, isOwner }: { tickets: SupportTicket[]; isOwner: boolean }) {
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const toast = useToast();

  function submitTicket(formData: FormData) {
    startTransition(async () => {
      const result = await createSystemTicket(formData);
      if (!result.ok) {
        toast.danger(result.error ?? "تعذّر إرسال الطلب");
        return;
      }
      formRef.current?.reset();
      toast.ok("تم إرسال الطلب ومراجعته ضمن قائمة التطوير");
    });
  }

  function updateTicket(formData: FormData) {
    startTransition(async () => {
      const result = await updateSystemTicket(formData);
      if (!result.ok) toast.danger(result.error ?? "تعذّر تحديث الطلب");
      else toast.ok("تم تحديث حالة الطلب");
    });
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.2fr)]">
      <form ref={formRef} action={submitTicket} className="flex h-fit flex-col gap-4 rounded-md border p-4">
        <div>
          <h2 className="text-lg font-bold">طلب جديد</h2>
          <p className="text-sm text-muted-foreground">اشرح النتيجة التي تحتاجها؛ لا تكتب كلمات مرور أو بيانات سرية.</p>
        </div>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          نوع الطلب
          <select name="category" required defaultValue="bug" className="min-h-10 rounded-md border bg-transparent px-3">
            <option value="bug">مشكلة لا تعمل</option>
            <option value="edit">تعديل مطلوب</option>
            <option value="development">تطوير جديد</option>
            <option value="idea">فكرة تحسين</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          عنوان مختصر
          <input name="title" required minLength={3} maxLength={160} className="min-h-10 rounded-md border bg-transparent px-3" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          ما المشكلة أو المطلوب؟
          <textarea name="description" required minLength={10} maxLength={5000} rows={5} className="rounded-md border bg-transparent p-3" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          الصفحة أو المسار
          <input name="page_path" maxLength={500} placeholder="مثال: المصروفات أو /expenses" className="min-h-10 rounded-md border bg-transparent px-3" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          النتيجة المتوقعة
          <textarea name="expected_result" maxLength={2000} rows={3} className="rounded-md border bg-transparent p-3" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          دليل أو رابط إضافي
          <textarea name="evidence" maxLength={2000} rows={2} placeholder="رسالة الخطأ أو رابط صورة" className="rounded-md border bg-transparent p-3" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          الأولوية
          <select name="urgency" required defaultValue="normal" className="min-h-10 rounded-md border bg-transparent px-3">
            <option value="low">منخفضة</option>
            <option value="normal">عادية</option>
            <option value="high">عالية</option>
            <option value="critical">عاجلة وتوقف العمل</option>
          </select>
        </label>
        <Button type="submit" variant="primary" disabled={pending}>{pending ? "جارٍ الإرسال…" : "إرسال الطلب"}</Button>
      </form>

      <section className="flex min-w-0 flex-col gap-3">
        <div>
          <h2 className="text-lg font-bold">{isOwner ? "كل طلبات النظام" : "طلباتي"}</h2>
          <p className="text-sm text-muted-foreground">تظهر الحالة والنتيجة هنا بعد المراجعة والتنفيذ.</p>
        </div>
        {tickets.length === 0 ? (
          <p className="rounded-md border p-4 text-sm text-muted-foreground">لا توجد طلبات بعد.</p>
        ) : tickets.map((ticket) => (
          <article key={ticket.id} className="rounded-md border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span>{CATEGORY_LABELS[ticket.category] ?? ticket.category}</span>
                  <span>·</span>
                  <span>أولوية {URGENCY_LABELS[ticket.urgency] ?? ticket.urgency}</span>
                  {isOwner && <><span>·</span><span>{ticket.creator_name}</span></>}
                </div>
                <h3 className="mt-1 font-bold">{ticket.title}</h3>
              </div>
              <div className="text-end text-xs text-muted-foreground">
                <div>{STATUS_LABELS[ticket.status] ?? ticket.status}</div>
                <div>{fmtDate(ticket.created_at)}</div>
              </div>
            </div>
            <p className="mt-3 whitespace-pre-wrap text-sm">{ticket.description}</p>
            {ticket.page_path && <p className="mt-2 text-sm"><strong>الصفحة:</strong> {ticket.page_path}</p>}
            {ticket.expected_result && <p className="mt-2 text-sm"><strong>المتوقع:</strong> {ticket.expected_result}</p>}
            {ticket.evidence && <p className="mt-2 whitespace-pre-wrap text-sm"><strong>الدليل:</strong> {ticket.evidence}</p>}
            {ticket.resolution && <p className="mt-3 rounded-md bg-muted p-3 text-sm"><strong>النتيجة:</strong> {ticket.resolution}</p>}
            {isOwner && (
              <form action={updateTicket} className="mt-4 grid gap-2 sm:grid-cols-[12rem_1fr_auto]">
                <input type="hidden" name="id" value={ticket.id} />
                <select name="status" defaultValue={ticket.status} className="min-h-10 rounded-md border bg-transparent px-3 text-sm">
                  {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
                <input name="resolution" defaultValue={ticket.resolution ?? ""} maxLength={3000} placeholder="النتيجة أو سبب التوقف" className="min-h-10 rounded-md border bg-transparent px-3 text-sm" />
                <Button type="submit" variant="ghost" disabled={pending}>حفظ</Button>
              </form>
            )}
          </article>
        ))}
      </section>
    </div>
  );
}
