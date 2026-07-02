"use client";

import { useState } from "react";

/**
 * Shared submit guard for the app's write forms (F3).
 *
 * Every form used to do `setPending(true); await action(); setPending(false)` with no
 * try/catch/finally — so a thrown request (offline, DNS, 5xx that rejects) stranded the
 * spinner forever and swallowed the failure silently. This hook owns the pending flag and
 * guarantees it is always reset, turning a thrown request into a normal, retryable
 * `{ ok: false }` result the caller already knows how to render.
 *
 * Usage:
 *   const { pending, submit } = useSubmit();
 *   const r = await submit(() => createExpense(payload));
 *   if (r.ok) { ...success } else { setError(r.error); }
 */
export const NETWORK_ERROR = "تعذّر الاتصال بالخادم. تحقّق من الشبكة وأعد المحاولة.";

type Result = { ok: boolean; error?: string };

export function useSubmit() {
  const [pending, setPending] = useState(false);

  async function submit<T extends Result>(
    action: () => Promise<T>,
  ): Promise<T | { ok: false; error: string }> {
    setPending(true);
    try {
      return await action();
    } catch (e) {
      // A thrown request is a network/transport failure, not a validation error — surface a
      // retryable message rather than leaving the user staring at a stuck spinner. Log the real
      // exception so a client-side bug in the action closure isn't silently masked as "network".
      console.error("useSubmit action threw:", e);
      return { ok: false, error: NETWORK_ERROR };
    } finally {
      setPending(false);
    }
  }

  return { pending, submit };
}
