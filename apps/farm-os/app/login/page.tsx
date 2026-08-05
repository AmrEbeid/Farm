"use client";

import { useState } from "react";
import { Button, Field, Input, Alert, Card } from "@/components/ui";
import { createClient } from "@/lib/supabase/browser";

// Decorative signature cells, same abstract hawsha-grid brand motif as the public
// landing page (app/page.tsx / .hawsha-grid in globals.css). A handful are accented
// purely to echo the registry's status tracking — like the landing page, this
// asserts no real count or state (non-negotiable #1: never fabricate farm data).
const ACCENT: Record<number, "active" | "watch"> = {
  2: "active",
  6: "watch",
  11: "active",
  17: "active",
  20: "watch",
  24: "active",
};

export default function LoginPage() {
  // Both fields start blank. This page ships to production, so it must never
  // carry an account address or a password in the client bundle, and must never
  // offer to provision accounts (see docs/SECURITY-NOTES.md §5).
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function signIn(e?: React.FormEvent) {
    e?.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        // Don't leak the raw English Supabase auth error to the Arabic UI.
        setMessage("تعذّر تسجيل الدخول. تأكد من البريد الإلكتروني وكلمة المرور.");
        setPending(false);
        return;
      }
      // Wait until the session cookie is actually persisted, then do a full
      // navigation so the server receives the fresh auth cookie on the next
      // request (router.push can race ahead of the cookie write).
      await supabase.auth.getSession();
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- Preserve the same-origin full reload after the auth cookie write.
      window.location.assign("/dashboard");
      return;
    } catch {
      setMessage("تعذّر الاتصال بالخادم.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main
      className="grid min-h-screen place-items-center px-6 py-10 sm:py-12"
      style={{ background: "var(--surface)" }}
    >
      <div className="grid w-full max-w-5xl grid-cols-1 items-center gap-10 md:grid-cols-2 md:gap-16">
        {/* Form panel — same fields, submit handler, redirect and error logic as
            before, now inside a Card so it reads as part of the product rather
            than a bare, un-styled form. */}
        <section className="mx-auto flex w-full max-w-sm flex-col gap-6">
          <Card className="flex flex-col gap-6">
            <header className="flex flex-col gap-1">
              <h1 className="text-2xl font-bold">تسجيل الدخول</h1>
              <p style={{ color: "var(--ink-muted)" }}>نظام تشغيل المزارع — مزارع عبيد</p>
            </header>

            <div aria-live="polite" aria-atomic="true">
              {message && <Alert tone="danger" title={message} />}
            </div>

            <form onSubmit={signIn} className="flex flex-col gap-4">
              <Field label="البريد الإلكتروني" id="email">
                <Input
                  id="email"
                  type="email"
                  dir="ltr"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </Field>
              <Field label="كلمة المرور" id="password">
                <Input
                  id="password"
                  type="password"
                  dir="ltr"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </Field>
              <Button type="submit" variant="primary" loading={pending}>
                دخول
              </Button>
            </form>
          </Card>
        </section>

        {/* Brand panel — carries the landing page's voice (eyebrow, Readex Pro
            display headline, value-proposition line) and its hawsha-grid signature
            motif onto the login screen, so it reads as a continuation of the
            product rather than a generic auth screen. Decorative; no farm figures. */}
        <section className="flex flex-col gap-5">
          <p
            className="w-fit text-xs font-bold tracking-wide"
            style={{
              color: "var(--brand)",
              borderInlineStart: "2px solid var(--gold-500)",
              paddingInlineStart: "0.625rem",
            }}
          >
            نظام تشغيل المزارع · نخيل البلح والفاكهة
          </p>

          <h2
            className="text-3xl leading-tight font-bold text-balance sm:text-4xl"
            style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}
          >
            نفس الحلقة، من الخطة إلى{" "}
            <span style={{ color: "var(--gold-700)" }}>الحقل</span>.
          </h2>

          <p
            className="max-w-[38ch] text-base leading-relaxed"
            style={{ color: "var(--ink-muted)" }}
          >
            سجّل دخولك لمتابعة تغطية المخزون واعتمادات الصرف وعمليات الحوشة، حوشة
            بحوشة.
          </p>

          <div className="flex flex-col gap-3">
            <div className="hawsha-grid" aria-hidden="true">
              {Array.from({ length: 28 }, (_, i) => (
                <span key={i} data-state={ACCENT[i]} />
              ))}
            </div>
            <p className="text-center text-xs" style={{ color: "var(--ink-muted)" }}>
              الحوشة — وحدة الإدارة والمتابعة في المزرعة
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
