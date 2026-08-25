"use client";

import { useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, useToast } from "@/components/ui";
import {
  addSystemTicketAttachment,
  createSystemTicket,
  updateSystemTicket,
} from "@/app/(app)/support/actions";
import { fmtDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/browser";

const ATTACHMENT_BUCKET = "support-attachments";
const MAX_FILES = 5;
const MAX_FILE_BYTES = 26214400;

const FILE_TYPES: Record<string, { contentType: string; extension: string }> = {
  "image/jpeg": { contentType: "image/jpeg", extension: "jpg" },
  "image/png": { contentType: "image/png", extension: "png" },
  "image/webp": { contentType: "image/webp", extension: "webp" },
  "image/heic": { contentType: "image/heic", extension: "heic" },
  "image/heif": { contentType: "image/heif", extension: "heif" },
  "application/pdf": { contentType: "application/pdf", extension: "pdf" },
  "application/msword": { contentType: "application/msword", extension: "doc" },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    extension: "docx",
  },
};

const EXTENSION_TYPES: Record<string, { contentType: string; extension: string }> = {
  jpg: FILE_TYPES["image/jpeg"],
  jpeg: FILE_TYPES["image/jpeg"],
  png: FILE_TYPES["image/png"],
  webp: FILE_TYPES["image/webp"],
  heic: FILE_TYPES["image/heic"],
  heif: FILE_TYPES["image/heif"],
  pdf: FILE_TYPES["application/pdf"],
  doc: FILE_TYPES["application/msword"],
  docx: FILE_TYPES["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
};

function attachmentType(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const byMime = FILE_TYPES[file.type];
  const byExtension = EXTENSION_TYPES[extension];
  if (byMime && byExtension && byMime.contentType === byExtension.contentType) return byMime;
  if ((!file.type || file.type === "application/octet-stream") && byExtension) return byExtension;
  return null;
}

function attachmentSize(size: number): string {
  const mb = size / 1048576;
  return `${new Intl.NumberFormat("ar-EG-u-nu-arab", { maximumFractionDigits: 1 }).format(mb)} م.ب`;
}

export interface SupportAttachment {
  id: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  created_at: string;
  url: string | null;
}

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
  attachments: SupportAttachment[];
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

export function SupportTickets({
  tickets,
  isOwner,
  orgId,
  currentUserId,
}: {
  tickets: SupportTicket[];
  isOwner: boolean;
  orgId: string;
  currentUserId: string;
}) {
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const toast = useToast();
  const router = useRouter();

  function validateAttachments(files: File[]) {
    if (files.length > MAX_FILES) throw new Error(`اختر ${MAX_FILES} ملفات كحد أقصى في المرة الواحدة.`);
    const prepared = files.map((file) => ({ file, type: attachmentType(file) }));
    if (prepared.some(({ type }) => !type)) throw new Error("المسموح: صور JPG وPNG وWebP وHEIC، أو PDF وWord فقط.");
    if (prepared.some(({ file }) => file.size < 1 || file.size > MAX_FILE_BYTES)) {
      throw new Error("يجب ألا يتجاوز حجم الملف 25 ميجابايت.");
    }
    return prepared;
  }

  async function uploadAttachments(ticketId: string, files: File[]) {
    const prepared = validateAttachments(files);
    const sb = createClient();
    let uploaded = 0;
    for (const { file, type } of prepared) {
      if (!type) continue;
      const path = `${orgId}/${ticketId}/${crypto.randomUUID()}.${type.extension}`;
      const { error: uploadError } = await sb.storage
        .from(ATTACHMENT_BUCKET)
        .upload(path, file, { contentType: type.contentType, upsert: false });
      if (uploadError) return { uploaded, total: prepared.length, error: "تعذّر رفع أحد المرفقات. حاول مرة أخرى." };
      const registered = await addSystemTicketAttachment({
        ticketId,
        storagePath: path,
        fileName: file.name,
        contentType: type.contentType,
        sizeBytes: file.size,
      });
      if (!registered.ok) {
        return { uploaded, total: prepared.length, error: registered.error ?? "تعذّر حفظ المرفق مع الطلب." };
      }
      uploaded += 1;
    }
    return { uploaded, total: prepared.length };
  }

  function submitTicket(formData: FormData) {
    startTransition(async () => {
      const attachments = formData
        .getAll("attachments")
        .filter((value): value is File => value instanceof File && value.size > 0);
      formData.delete("attachments");
      try {
        validateAttachments(attachments);
      } catch (error) {
        toast.danger(error instanceof Error ? error.message : "المرفقات غير صالحة.");
        return;
      }
      const result = await createSystemTicket(formData);
      if (!result.ok) {
        toast.danger(result.error ?? "تعذّر إرسال الطلب");
        return;
      }
      const outcome = result.data && attachments.length > 0
          ? await uploadAttachments(result.data, attachments)
          : { uploaded: 0, total: 0 };
      formRef.current?.reset();
      if (outcome.error) {
        toast.danger(`تم إرسال الطلب ورفع ${outcome.uploaded} من ${outcome.total} مرفق. ${outcome.error}`);
      } else {
        toast.ok(outcome.uploaded > 0
          ? `تم إرسال الطلب ورفع ${outcome.uploaded} مرفق`
          : "تم إرسال الطلب ومراجعته ضمن قائمة التطوير");
      }
      router.refresh();
    });
  }

  function addFiles(ticketId: string, files: File[]) {
    startTransition(async () => {
      try {
        const outcome = await uploadAttachments(ticketId, files);
        if (outcome.error) {
          toast.danger(`تم رفع ${outcome.uploaded} من ${outcome.total} مرفق. ${outcome.error}`);
        } else {
          toast.ok(`تم رفع ${outcome.uploaded} مرفق`);
        }
      } catch (error) {
        toast.danger(error instanceof Error ? error.message : "تعذّر رفع المرفقات.");
      } finally {
        router.refresh();
      }
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
          صور أو مستندات
          <input
            type="file"
            name="attachments"
            multiple
            accept=".jpg,.jpeg,.png,.webp,.heic,.heif,.pdf,.doc,.docx,image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            disabled={pending}
            className="block w-full text-sm file:me-3 file:rounded-md file:border-0 file:bg-[var(--color-accent,#2563eb)] file:px-3 file:py-2 file:text-white"
          />
          <span className="font-normal text-muted-foreground">حتى 5 ملفات في المرة، و25 ميجابايت للملف. لا ترفع بيانات سرية.</span>
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
            {ticket.attachments.length > 0 && (
              <div className="mt-3">
                <strong className="text-sm">المرفقات:</strong>
                <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                  {ticket.attachments.map((attachment) => (
                    <li key={attachment.id} className="min-w-0 rounded-md border p-2 text-sm">
                      {attachment.content_type.startsWith("image/") && attachment.url ? (
                        <a href={attachment.url} target="_blank" rel="noopener noreferrer" className="block">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={attachment.url}
                            alt={attachment.file_name}
                            loading="lazy"
                            decoding="async"
                            className="mb-2 aspect-video w-full rounded-md object-cover"
                          />
                        </a>
                      ) : null}
                      {attachment.url ? (
                        <a href={attachment.url} target="_blank" rel="noopener noreferrer" className="block truncate font-semibold underline">
                          {attachment.file_name}
                        </a>
                      ) : <span className="block truncate font-semibold">{attachment.file_name}</span>}
                      <span className="text-xs text-muted-foreground">{attachmentSize(attachment.size_bytes)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {(isOwner || ticket.created_by === currentUserId) && (
              <label className="mt-3 inline-flex cursor-pointer items-center gap-2 text-sm font-semibold text-[var(--color-accent,#2563eb)]">
                <span>إضافة مرفقات</span>
                <input
                  type="file"
                  multiple
                  accept=".jpg,.jpeg,.png,.webp,.heic,.heif,.pdf,.doc,.docx,image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  disabled={pending}
                  className="sr-only"
                  onChange={(event) => {
                    const files = Array.from(event.target.files ?? []);
                    event.target.value = "";
                    if (files.length > 0) addFiles(ticket.id, files);
                  }}
                />
              </label>
            )}
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
