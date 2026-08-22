"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, useToast } from "@/components/ui";
import { logMarketingContactActivity } from "@/app/(app)/marketing/actions";
import type { MarketingContactActivityRow, MarketingContactRow } from "@/components/marketing/MarketingContactTable";
import { whatsappHref } from "@/lib/marketing/workspace/outbound-links";

function mailtoHref(contact: MarketingContactRow, subject: string, body: string): string | null {
  if (!contact.email) return null;
  return `mailto:${encodeURIComponent(contact.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/**
 * SPEC-0032 — the legacy "gmail" outbox: today's selected contacts, each with a mailto:/wa.me: link
 * that opens the operator's OWN mail/WhatsApp client with the message pre-filled. Nothing here sends
 * anything — the Apps Script auto-send is removed entirely (CLAUDE.md hard stop on outbound at
 * scale). Opening a draft logs a durable `marketing_contact_activity` note; that append-only log is
 * also used to restore today's opened markers after refresh, without a duplicate legacy state blob.
 */
export function WorkspaceOutboxPanel({
  contacts,
  activity,
  messageBody,
  subject,
}: {
  contacts: MarketingContactRow[];
  activity: MarketingContactActivityRow[];
  messageBody: string;
  subject: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const today = new Date().toISOString().slice(0, 10);
  const [openedIds, setOpenedIds] = useState<string[]>(() => [
    ...new Set(
      activity
        .filter((entry) => entry.kind === "note"
          && entry.notes?.includes("فتح مسودّة")
          && entry.occurredAt.slice(0, 10) === today)
        .map((entry) => entry.contactId),
    ),
  ]);

  async function markOpened(contact: MarketingContactRow, channel: "email" | "whatsapp") {
    if (!openedIds.includes(contact.id)) {
      setOpenedIds((current) => [...current, contact.id]);
    }
    const r = await logMarketingContactActivity({
      contactId: contact.id,
      kind: "note",
      notes: `فتح مسودّة ${channel === "email" ? "بريد" : "واتساب"} يدويًا من مساحة عمل التسويق — لم يتم الإرسال من النظام`,
    });
    if (!r.ok) toast.danger(r.error ?? "تعذّر تسجيل النشاط");
    else router.refresh();
  }

  async function resetOpened() {
    setOpenedIds([]);
    toast.ok("تمت إعادة ضبط قائمة اليوم");
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border p-4" style={{ borderColor: "var(--line)" }}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">قائمة المسودّات</h2>
          <p style={{ color: "var(--ink-muted)" }}>
            الجهات المختارة اليوم. كل زر يفتح بريدًا أو واتساب معبّأً في جهازك — النظام لا يرسل شيئًا.
          </p>
        </div>
        <div className="no-print">
          <Button variant="ghost" onClick={() => void resetOpened()}>إعادة ضبط قائمة اليوم</Button>
        </div>
      </header>
      {contacts.length === 0 ? (
        <p style={{ color: "var(--ink-muted)" }}>لا توجد جهات مختارة اليوم. اختر جهات من دليل التواصل.</p>
      ) : (
        <ul className="flex flex-col divide-y" style={{ borderColor: "var(--line)" }}>
          {contacts.map((contact) => {
            const mail = mailtoHref(contact, subject, messageBody);
            const wa = whatsappHref(contact.phone, messageBody);
            const opened = openedIds.includes(contact.id);
            return (
              <li key={contact.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <div className="font-bold">{contact.name}</div>
                  <div className="text-xs" style={{ color: "var(--ink-muted)" }}>{contact.orgName ?? contact.category}</div>
                </div>
                <div className="no-print flex flex-wrap items-center gap-2">
                  {opened && <span className="text-xs" style={{ color: "var(--ink-muted)" }}>تم الفتح</span>}
                  {mail && (
                    <a href={mail} onClick={() => void markOpened(contact, "email")} className="underline-offset-2 hover:underline">
                      افتح البريد
                    </a>
                  )}
                  {wa && (
                    <a href={wa} target="_blank" rel="noreferrer" onClick={() => void markOpened(contact, "whatsapp")} className="underline-offset-2 hover:underline">
                      افتح واتساب
                    </a>
                  )}
                  {!mail && !wa && <span className="text-xs" style={{ color: "var(--ink-muted)" }}>لا يوجد بريد أو هاتف</span>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
