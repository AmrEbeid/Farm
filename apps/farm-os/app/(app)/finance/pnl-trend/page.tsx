import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { legacyPnlTrendRedirectHref } from "@/lib/finance report routing";

export default async function LegacyPnlTrendPage({
  searchParams,
}: {
  searchParams: Promise<{ grain?: string | string[] }>;
}) {
  await requireRole(["owner", "accountant"]);
  const { grain } = await searchParams;
  redirect(legacyPnlTrendRedirectHref(grain));
}
