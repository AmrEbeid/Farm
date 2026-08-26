"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Alert, Button, Card, Field, Input } from "@/components/ui";

const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 128;

export function ResetPasswordForm() {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [activeTokenHash, setActiveTokenHash] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);
  const [sessionWarning, setSessionWarning] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.hash.slice(1));
      const candidate = params.get("token_hash");
      const type = params.get("type");
      window.history.replaceState(null, "", "/reset-password");
      setActiveTokenHash(candidate && type === "recovery" ? candidate : null);
      setChecking(false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function savePassword(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setMessage(`استخدم كلمة مرور لا تقل عن ${MIN_PASSWORD_LENGTH} حرفًا.`);
      return;
    }
    if (password !== confirmation) {
      setMessage("كلمتا المرور غير متطابقتين.");
      return;
    }

    if (!activeTokenHash) {
      setMessage("الرابط غير صالح أو انتهت صلاحيته. اطلب رابطًا جديدًا.");
      return;
    }

    setPending(true);
    try {
      const response = await fetch("/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tokenHash: activeTokenHash, password }),
      });
      const result: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        if (
          result &&
          typeof result === "object" &&
          "passwordChanged" in result &&
          result.passwordChanged === true
        ) {
          setPassword("");
          setConfirmation("");
          setActiveTokenHash(null);
          setSessionWarning(true);
          setComplete(true);
          return;
        }
        setMessage("تعذّر حفظ كلمة المرور الجديدة. اطلب رابط استعادة جديدًا وحاول مرة أخرى.");
        return;
      }

      setPassword("");
      setConfirmation("");
      setActiveTokenHash(null);
      setComplete(true);
    } catch {
      setMessage("تعذّر الاتصال بالخادم.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center px-6 py-10" style={{ background: "var(--surface)" }}>
      <section className="w-full max-w-md">
        <Card className="flex flex-col gap-6">
          <header className="flex flex-col gap-2">
            <h1 className="text-2xl font-bold">اختيار كلمة مرور جديدة</h1>
            <p className="leading-relaxed" style={{ color: "var(--ink-muted)" }}>
              استخدم كلمة مرور خاصة بهذا الحساب ولا تشاركها مع أي شخص.
            </p>
          </header>

          <div aria-live="polite" aria-atomic="true">
            {message && <Alert tone="danger" title={message} />}
            {complete && !sessionWarning && <Alert tone="ok" title="تم تغيير كلمة المرور بنجاح." />}
            {sessionWarning && (
              <Alert
                tone="warning"
                title="تم تغيير كلمة المرور، لكن تعذّر إنهاء الجلسات الأخرى. سجّل الدخول وأبلغ المالك فورًا."
              />
            )}
            {!checking && !activeTokenHash && !complete && (
              <Alert tone="danger" title="الرابط غير صالح أو انتهت صلاحيته. اطلب رابطًا جديدًا." />
            )}
          </div>

          {checking && <p style={{ color: "var(--ink-muted)" }}>جارٍ تجهيز الرابط الآمن...</p>}

          {!checking && activeTokenHash && !complete && (
            <form onSubmit={savePassword} className="flex flex-col gap-4">
              <Field label="كلمة المرور الجديدة" id="new-password">
                <Input
                  id="new-password"
                  type="password"
                  dir="ltr"
                  autoComplete="new-password"
                  minLength={MIN_PASSWORD_LENGTH}
                  maxLength={MAX_PASSWORD_LENGTH}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </Field>
              <Field label="تأكيد كلمة المرور" id="confirm-password">
                <Input
                  id="confirm-password"
                  type="password"
                  dir="ltr"
                  autoComplete="new-password"
                  minLength={MIN_PASSWORD_LENGTH}
                  maxLength={MAX_PASSWORD_LENGTH}
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  required
                />
              </Field>
              <Button type="submit" variant="primary" loading={pending}>
                حفظ كلمة المرور
              </Button>
            </form>
          )}

          <Link
            href={complete ? "/login" : "/forgot-password"}
            className="w-fit text-sm font-semibold underline underline-offset-4"
            style={{ color: "var(--brand)" }}
          >
            {complete ? "تسجيل الدخول" : "طلب رابط استعادة جديد"}
          </Link>
        </Card>
      </section>
    </main>
  );
}
