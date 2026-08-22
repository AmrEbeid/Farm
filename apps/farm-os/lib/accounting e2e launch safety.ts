import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import {
  ACCOUNTING_E2E_ENV,
  FARM_PRODUCTION_SUPABASE_ORIGIN,
} from "./accounting e2e safety";

const ACK_DIRECTORY_PREFIX = "farm-accounting-e2e-";
const ACK_FILENAME = "production-read-ack.json";
const ACK_MAX_AGE_MS = 30_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Environment = Readonly<Record<string, string | undefined>>;

export const ACCOUNTING_E2E_NEXT_ENV_FILES = [
  ".env.production.local",
  ".env.local",
  ".env.production",
  ".env",
] as const;

export function assertNoAccountingE2ENextEnvironmentFiles(projectDirectory: string): void {
  const found = ACCOUNTING_E2E_NEXT_ENV_FILES.filter((name) =>
    existsSync(join(projectDirectory, name)),
  );
  if (found.length > 0) {
    throw new Error(
      `Accounting read-only E2E refuses Next environment files: ${found.join(", ")}. Supply the approved public target through the invocation environment.`,
    );
  }
}
export function consumeAccountingE2EProductionAcknowledgement(
  env: Environment,
  now = Date.now(),
): boolean {
  const rawPath = env[ACCOUNTING_E2E_ENV.productionAckPath]?.trim();
  if (!rawPath) return false;

  const ackPath = resolve(rawPath);
  const ackDirectory = dirname(ackPath);
  const realTempDirectory = realpathSync(tmpdir());
  if (
    basename(ackPath) !== ACK_FILENAME ||
    dirname(ackDirectory) !== realTempDirectory ||
    !basename(ackDirectory).startsWith(ACK_DIRECTORY_PREFIX)
  ) {
    throw new Error("Invalid accounting production acknowledgement path.");
  }

  const stat = lstatSync(ackPath);
  const currentUid = typeof process.getuid === "function" ? process.getuid() : null;
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    (currentUid !== null && stat.uid !== currentUid) ||
    (stat.mode & 0o077) !== 0
  ) {
    throw new Error("Accounting production acknowledgement must be a private, owned regular file.");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(readFileSync(ackPath, "utf8"));
  } finally {
    unlinkSync(ackPath);
  }

  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid accounting production acknowledgement payload.");
  }
  const ack = payload as Record<string, unknown>;
  if (
    ack.origin !== FARM_PRODUCTION_SUPABASE_ORIGIN ||
    typeof ack.createdAt !== "number" ||
    !Number.isSafeInteger(ack.createdAt) ||
    ack.createdAt > now + 5_000 ||
    now - ack.createdAt > ACK_MAX_AGE_MS ||
    typeof ack.nonce !== "string" ||
    !UUID.test(ack.nonce)
  ) {
    throw new Error("Invalid or expired accounting production acknowledgement.");
  }
  return true;
}
