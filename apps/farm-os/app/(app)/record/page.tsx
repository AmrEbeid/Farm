import { requireMembership } from "@/lib/auth";
import { RecordLauncher } from "./RecordLauncher";

export default async function RecordLauncherPage() {
  const membership = await requireMembership();
  return <RecordLauncher role={membership.role} />;
}
