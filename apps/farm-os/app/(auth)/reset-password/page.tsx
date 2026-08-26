import type { Metadata } from "next";
import { ResetPasswordForm } from "./reset-password-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { referrer: "no-referrer" };

export default function ResetPasswordPage() {
  return <ResetPasswordForm />;
}
