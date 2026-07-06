import { type NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

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
    const supabase = createServerClient(
      url,
      key,
      {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet: CookieToSet[]) => {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

    await supabase.auth.getUser();
  } catch {
    // session refresh failed — serve the request anyway (auth enforced per-route)
  }
  return response;
}

export const config = {
  matcher: [
    // Run on all routes except static assets and the dev seed-auth endpoint.
    "/((?!_next/static|_next/image|favicon.ico|api/dev|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
