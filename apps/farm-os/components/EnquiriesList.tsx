"use client";

import { useTransition } from "react";
import { Button, useToast } from "@/components/ui";
import { fmtDate } from "@/lib/dates";
import { setEnquiryStatus } from "@/app/(app)/enquiries/actions";

export interface Enquiry {
  id: string;
  name: string;
  company: string | null;
  country: string | null;
  volume: string | null;
  message: string;
  status: string;
  created_at: string;
}

const STATUS_LABEL: Record<string, string> = { new: "جديد", read: "مقروء", archived: "مؤرشف" };

export function EnquiriesList({ items }: { items: Enquiry[] }) {
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  function act(id: string, status: "new" | "read" | "archived") {
    startTransition(async () => {
      const res = await setEnquiryStatus(id, status);
      if (!res.ok) toast.danger(res.error);
    });
  }

  if (items.length === 0) {
    return <p className="rounded-lg border p-4 text-sm text-muted-foreground">لا توجد طلبات هنا.</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {items.map((e) => (
        <li key={e.id} className="rounded-lg border p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-bold">
              {e.name}
              {e.status !== "new" && (
                <span className="ms-2 rounded-full border px-2 py-0.5 text-xs font-normal text-muted-foreground">
                  {STATUS_LABEL[e.status] ?? e.status}
                </span>
              )}
            </span>
            <span className="text-xs text-muted-foreground">{fmtDate(e.created_at)}</span>
          </div>
          {(e.company || e.country || e.volume) && (
            <p className="mt-0.5 text-sm text-muted-foreground">
              {[e.company, e.country, e.volume].filter(Boolean).join(" · ")}
            </p>
          )}
          <p className="mt-2 whitespace-pre-wrap text-sm">{e.message}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {e.status !== "read" && e.status !== "archived" && (
              <Button variant="ghost" onClick={() => act(e.id, "read")} disabled={pending}>
                تحديد كمقروء
              </Button>
            )}
            {e.status !== "archived" ? (
              <Button variant="ghost" onClick={() => act(e.id, "archived")} disabled={pending}>
                أرشفة
              </Button>
            ) : (
              <Button variant="ghost" onClick={() => act(e.id, "new")} disabled={pending}>
                إلغاء الأرشفة
              </Button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
