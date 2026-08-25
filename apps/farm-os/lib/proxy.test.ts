import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  client: null as Record<string, unknown> | null,
  cookieMethods: null as {
    setAll: (cookies: Array<{ name: string; value: string; options: Record<string, unknown> }>, headers: Record<string, string>) => void;
  } | null,
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: (_url: string, _key: string, options: { cookies: typeof state.cookieMethods }) => {
    state.cookieMethods = options.cookies;
    return state.client;
  },
}));

import { proxy } from "../proxy";

function token(activeOrgId?: string): string {
  const payload = activeOrgId ? { active_org_id: activeOrgId } : {};
  return `header.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature`;
}

function membershipQuery(orgIds: string[], error: { message: string } | null = null) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    order: vi.fn(() => query),
    limit: vi.fn(async () => ({ data: orgIds.map((org_id) => ({ org_id })), error })),
  };
  return query;
}

function clientFor({
  claim,
  memberships = ["org-a"],
  refreshedClaim = "org-a",
  rpcError = null,
  membershipError = null,
}: {
  claim?: string;
  memberships?: string[];
  refreshedClaim?: string;
  rpcError?: { message: string } | null;
  membershipError?: { message: string } | null;
}) {
  const query = membershipQuery(memberships, membershipError);
  const rpc = vi.fn(async () => ({ data: null, error: rpcError }));
  const refreshSession = vi.fn(async () => {
    state.cookieMethods?.setAll(
      [{ name: "sb-session", value: "rotated", options: { httpOnly: true } }],
      {
        "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
        Expires: "0",
        Pragma: "no-cache",
      },
    );
    return {
      data: { session: { access_token: token(refreshedClaim) } },
      error: null,
    };
  });
  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: "user-a" } } })),
      getSession: vi.fn(async () => ({ data: { session: { access_token: token(claim) } } })),
      refreshSession,
    },
    from: vi.fn(() => query),
    rpc,
  };
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "public-test-key";
  state.cookieMethods = null;
});

describe("active organization repair in Proxy", () => {
  it("repairs a stale claim, propagates the rotated cookie, and disables caching", async () => {
    const client = clientFor({ claim: "removed-org" });
    state.client = client;

    const response = await proxy(new NextRequest("https://ebeidfarm.business/dashboard/owner"));

    expect(client.rpc).toHaveBeenCalledWith("fn_set_active_org", { p_org: "org-a" });
    expect(client.auth.refreshSession).toHaveBeenCalledOnce();
    expect(response.cookies.get("sb-session")?.value).toBe("rotated");
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("repairs a stale claim to the deterministic readable membership", async () => {
    const client = clientFor({ claim: "removed-org", memberships: ["org-a", "org-b"] });
    state.client = client;

    await proxy(new NextRequest("https://ebeidfarm.business/dashboard/owner"));

    expect(client.rpc).toHaveBeenCalledWith("fn_set_active_org", { p_org: "org-a" });
  });

  it("does not write when the role-home claim is already a valid membership", async () => {
    const client = clientFor({ claim: "org-b", memberships: ["org-a", "org-b"], refreshedClaim: "org-b" });
    state.client = client;

    await proxy(new NextRequest("https://ebeidfarm.business/dashboard/owner"));

    expect(client.rpc).not.toHaveBeenCalled();
    expect(client.auth.refreshSession).not.toHaveBeenCalled();
  });

  it("allows the documented membership fallback when the hook omits the optional claim", async () => {
    const client = clientFor({ refreshedClaim: "" });
    state.client = client;
    const response = await proxy(new NextRequest("https://ebeidfarm.business/dashboard/owner", {
      headers: { cookie: "farm-active-org-repair=1" },
    }));

    expect(response.status).toBe(200);
    expect(response.cookies.get("farm-active-org-repair")?.value).toBe("");
    expect(new Date(response.cookies.get("farm-active-org-repair")?.expires ?? 1).getTime()).toBe(0);
    expect(client.rpc).not.toHaveBeenCalled();
    expect(client.auth.refreshSession).not.toHaveBeenCalled();
  });

  it("fails closed when the caller's membership set cannot be read", async () => {
    const client = clientFor({ membershipError: { message: "temporarily unavailable" } });
    state.client = client;

    const response = await proxy(new NextRequest("https://ebeidfarm.business/dashboard/owner"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://ebeidfarm.business/login");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("does not invent an organization for a user with no readable membership", async () => {
    const client = clientFor({ memberships: [] });
    state.client = client;

    await proxy(new NextRequest("https://ebeidfarm.business/dashboard/owner"));

    expect(client.rpc).not.toHaveBeenCalled();
    expect(client.auth.refreshSession).not.toHaveBeenCalled();
  });
});
