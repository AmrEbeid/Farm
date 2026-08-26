import { type NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import {
  ACCOUNTING_E2E_SERVER_READ_ONLY_ENV,
  accountingE2EGuardedServerFetch,
} from "@/lib/accounting e2e safety";
import {
  activeOrgIdFromAccessToken,
  activeOrgRepairTarget,
} from "@/lib/active-org-session";

type CookieToSet = { name: string; value: string; options?: CookieOptions };
const REPAIR_COOKIE = "farm-active-org-repair";
const AUTH_SURFACE_PATHS = new Set([
  "/login",
  "/forgot-password",
  "/reset-password",
  "/auth/reset-password",
]);
const ROLE_HOME_PATHS = new Set([
  "/dashboard/owner",
  "/finance/dashboard",
  "/dashboard/manager",
  "/m",
  "/inventory/dashboard",
]);

function sessionErrorRedirect(request: NextRequest, response: NextResponse): NextResponse {
  const redirect = NextResponse.redirect(new URL("/login", request.url));
  for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
  redirect.cookies.set(REPAIR_COOKIE, "1", {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: 300,
  });
  redirect.headers.set("Cache-Control", "private, no-cache, no-store, must-revalidate, max-age=0");
  redirect.headers.set("Expires", "0");
  redirect.headers.set("Pragma", "no-cache");
  return redirect;
}

/**
 * Refreshes the Supabase auth session on every request and writes refreshed
 * cookies back onto the response, so Server Components always see a valid
 * session. (Server Components cannot set cookies themselves.)
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  // Resilience: never let a session-refresh hiccup 500 the whole site. If the Supabase
  // env is missing or the auth call throws, fall through and serve the request (pages
  // still enforce auth via requireMembership). Prevents MIDDLEWARE_INVOCATION_FAILED.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;

  try {
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet: CookieToSet[], headersToSet: Record<string, string>) => {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
          Object.entries(headersToSet).forEach(([name, value]) =>
            response.headers.set(name, value),
          );
        },
      },
      ...(process.env[ACCOUNTING_E2E_SERVER_READ_ONLY_ENV] === "1"
        ? { global: { fetch: accountingE2EGuardedServerFetch(new URL(url).origin) } }
        : {}),
    });

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      // Authentication and recovery screens must not depend on organization membership.
      if (AUTH_SURFACE_PATHS.has(request.nextUrl.pathname)) return response;

      const {
        data: { session },
      } = await supabase.auth.getSession();

      const claimedOrgId = activeOrgIdFromAccessToken(session?.access_token);
      const shouldVerifyMembership = !claimedOrgId || ROLE_HOME_PATHS.has(request.nextUrl.pathname);

      if (shouldVerifyMembership) {
        const { data: memberships, error: membershipsError } = await supabase
          .from("organization_member")
          .select("org_id")
          .eq("user_id", user.id)
          .order("created_at", { ascending: true })
          .limit(100);
        if (membershipsError) return sessionErrorRedirect(request, response);
        const membershipOrgIds = (memberships ?? []).map(({ org_id }) => org_id);
        // A missing claim is the supported legacy state while the custom access-token hook is
        // disabled: RLS falls back to the caller's full membership set and auth.ts chooses the
        // deterministic oldest membership. Only repair a claim that exists but is stale. Treating
        // an absent optional claim as a repair failure creates a login redirect loop in production.
        const repairTarget = claimedOrgId
          ? activeOrgRepairTarget(claimedOrgId, membershipOrgIds)
          : null;

        if (repairTarget) {
          if (request.cookies.get(REPAIR_COOKIE)) {
            return sessionErrorRedirect(request, response);
          }
          const { error: activeOrgError } = await supabase.rpc("fn_set_active_org", {
            p_org: repairTarget,
          });
          if (activeOrgError) return sessionErrorRedirect(request, response);

          const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
          const refreshedOrgId = activeOrgIdFromAccessToken(refreshed.session?.access_token);
          if (refreshError || refreshedOrgId !== repairTarget) {
            return sessionErrorRedirect(request, response);
          }
        } else if (request.cookies.get(REPAIR_COOKIE)) {
          request.cookies.delete(REPAIR_COOKIE);
          response.cookies.delete(REPAIR_COOKIE);
        }
      }
    }
  } catch {
    // session refresh failed — serve the request anyway (auth enforced per-route)
  }
  return response;
}

export const config = {
  matcher: [
    // Run on all routes except static assets.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
