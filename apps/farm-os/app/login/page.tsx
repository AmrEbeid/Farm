"use client";

import { useState } from "react";
import { Button, Field, Input, Alert, Tag } from "@/components/ui";
import { createClient } from "@/lib/supabase/browser";

// Arabic labels below are kept in sync with the canonical ROLE_LABEL_AR map in
// lib/auth.ts. We can't import that map here: auth.ts transitively pulls in
// next/headers (server-only), which is not allowed in a client component.
const DEMO_ACCOUNTS = [
  { role: "المالك", email: "owner@ebeid.test" },
  { role: "مدير المزرعة", email: "manager@ebeid.test" },
  { role: "أمين مخزن", email: "storekeeper@ebeid.test" },
  { role: "مشرف ميداني", email: "supervisor@ebeid.test" },
];
const DEMO_PASSWORD = "farm-os-pilot";

export default function LoginPage() {
  const [email, setEmail] = useState("owner@ebeid.test");
  const [password, setPassword] = useState(DEMO_PASSWORD);
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"info" | "danger" | "ok">("info");
  const [pending, setPending] = useState(false);

  async function signIn(e?: React.FormEvent) {
    e?.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setTone("danger");
        // Don't leak the raw English Supabase auth error to the Arabic UI.
        setMessage("تعذّر تسجيل الدخول. تأكد من البريد وكلمة المرور، أو جرّب «تفعيل حسابات العرض» أولاً.");
        setPending(false);
        return;
      }
      // Wait until the session cookie is actually persisted, then do a full
      // navigation so the server receives the fresh auth cookie on the next
      // request (router.push can race ahead of the cookie write).
      await supabase.auth.getSession();
      window.location.assign("/dashboard");
      return;
    } catch {
      setTone("danger");
      setMessage("تعذّر الاتصال بالخادم.");
    } finally {
      setPending(false);
    }
  }

  async function enableDemo() {
    setPending(true);
    setMessage(null);
    try {
      const res = await fetch("/api/dev/seed-auth", { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        setTone("ok");
        setMessage("تم تفعيل حسابات العرض. اختر دورًا للدخول.");
      } else {
        setTone("danger");
        setMessage(data.error ?? "فشل التفعيل");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6 py-12">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">تسجيل الدخول</h1>
        <p style={{ color: "var(--ink-muted)" }}>نظام تشغيل المزارع — مزارع عبيد</p>
      </header>

      <div aria-live="polite" aria-atomic="true">
        {message && <Alert tone={tone} title={message} />}
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

      <div className="flex flex-col gap-3 border-t pt-4" style={{ borderColor: "var(--line)" }}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">حسابات العرض</span>
          <Button type="button" variant="ghost" size="sm" onClick={enableDemo} loading={pending}>
            تفعيل حسابات العرض
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {DEMO_ACCOUNTS.map((a) => (
            <button
              key={a.email}
              type="button"
              onClick={() => {
                setEmail(a.email);
                setPassword(DEMO_PASSWORD);
              }}
              className="cursor-pointer"
            >
              <Tag tone={email === a.email ? "accent" : "neutral"}>{a.role}</Tag>
            </button>
          ))}
        </div>
        <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
          الدخول بالبريد الإلكتروني وكلمة المرور. في البيئة المحلية فعّل حسابات
          العرض أعلاه.
        </p>
      </div>
    </main>
  );
}
