import { describe, expect, it, vi } from "vitest";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

type CookieWrite = { name: string; value: string; options?: CookieOptions };

function base64Url(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

describe("installed Supabase SSR recovery contract", () => {
  it("uses the verified recovery session for updateUser and clears its cookies on global sign-out", async () => {
    const now = Math.floor(Date.now() / 1000);
    const accessToken = [
      base64Url({ alg: "HS256", typ: "JWT" }),
      base64Url({ sub: "00000000-0000-0000-0000-000000000123", aud: "authenticated", exp: now + 3600 }),
      "test-signature",
    ].join(".");
    const user = {
      id: "00000000-0000-0000-0000-000000000123",
      aud: "authenticated",
      role: "authenticated",
      email: "recovery@example.invalid",
      app_metadata: {},
      user_metadata: {},
      identities: [],
      created_at: new Date().toISOString(),
    };
    const requests: Array<{ authorization: string | null; method: string; url: string }> = [];
    const cookieWrites: CookieWrite[][] = [];

    const guardedFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      requests.push({
        authorization: request.headers.get("authorization"),
        method: request.method,
        url: `${url.pathname}${url.search}`,
      });

      if (url.pathname.endsWith("/verify")) {
        return Response.json({
          access_token: accessToken,
          token_type: "bearer",
          expires_in: 3600,
          expires_at: now + 3600,
          refresh_token: "test-refresh-token",
          user,
        });
      }
      if (url.pathname.endsWith("/user")) return Response.json(user);
      if (url.pathname.endsWith("/logout")) return new Response(null, { status: 204 });
      return Response.json({ message: "unexpected request" }, { status: 500 });
    });

    const supabase = createServerClient("https://example.supabase.co", "test-anon-key", {
      global: { fetch: guardedFetch },
      cookies: {
        getAll: () => [],
        setAll: (cookies) => {
          cookieWrites.push(cookies);
        },
      },
    });

    expect(
      (await supabase.auth.verifyOtp({ token_hash: "a".repeat(64), type: "recovery" })).error,
    ).toBeNull();
    expect((await supabase.auth.updateUser({ password: "a unique password 42" })).error).toBeNull();
    expect((await supabase.auth.signOut({ scope: "global" })).error).toBeNull();

    const updateRequest = requests.find((entry) => entry.url.endsWith("/auth/v1/user"));
    expect(updateRequest).toMatchObject({
      authorization: `Bearer ${accessToken}`,
      method: "PUT",
    });
    expect(requests.some((entry) => entry.url.endsWith("/auth/v1/logout?scope=global"))).toBe(true);
    expect(cookieWrites.some((batch) => batch.some((cookie) => cookie.value.length > 0))).toBe(true);
    expect(cookieWrites.at(-1)?.every((cookie) => cookie.value === "")).toBe(true);
  });
});
