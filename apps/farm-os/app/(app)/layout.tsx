import { requireMembership, ROLE_LABEL_AR } from "@/lib/auth";
import { AppChrome } from "@/components/AppChrome";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const m = await requireMembership();
  return (
    <AppChrome role={m.role} roleLabel={ROLE_LABEL_AR[m.role]} name={m.name}>
      {children}
    </AppChrome>
  );
}
