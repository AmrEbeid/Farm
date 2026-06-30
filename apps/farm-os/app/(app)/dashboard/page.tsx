import { redirect } from "next/navigation";
import { requireMembership } from "@/lib/auth";

/** Route to the role-appropriate dashboard. */
export default async function DashboardRouter() {
  const m = await requireMembership();
  if (m.role === "owner" || m.role === "accountant") redirect("/dashboard/owner");
  if (m.role === "farm_manager" || m.role === "agri_engineer") redirect("/dashboard/manager");
  if (m.role === "supervisor") redirect("/m");
  if (m.role === "storekeeper") redirect("/inventory/dashboard");
  redirect("/dashboard/manager");
}
