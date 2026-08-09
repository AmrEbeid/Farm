const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const FARM_PRODUCTION_SUPABASE_ORIGIN =
  "https://veezkmytervjnpxcrbkw.supabase.co";

export const ACCOUNTING_E2E_ENV = {
  baseUrl: "FARM_OS_ACCOUNTING_E2E_BASE_URL",
  authOrigin: "FARM_OS_ACCOUNTING_E2E_AUTH_ORIGIN",
  productionAckPath: "FARM_OS_ACCOUNTING_E2E_PRODUCTION_ACK_PATH",
  batchId: "FARM_OS_E2E_BATCH_ID",
  ownerEmail: "FARM_OS_E2E_OWNER_EMAIL",
  ownerPassword: "FARM_OS_E2E_OWNER_PASSWORD",
  accountantEmail: "FARM_OS_E2E_ACCOUNTANT_EMAIL",
  accountantPassword: "FARM_OS_E2E_ACCOUNTANT_PASSWORD",
  deniedEmail: "FARM_OS_E2E_DENIED_EMAIL",
  deniedPassword: "FARM_OS_E2E_DENIED_PASSWORD",
  deniedRole: "FARM_OS_E2E_DENIED_ROLE",
} as const;

export const ACCOUNTING_E2E_SERVER_READ_ONLY_ENV =
  "FARM_OS_ACCOUNTING_E2E_SERVER_READ_ONLY";

export const ACCOUNTING_E2E_BROWSER_RUNTIME_ERROR = {
  page: "pageerror",
  console: "console:error",
} as const;

export type AccountingE2EBrowserRuntimeError =
  (typeof ACCOUNTING_E2E_BROWSER_RUNTIME_ERROR)[keyof typeof ACCOUNTING_E2E_BROWSER_RUNTIME_ERROR];

export type AccountingE2EWidthSnapshot = {
  viewport: number;
  document: number;
  body: number;
  shellMain: { client: number; scroll: number } | null;
};

export function accountingE2EWidthSnapshotFits(
  widths: AccountingE2EWidthSnapshot,
): boolean {
  if (widths.viewport <= 0) return false;
  if (Math.max(widths.document, widths.body) > widths.viewport) return false;
  return (
    widths.shellMain === null ||
    (widths.shellMain.client > 0 && widths.shellMain.scroll <= widths.shellMain.client)
  );
}

export function recordAccountingE2EBrowserRuntimeError(
  errors: AccountingE2EBrowserRuntimeError[],
  category: unknown,
): void {
  if (
    category !== ACCOUNTING_E2E_BROWSER_RUNTIME_ERROR.page &&
    category !== ACCOUNTING_E2E_BROWSER_RUNTIME_ERROR.console
  ) {
    throw new Error("Unsupported browser runtime error category.");
  }
  errors.push(category);
}

const ACCOUNTING_READ_RPC_NAMES = new Set([
  "fn_accounting_balance_sheet",
  "fn_accounting_income_statement",
  "fn_accounting_trial_balance",
  "fn_accounting_ledger_snapshot",
  "fn_transactions_snapshot",
  "fn_budget_vs_actual",
  "fn_cost_center_direct_summary",
  "fn_cost_center_history_summary",
  "fn_cost_center_reports_snapshot",
  "fn_cost_center_revenue_summary",
  "fn_custody_balance",
  "fn_custody_cash_expense_report",
  "fn_custody_ledger_report",
  "fn_expense_register_summary",
  "fn_expense_daily_snapshot",
  "fn_expense_detail_snapshot",
  "fn_month_close_summary",
  "fn_owner_funding_report",
  "fn_owner_pnl_summary",
  "fn_open_sale_receivables",
  "fn_payment_request_totals",
  "fn_payment_request_detail_snapshot",
  "fn_pending_sale_pricing",
  "fn_pnl_timeseries",
  "fn_reconciliation_acceptance_snapshot",
  "fn_reconciliation_queue_page",
  "fn_revenue_sales_report",
  "fn_revenue_sales_report_exact",
  "fn_season_dashboard_snapshot",
  "fn_custody_reports_snapshot",
  "fn_finance_dashboard_snapshot",
  "fn_custody_daily_snapshot",
  "fn_unpaid_obligations_report",
]);

export type AccountingE2ERole = "owner" | "accountant" | "denied";
export type AccountingE2EDeniedRole =
  | "farm_manager"
  | "agri_engineer"
  | "supervisor"
  | "storekeeper";

export type AccountingE2ECredentials = {
  email: string;
  password: string;
};

type Environment = Readonly<Record<string, string | undefined>>;

function required(env: Environment, key: string): string {
  const value = env[key];
  if (!value?.trim())
    throw new Error(`Missing required environment variable ${key}.`);
  return value;
}

export function accountingE2EBaseUrl(env: Environment): string {
  const raw =
    env[ACCOUNTING_E2E_ENV.baseUrl]?.trim() || "http://127.0.0.1:3100";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(
      `${ACCOUNTING_E2E_ENV.baseUrl} must be an absolute HTTP(S) URL.`
    );
  }

  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new Error(
      `${ACCOUNTING_E2E_ENV.baseUrl} must be a credential-free HTTP(S) URL.`
    );
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error(
      `${ACCOUNTING_E2E_ENV.baseUrl} must contain only an origin, without a path or query.`
    );
  }

  if (LOCAL_HOSTS.has(url.hostname)) {
    if (!url.port) {
      throw new Error(
        `${ACCOUNTING_E2E_ENV.baseUrl} must include an explicit local port.`
      );
    }
    return url.origin;
  }
  throw new Error(
    `${ACCOUNTING_E2E_ENV.baseUrl} must use localhost with an explicit port.`
  );
}

export function accountingE2EBatchId(env: Environment): string {
  const batchId = required(env, ACCOUNTING_E2E_ENV.batchId).trim();
  if (!UUID.test(batchId)) {
    throw new Error(`${ACCOUNTING_E2E_ENV.batchId} must be a UUID.`);
  }
  return batchId;
}

export function accountingE2EAuthOrigin(env: Environment): string {
  const raw = required(env, ACCOUNTING_E2E_ENV.authOrigin).trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(
      `${ACCOUNTING_E2E_ENV.authOrigin} must be an absolute HTTP(S) origin.`
    );
  }
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      `${ACCOUNTING_E2E_ENV.authOrigin} must contain only a credential-free origin.`
    );
  }
  const local =
    LOCAL_HOSTS.has(url.hostname) &&
    url.protocol === "http:" &&
    Boolean(url.port);
  const hosted =
    url.protocol === "https:" && url.hostname.endsWith(".supabase.co");
  if (!local && !hosted) {
    throw new Error(
      `${ACCOUNTING_E2E_ENV.authOrigin} must be an HTTPS Supabase origin or an explicit local HTTP origin.`
    );
  }
  return url.origin;
}

export function accountingE2ESupabaseOrigin(
  env: Environment,
  productionReadAcknowledged = false
): string {
  const raw = required(env, "NEXT_PUBLIC_SUPABASE_URL").trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL must be an absolute HTTP(S) origin."
    );
  }
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL must contain only a credential-free origin."
    );
  }
  const origin = url.origin;
  const authOrigin = accountingE2EAuthOrigin(env);
  if (origin !== authOrigin) {
    throw new Error(
      `NEXT_PUBLIC_SUPABASE_URL must match ${ACCOUNTING_E2E_ENV.authOrigin} exactly.`
    );
  }
  if (
    origin === FARM_PRODUCTION_SUPABASE_ORIGIN &&
    !productionReadAcknowledged
  ) {
    throw new Error(
      "Farm production reads are disabled. Use the one-shot Owner-approved production flag on the accounting E2E wrapper."
    );
  }
  return origin;
}

export function accountingE2ECredentials(
  env: Environment,
  role: AccountingE2ERole
): AccountingE2ECredentials {
  const keys = {
    owner: [ACCOUNTING_E2E_ENV.ownerEmail, ACCOUNTING_E2E_ENV.ownerPassword],
    accountant: [
      ACCOUNTING_E2E_ENV.accountantEmail,
      ACCOUNTING_E2E_ENV.accountantPassword,
    ],
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
  credentials: Record<AccountingE2ERole, AccountingE2ECredentials>
): void {
  const normalized = Object.values(credentials).map(({ email }) =>
    email.trim().toLowerCase()
  );
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(
      "Owner, accountant and denied-role accounting E2E accounts must be distinct."
    );
  }
}

export function assertAccountingE2EInputs(
  env: Environment,
  productionReadAcknowledged = false
): void {
  accountingE2EBatchId(env);
  accountingE2ESupabaseOrigin(env, productionReadAcknowledged);
  accountingE2EDeniedRole(env);
  assertDistinctAccountingE2EAccounts({
    owner: accountingE2ECredentials(env, "owner"),
    accountant: accountingE2ECredentials(env, "accountant"),
    denied: accountingE2ECredentials(env, "denied"),
  });
}

export function accountingE2EDeniedRole(
  env: Environment
): AccountingE2EDeniedRole {
  const role = required(env, ACCOUNTING_E2E_ENV.deniedRole).trim();
  const deniedRoles: AccountingE2EDeniedRole[] = [
    "farm_manager",
    "agri_engineer",
    "supervisor",
    "storekeeper",
  ];
  if (!deniedRoles.includes(role as AccountingE2EDeniedRole)) {
    throw new Error(
      `${ACCOUNTING_E2E_ENV.deniedRole} must name a non-finance Farm role.`
    );
  }
  return role as AccountingE2EDeniedRole;
}

export function accountingE2ERequestIsReadOnly(
  method: string,
  rawUrl: string,
  allowedOrigins: readonly string[]
): boolean {
  if (!SAFE_METHODS.has(method.toUpperCase())) return false;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  return !url.username && !url.password && allowedOrigins.includes(url.origin);
}

export function accountingE2ERequestIsPasswordSignIn(
  method: string,
  rawUrl: string,
  authOrigin: string
): boolean {
  if (method.toUpperCase() !== "POST") return false;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  return (
    url.origin === authOrigin &&
    url.pathname === "/auth/v1/token" &&
    url.searchParams.get("grant_type") === "password" &&
    [...url.searchParams.keys()].length === 1
  );
}

export type AccountingE2ERequestDecision =
  | "read-only"
  | "password-login"
  | "blocked";

export function createAccountingE2ERequestPolicy(
  appOrigin: string,
  authOrigin: string
): (method: string, rawUrl: string) => AccountingE2ERequestDecision {
  let passwordLoginAvailable = true;
  const allowedOrigins = [appOrigin, authOrigin];

  return (method, rawUrl) => {
    if (accountingE2ERequestIsReadOnly(method, rawUrl, allowedOrigins))
      return "read-only";
    if (
      passwordLoginAvailable &&
      accountingE2ERequestIsPasswordSignIn(method, rawUrl, authOrigin)
    ) {
      passwordLoginAvailable = false;
      return "password-login";
    }
    return "blocked";
  };
}

export function accountingE2EServerRequestIsReadOnly(
  method: string,
  rawUrl: string,
  supabaseOrigin: string
): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.origin !== supabaseOrigin || url.username || url.password)
    return false;
  const normalizedMethod = method.toUpperCase();
  if (SAFE_METHODS.has(normalizedMethod)) return true;
  if (normalizedMethod !== "POST" || url.search || url.hash) return false;
  const prefix = "/rest/v1/rpc/";
  if (!url.pathname.startsWith(prefix)) return false;
  const rpcName = decodeURIComponent(url.pathname.slice(prefix.length));
  return !rpcName.includes("/") && ACCOUNTING_READ_RPC_NAMES.has(rpcName);
}

export function accountingE2EGuardedServerFetch(
  supabaseOrigin: string,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch
): typeof globalThis.fetch {
  return async (input, init) => {
    const request = input instanceof Request ? input : null;
    const method = init?.method ?? request?.method ?? "GET";
    const url = request?.url ?? String(input);
    if (!accountingE2EServerRequestIsReadOnly(method, url, supabaseOrigin)) {
      const pathname = (() => {
        try {
          return new URL(url).pathname;
        } catch {
          return "[invalid-url]";
        }
      })();
      throw new Error(
        `Accounting read-only E2E blocked server-side ${method.toUpperCase()} ${pathname}`
      );
    }
    return fetchImpl(input, init);
  };
}

export function accountingE2ESanitizedChildEnvironment(
  env: Environment
): Record<string, string> {
  const allowed = new Set([
    "HOME",
    "LANG",
    "LC_ALL",
    "NODE_ENV",
    "PATH",
    "SHELL",
    "TMPDIR",
    "TZ",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  ]);
  // Playwright merges webServer.env over process.env, so every non-allowlisted parent key must be
  // explicitly blanked. This keeps service-role/database/cloud credentials out of the local child.
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    sanitized[key] = allowed.has(key) && value !== undefined ? value : "";
  }
  for (const key of Object.values(ACCOUNTING_E2E_ENV)) sanitized[key] = "";
  return sanitized;
}
