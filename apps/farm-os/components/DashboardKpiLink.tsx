import type { ReactNode } from "react";
import Link from "next/link";

export function DashboardKpiLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className="block rounded-md outline-offset-2"
      style={{
        boxShadow: active ? "0 0 0 2px var(--brand)" : undefined,
      }}
    >
      {children}
    </Link>
  );
}
