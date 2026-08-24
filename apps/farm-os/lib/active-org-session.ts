export function activeOrgIdFromAccessToken(token: string | null | undefined): string | null {
  if (!token) return null;
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(Buffer.from(normalized, "base64").toString("utf8")) as {
      active_org_id?: unknown;
    };
    return typeof claims.active_org_id === "string" && claims.active_org_id.length > 0
      ? claims.active_org_id
      : null;
  } catch {
    return null;
  }
}

export function activeOrgRepairTarget(
  claimedOrgId: string | null,
  membershipOrgIds: readonly string[],
): string | null {
  if (claimedOrgId && membershipOrgIds.includes(claimedOrgId)) return null;
  return membershipOrgIds[0] ?? null;
}
