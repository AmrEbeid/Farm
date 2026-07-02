import type { ReactNode } from "react";

/**
 * Bidi-isolated inline wrapper for LTR technical strings — purchase-request codes ("PR-2024-001"),
 * phone numbers ("+20…"), reference IDs — rendered inside the app's RTL layout (F4).
 *
 * Without isolation, a mixed run like "طلب شراء PR-2024-001" or a phone next to Arabic text visually
 * reorders (the digits/hyphens jump), because the neutral characters inherit the surrounding RTL
 * direction. `<bdi dir="ltr">` pins the run left-to-right and isolates it from its neighbours.
 *
 * Pure markup (no hooks/context), so it is safe to render directly in Server Components.
 */
export function Code({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <bdi dir="ltr" className={className}>
      {children}
    </bdi>
  );
}
