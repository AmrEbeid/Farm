const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);
const REMOTE_ORIGINS = new Set(["https://ebeidfarm.business"]);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const ACCOUNTING_E2E_ENV = {
  baseUrl: "FARM_OS_ACCOUNTING_E2E_BASE_URL",
  allowRemote: "FARM_OS_ALLOW_REMOTE_READONLY_E2E",
  batchId: "FARM_OS_E2E_BATCH_ID",
  ownerEmail: "FARM_OS_E2E_OWNER_EMAIL",
  ownerPassword: "FARM_OS_E2E_OWNER_PASSWORD",
  accountantEmail: "FARM_OS_E2E_ACCOUNTANT_EMAIL",
  accountantPassword: "FARM_OS_E2E_ACCOUNTANT_PASSWORD",
  deniedEmail: "FARM_OS_E2E_DENIED_EMAIL",
  deniedPassword: "FARM_OS_E2E_DENIED_PASSWORD",
} as const;

export type AccountingE2ERole = "owner" | "accountant" | "denied";

export type AccountingE2ECredentials = {
  email: string;
  password: string;
};

type Environment = Readonly<Record<string, string | undefined>>;

function required(env: Environment, key: string): string {
  const value = env[key];
  if (!value?.trim()) throw new Error(`Missing required environment variable ${key}.`);
  return value;
}

export function accountingE2EBaseUrl(env: Environment): string {
  const raw = env[ACCOUNTING_E2E_ENV.baseUrl]?.trim() || "http://127.0.0.1:3100";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${ACCOUNTING_E2E_ENV.baseUrl} must be an absolute HTTP(S) URL.`);
  }

  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error(`${ACCOUNTING_E2E_ENV.baseUrl} must be a credential-free HTTP(S) URL.`);
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`${ACCOUNTING_E2E_ENV.baseUrl} must contain only an origin, without a path or query.`);
  }

  if (LOCAL_HOSTS.has(url.hostname)) {
    if (!url.port) {
      throw new Error(`${ACCOUNTING_E2E_ENV.baseUrl} must include an explicit local port.`);
    }
    return url.origin;
  }
  if (env[ACCOUNTING_E2E_ENV.allowRemote] !== "1") {
    throw new Error(
      `Remote accounting acceptance is disabled. Set ${ACCOUNTING_E2E_ENV.allowRemote}=1 only after approving the read-only target.`,
    );
  }
  if (!REMOTE_ORIGINS.has(url.origin)) {
    throw new Error(`Remote accounting acceptance target is not allowlisted: ${url.origin}.`);
  }
  return url.origin;
}

export function accountingE2EBatchId(env: Environment): string {
  const batchId = required(env, ACCOUNTING_E2E_ENV.batchId).trim();
  if (!UUID.test(batchId)) {
    throw new Error(`${ACCOUNTING_E2E_ENV.batchId} must be a UUID.`);
  }
  return batchId;
}

export function accountingE2ECredentials(
  env: Environment,
  role: AccountingE2ERole,
): AccountingE2ECredentials {
  const keys = {
    owner: [ACCOUNTING_E2E_ENV.ownerEmail, ACCOUNTING_E2E_ENV.ownerPassword],
    accountant: [ACCOUNTING_E2E_ENV.accountantEmail, ACCOUNTING_E2E_ENV.accountantPassword],
    denied: [ACCOUNTING_E2E_ENV.deniedEmail, ACCOUNTING_E2E_ENV.deniedPassword],
  } as const;
  const [emailKey, passwordKey] = keys[role];
  return {
    email: required(env, emailKey).trim(),
    // Passwords are opaque bytes. Validate non-blank above, but never trim or normalize them.
    password: required(env, passwordKey),
  };
}

export function assertDistinctAccountingE2EAccounts(
  credentials: Record<AccountingE2ERole, AccountingE2ECredentials>,
): void {
  const normalized = Object.values(credentials).map(({ email }) => email.trim().toLowerCase());
  if (new Set(normalized).size !== normalized.length) {
    throw new Error("Owner, accountant and denied-role accounting E2E accounts must be distinct.");
  }
}

export function accountingE2ERequestIsReadOnly(method: string): boolean {
  return SAFE_METHODS.has(method.toUpperCase());
}
