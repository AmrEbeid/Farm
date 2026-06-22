"use client";

import { useState } from "react";
import { Button, Field, Input, Alert } from "@/components/ui";
import { createClient } from "@/lib/supabase/browser";

type Stage = "phone" | "otp";

export default function LoginPage() {
  const [stage, setStage] = useState<Stage>("phone");
  const [phone, setPhone] = useState("");
  const [token, setToken] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function sendOtp(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOtp({ phone });
      if (error) {
        setMessage(error.message);
      } else {
        setStage("otp");
      }
    } catch {
      setMessage("تعذّر الاتصال بالخادم. حاول مرة أخرى.");
    } finally {
      setPending(false);
    }
  }

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.verifyOtp({
        phone,
        token,
        type: "sms",
      });
      setMessage(error ? error.message : "تم تسجيل الدخول.");
    } catch {
      setMessage("تعذّر التحقق من الرمز. حاول مرة أخرى.");
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

      {message && <Alert tone="info" title={message} />}

      {stage === "phone" ? (
        <form onSubmit={sendOtp} className="flex flex-col gap-4">
          <Field label="رقم الهاتف" id="phone">
            <Input
              id="phone"
              type="tel"
              dir="ltr"
              placeholder="+201234567890"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
            />
          </Field>
          <Button type="submit" variant="primary" loading={pending}>
            إرسال رمز التحقق
          </Button>
        </form>
      ) : (
        <form onSubmit={verifyOtp} className="flex flex-col gap-4">
          <Field label="رمز التحقق" id="otp">
            <Input
              id="otp"
              inputMode="numeric"
              dir="ltr"
              placeholder="123456"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              required
            />
          </Field>
          <Button type="submit" variant="primary" loading={pending}>
            دخول
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setStage("phone");
              setMessage(null);
            }}
          >
            تغيير رقم الهاتف
          </Button>
        </form>
      )}
    </main>
  );
}
