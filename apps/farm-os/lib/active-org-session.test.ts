import { describe, expect, it } from "vitest";
import { activeOrgIdFromAccessToken, activeOrgRepairTarget } from "./active-org-session";

function token(payload: unknown): string {
  return `header.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature`;
}

describe("activeOrgIdFromAccessToken", () => {
  it("reads the active organization from a valid token payload", () => {
    expect(activeOrgIdFromAccessToken(token({ active_org_id: "org-a" }))).toBe("org-a");
  });

  it("fails closed for absent, malformed, or non-text claims", () => {
    expect(activeOrgIdFromAccessToken(undefined)).toBeNull();
    expect(activeOrgIdFromAccessToken("broken")).toBeNull();
    expect(activeOrgIdFromAccessToken(token({}))).toBeNull();
    expect(activeOrgIdFromAccessToken(token({ active_org_id: 42 }))).toBeNull();
  });
});

describe("activeOrgRepairTarget", () => {
  it("keeps a valid claim and repairs missing or stale claims deterministically", () => {
    expect(activeOrgRepairTarget("org-b", ["org-a", "org-b"])).toBeNull();
    expect(activeOrgRepairTarget(null, ["org-a", "org-b"])).toBe("org-a");
    expect(activeOrgRepairTarget("removed-org", ["org-a", "org-b"])).toBe("org-a");
  });

  it("cannot invent an organization when the user has no membership", () => {
    expect(activeOrgRepairTarget(null, [])).toBeNull();
  });
});
