import { requireRole } from "@/lib/auth";
import { AgronomistHome } from "./agronomist-home";
import { ManagerHome } from "./manager-home";

// SPEC-0033 R3c/R3d: this route is now a pure role router over two bounded, role-exact snapshots.
// The agronomist is routed first, then the farm manager; a wrong role typing the URL is bounced by
// requireRole before either snapshot is read. The legacy unbounded multi-table dashboard that served
// the agronomist is removed — every number it rendered now comes from fn_agronomist_home_snapshot.
export default async function ManagerDashboard() {
  const m = await requireRole(["farm_manager", "agri_engineer"]);
  if (m.role === "agri_engineer") return <AgronomistHome orgId={m.orgId} />;
  return <ManagerHome orgId={m.orgId} />;
}
