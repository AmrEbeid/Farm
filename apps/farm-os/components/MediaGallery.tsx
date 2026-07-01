"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Button, Alert, Input, EmptyState, ConfirmDialog, useToast } from "@/components/ui";
import { createClient } from "@/lib/supabase/browser";
import {
  addAttachment,
  archiveAttachment,
  type AttachmentView,
} from "@/app/(app)/farm/structure-actions";

type EntityType = "farm" | "sector" | "hawsha" | "line" | "palm";

const BUCKET = "farm-media";
const MAX_DIM = 1600; // longest edge after client-side compression
const MAX_BYTES = 26214400; // 25 MB — matches fn_add_attachment's ceiling

/** Downscale an image file to <=MAX_DIM on its longest edge and re-encode as JPEG (~0.8). Non-images
 * (PDF) pass through untouched. Keeps field uploads small without a server round-trip. */
async function compressImage(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/") || file.type === "image/heic" || file.type === "image/heif") {
    return file; // can't reliably canvas-decode HEIC in-browser; upload as-is.
  }
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, w, h);
  const blob: Blob | null = await new Promise((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.8),
  );
  return blob ?? file;
}

/**
 * Photos & documents for a structure node. The binary goes straight to the private `farm-media`
 * bucket (org-scoped path → storage RLS); the metadata is recorded via the op.execute-gated
 * fn_add_attachment RPC. Reads use short-lived signed URLs computed server-side (passed as `initial`).
 */
export function MediaGallery({
  entityType,
  entityId,
  orgId,
  initial,
  canAttach,
}: {
  entityType: EntityType;
  entityId: string;
  orgId: string;
  initial: AttachmentView[];
  canAttach: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  // Attachment id awaiting delete confirmation, or null when the dialog is closed. This is
  // the first ConfirmDialog wired into the app (foundation PR) — previously "حذف" removed
  // the attachment on a single click with no confirmation at all.
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;

    const isImage = file.type.startsWith("image/");
    const isPdf = file.type === "application/pdf";
    if (!isImage && !isPdf) {
      setError("الملفات المسموحة: صور أو PDF فقط");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const body = isImage ? await compressImage(file) : file;
      if (body.size > MAX_BYTES) {
        setError("الملف كبير جدًا (الحد 25 ميجابايت)");
        setPending(false);
        return;
      }
      const ext = isPdf ? "pdf" : "jpg";
      const path = `${orgId}/${entityType}/${entityId}/${crypto.randomUUID()}.${ext}`;
      const contentType = isPdf ? "application/pdf" : "image/jpeg";

      const sb = createClient();
      const { error: upErr } = await sb.storage
        .from(BUCKET)
        .upload(path, body, { contentType, upsert: false });
      if (upErr) {
        setError("تعذّر رفع الملف. تأكد من الاتصال وحاول مجددًا.");
        setPending(false);
        return;
      }

      const res = await addAttachment({
        entityType,
        entityId,
        storagePath: path,
        kind: isPdf ? "document" : "photo",
        caption: caption.trim() || null,
        contentType,
        sizeBytes: body.size,
      });
      if (!res.ok) {
        setError(res.error ?? "تعذّر حفظ المرفق");
        setPending(false);
        return;
      }
      setCaption("");
      router.refresh();
    } catch {
      setError("تعذّر رفع الملف. حاول مجددًا.");
    } finally {
      setPending(false);
    }
  }

  async function confirmRemove() {
    if (!removeTarget) return;
    setPending(true);
    setError(null);
    const res = await archiveAttachment(removeTarget, true);
    setPending(false);
    if (!res.ok) {
      setError(res.error ?? "تعذّر حذف المرفق");
      setRemoveTarget(null);
      return;
    }
    setRemoveTarget(null);
    toast.ok("تم حذف المرفق");
    router.refresh();
  }

  return (
    <Card title="الصور والمستندات">
      <div className="flex flex-col gap-4">
        <div aria-live="assertive" aria-atomic="true">
          {error && <Alert tone="danger" title={error} />}
        </div>

        {canAttach && (
          <div className="flex flex-col gap-2">
            <Input
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="وصف (اختياري)"
              maxLength={200}
            />
            <label className="inline-flex">
              <input
                type="file"
                accept="image/*,application/pdf"
                onChange={onPick}
                disabled={pending}
                className="block w-full text-sm file:me-3 file:rounded-md file:border-0 file:bg-[var(--color-accent,#2563eb)] file:px-4 file:py-2 file:text-white"
                aria-label="إضافة صورة أو مستند"
              />
            </label>
            {pending && <span className="text-sm opacity-70">جارٍ الرفع…</span>}
          </div>
        )}

        {initial.length === 0 ? (
          <EmptyState title="لا توجد مرفقات بعد" />
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {initial.map((a) => (
              <li key={a.id} className="flex flex-col gap-1 rounded-lg border border-[var(--color-border,#e5e7eb)] p-2">
                {a.kind === "photo" && a.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.url} alt={a.caption ?? "صورة"} className="h-28 w-full rounded-md object-cover" />
                ) : a.url ? (
                  <a href={a.url} target="_blank" rel="noopener noreferrer"
                    className="flex h-28 items-center justify-center rounded-md bg-black/5 text-sm underline">
                    📄 فتح المستند
                  </a>
                ) : (
                  <div className="flex h-28 items-center justify-center rounded-md bg-black/5 text-xs opacity-60">
                    المرفق غير متاح
                  </div>
                )}
                {a.caption && <span className="truncate text-xs">{a.caption}</span>}
                {canAttach && (
                  <Button variant="ghost" onClick={() => setRemoveTarget(a.id)} disabled={pending}>
                    حذف
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <ConfirmDialog
        open={removeTarget !== null}
        onClose={() => setRemoveTarget(null)}
        onConfirm={confirmRemove}
        loading={pending}
        tone="danger"
        title="حذف المرفق"
        description="سيتم حذف هذا المرفق ولن يظهر بعد ذلك في القائمة."
        confirmLabel="حذف"
        cancelLabel="إلغاء"
        closeLabel="إغلاق"
      />
    </Card>
  );
}
