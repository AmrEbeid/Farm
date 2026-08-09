import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { legacyPnlRedirectHref } from "@/lib/finance report routing";

export default async function LegacyOwnerPnlPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string | string[]; to?: string | string[] }>;
}) {
  await requireRole(["owner", "accountant"]);
  redirect(legacyPnlRedirectHref(await searchParams));
}
