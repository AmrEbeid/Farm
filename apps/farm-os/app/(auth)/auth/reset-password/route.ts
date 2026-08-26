import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 128;
const MAX_REQUEST_BYTES = 4096;

function refusal() {
  return NextResponse.json({ ok: false }, { status: 400 });
}

export async function POST(request: NextRequest) {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim();
  if (contentType !== "application/json") return refusal();

  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) return refusal();
    const body: unknown = JSON.parse(rawBody);
    if (!body || typeof body !== "object") return refusal();

    const tokenHash = "tokenHash" in body ? body.tokenHash : null;
    const password = "password" in body ? body.password : null;
    if (
      typeof tokenHash !== "string" ||
      tokenHash.length < 20 ||
      tokenHash.length > 512 ||
      typeof password !== "string" ||
      password.length < MIN_PASSWORD_LENGTH ||
      password.length > MAX_PASSWORD_LENGTH
    ) {
      return refusal();
    }

    const supabase = await createClient();
    const { error: verifyError } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: "recovery",
    });
    if (verifyError) return refusal();

    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) return refusal();

    // Recovery may follow account compromise, so revoke refresh-token sessions on all devices.
    const { error: signOutError } = await supabase.auth.signOut({ scope: "global" });
    if (signOutError) {
      // Best-effort local cleanup; report the already-changed password separately from revocation.
      await supabase.auth.signOut({ scope: "local" });
      return NextResponse.json({ ok: false, passwordChanged: true }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return refusal();
  }
}
