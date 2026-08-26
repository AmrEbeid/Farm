import { requireMembership, getUserOrgs, ROLE_LABEL_AR } from "@/lib/auth";
import { AppChrome } from "@/components/AppChrome";
import {
  RootDocument,
  ROOT_METADATA,
  ROOT_VIEWPORT,
} from "@/app/root-document";

export const metadata = ROOT_METADATA;
export const viewport = ROOT_VIEWPORT;

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [m, orgs] = await Promise.all([requireMembership(), getUserOrgs()]);
  return (
    <RootDocument lang="ar" dir="rtl">
      <AppChrome
        role={m.role}
        roleLabel={ROLE_LABEL_AR[m.role]}
        name={m.name}
        orgs={orgs}
        activeOrgId={m.orgId}
      >
        {children}
      </AppChrome>
    </RootDocument>
  );
}
