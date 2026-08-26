"use client";

import Link from "next/link";
import { useState } from "react";
import { Alert, Button, Card, Field, Input } from "@/components/ui";
import { createClient } from "@/lib/supabase/browser";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);

  async function requestReset(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);

    try {
      const supabase = createClient();
      await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
    } catch {
      // Network and provider failures intentionally produce the same response.
    } finally {
      // Keep the response generic so this page cannot be used to discover users.
      setSent(true);
      setPending(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center px-6 py-10" style={{ background: "var(--surface)" }}>
      <section className="w-full max-w-md">
        <Card className="flex flex-col gap-6">
          <header className="flex flex-col gap-2">
            <h1 className="text-2xl font-bold">استعادة كلمة المرور</h1>
            <p className="leading-relaxed" style={{ color: "var(--ink-muted)" }}>
              أدخل بريدك الإلكتروني وسنرسل رابطًا آمنًا لاختيار كلمة مرور جديدة.
            </p>
          </header>

          <div aria-live="polite" aria-atomic="true">
            {sent && (
              <Alert
                tone="ok"
                title="إذا كان البريد مسجلًا، ستصلك رسالة الاستعادة خلال دقائق."
              />
            )}
          </div>

          {!sent && (
            <form onSubmit={requestReset} className="flex flex-col gap-4">
              <Field label="البريد الإلكتروني" id="recovery-email">
                <Input
                  id="recovery-email"
                  type="email"
                  dir="ltr"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </Field>
              <Button type="submit" variant="primary" loading={pending}>
                إرسال رابط الاستعادة
              </Button>
            </form>
          )}

          <Link
            href="/login"
            className="w-fit text-sm font-semibold underline underline-offset-4"
            style={{ color: "var(--brand)" }}
          >
            العودة إلى تسجيل الدخول
          </Link>
        </Card>
      </section>
    </main>
  );
}
