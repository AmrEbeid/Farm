import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types.ext";

export const DATA_AUTHORITY_DOMAINS = [
  "finance_ledger",
  "palm_registry",
  "offshoots",
  "budgets",
  "payroll",
  "inventory",
  "operations",
] as const;

export type DataAuthorityDomain = (typeof DATA_AUTHORITY_DOMAINS)[number];
export type DataAuthorityLevel = "verified" | "partial" | "unverified" | "blocked";

export interface DataAuthority {
  domain: DataAuthorityDomain;
  status: DataAuthorityLevel;
  sourceLabel: string | null;
  recordCount: number | null;
  notes: string | null;
}

export function isAuthoritative(status: DataAuthorityLevel | null | undefined): boolean {
  return status === "verified";
}

export function failClosedAuthority(domain: DataAuthorityDomain): DataAuthority {
  return { domain, status: "unverified", sourceLabel: null, recordCount: null, notes: null };
}

export async function getDataAuthority(
  sb: SupabaseClient<Database>,
  orgId: string,
  domain: DataAuthorityDomain,
): Promise<DataAuthority> {
  const { data, error } = await sb
    .from("data_authority_status")
    .select("domain, status, source_label, record_count, notes")
    .eq("org_id", orgId)
    .eq("domain", domain)
    .maybeSingle();

  if (error || !data) return failClosedAuthority(domain);
  return {
    domain,
    status: data.status,
    sourceLabel: data.source_label,
    recordCount: data.record_count == null ? null : Number(data.record_count),
    notes: data.notes,
  };
}

export const DATA_NOT_VERIFIED_AR =
  "هذه البيانات غير موثقة من مصدر معتمد بعد، لذلك حُجبت الأرقام والتصدير حتى اكتمال المراجعة.";
