import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const auth = vi.hoisted(() => ({
  verifyOtp: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
}));
const createClient = vi.hoisted(() => vi.fn(async () => ({ auth })));

vi.mock("@/lib/supabase/server", () => ({ createClient }));

import { POST } from "@/app/auth/reset-password/route";

const validBody = {
  tokenHash: ["0123456789abcdef", "0123456789abcdef"].join(""),
  password: "a unique password 42",
};

function request(body: unknown, contentType = "application/json") {
  return new NextRequest("http://localhost/auth/reset-password", {
    method: "POST",
    headers: { "Content-Type": contentType },
    body: JSON.stringify(body),
  });
}

describe("password recovery route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.verifyOtp.mockResolvedValue({ error: null });
    auth.updateUser.mockResolvedValue({ error: null });
    auth.signOut.mockResolvedValue({ error: null });
  });

  it("verifies the one-time recovery token before changing the password", async () => {
    const response = await POST(request(validBody));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(auth.verifyOtp).toHaveBeenCalledWith({
      token_hash: validBody.tokenHash,
      type: "recovery",
    });
    expect(auth.updateUser).toHaveBeenCalledWith({ password: validBody.password });
    expect(auth.verifyOtp.mock.invocationCallOrder[0]).toBeLessThan(
      auth.updateUser.mock.invocationCallOrder[0],
    );
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "global" });
  });

  it("rejects a normal session request without a recovery token before creating a client", async () => {
    const response = await POST(request({ password: validBody.password }));

    expect(response.status).toBe(400);
    expect(createClient).not.toHaveBeenCalled();
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("does not change the password when token verification fails", async () => {
    auth.verifyOtp.mockResolvedValue({ error: new Error("expired") });

    const response = await POST(request(validBody));

    expect(response.status).toBe(400);
    expect(auth.updateUser).not.toHaveBeenCalled();
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it("fails closed on provider exceptions", async () => {
    auth.verifyOtp.mockRejectedValue(new Error("network"));

    const response = await POST(request(validBody, "application/json; charset=utf-8"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false });
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("reports password-changed partial success when global revocation fails", async () => {
    auth.signOut
      .mockResolvedValueOnce({ error: new Error("revocation failed") })
      .mockResolvedValueOnce({ error: null });

    const response = await POST(request(validBody));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, passwordChanged: true });
    expect(auth.signOut).toHaveBeenNthCalledWith(1, { scope: "global" });
    expect(auth.signOut).toHaveBeenNthCalledWith(2, { scope: "local" });
  });

  it("rejects oversized or non-JSON requests", async () => {
    const oversized = { ...validBody, tokenHash: "x".repeat(5000) };
    expect((await POST(request(oversized))).status).toBe(400);
    expect((await POST(request(validBody, "text/plain"))).status).toBe(400);
    expect(createClient).not.toHaveBeenCalled();
  });
});
