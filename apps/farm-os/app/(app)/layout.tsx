import { requireMembership, getUserOrgs, ROLE_LABEL_AR } from "@/lib/auth";
import { AppChrome } from "@/components/AppChrome";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [m, orgs] = await Promise.all([requireMembership(), getUserOrgs()]);
  return (
    <AppChrome
      role={m.role}
      roleLabel={ROLE_LABEL_AR[m.role]}
      name={m.name}
      orgs={orgs}
      activeOrgId={m.orgId}
    >
      {children}
    </AppChrome>
  );
}
