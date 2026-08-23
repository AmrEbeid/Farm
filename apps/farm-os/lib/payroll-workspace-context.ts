// R4b — the payroll workspace's URL contract, and the ONE way the run 360 gets back to it.
//
// WHY A MODULE. The workspace (run history) and a run's own line list are both server-paginated, so
// their state lives entirely in the URL. Opening a run must not throw that state away, which means
// the row link has to carry it — and the moment a page accepts a destination from a query string, it
// is one careless `redirect()` away from an open redirect. Everything a caller supplies is therefore
// treated as untrusted text and REBUILT from validated parts here; the raw string is never echoed back
// into a link or a redirect. Mirrors lib/inventory-list-context.ts exactly, narrowed to payroll's own
// single path and single `page` parameter (no query, no filter — payroll has neither).

export const PAYROLL_WORKSPACE_PATH = "/people/payroll";

/** The deepest page a link may address. Far below the RPC's own 1,000,000 offset ceiling. */
export const PAYROLL_WORKSPACE_MAX_PAGE = 10_000;

/**
 * True for any control character (0x00-0x20, 0x7f) or a backslash (browsers normalise `\` to `/`, so
 * `/\evil.example` would leave the site). Checked by character code, not a regex literal, so no
 * literal control byte ever has to live in this source file.
 */
function hasUnsafePathCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x20 || code === 0x7f || value[index] === "\\") return true;
  }
  return false;
}

export interface PayrollWorkspaceContext {
  page: number;
}

export const EMPTY_PAYROLL_WORKSPACE_CONTEXT: PayrollWorkspaceContext = { page: 1 };

/** A page number from a URL. Anything that is not a whole page in range becomes page 1. */
export function parsePayrollWorkspacePage(raw: string | undefined): number {
  if (typeof raw !== "string" || !/^[1-9]\d{0,6}$/.test(raw)) return 1;
  const page = Number(raw);
  return page > PAYROLL_WORKSPACE_MAX_PAGE ? 1 : page;
}

export function parsePayrollWorkspaceContext(params: { page?: string }): PayrollWorkspaceContext {
  return { page: parsePayrollWorkspacePage(params.page) };
}

/** Rebuild the canonical workspace URL from validated state. Page 1 is omitted so the bare path stays clean. */
export function payrollWorkspaceHref(context: Partial<PayrollWorkspaceContext> = {}): string {
  const { page } = { ...EMPTY_PAYROLL_WORKSPACE_CONTEXT, ...context };
  return page > 1 ? `${PAYROLL_WORKSPACE_PATH}?page=${page}` : PAYROLL_WORKSPACE_PATH;
}

/** The run 360 link, carrying the workspace page it was opened from as one internal `from` path. */
export function payrollRunHref(runId: string, context: PayrollWorkspaceContext): string {
  const from = payrollWorkspaceHref(context);
  return from === PAYROLL_WORKSPACE_PATH
    ? `${PAYROLL_WORKSPACE_PATH}/${runId}`
    : `${PAYROLL_WORKSPACE_PATH}/${runId}?from=${encodeURIComponent(from)}`;
}

/**
 * Validate a `from` value and return a path that is safe to link to or redirect to.
 *
 * The rules mirror `parseInventoryReturnTo` exactly: a single leading `/`, no protocol-relative or
 * backslash-smuggled host, no control characters, the path part restricted to exactly the payroll
 * workspace (accepting one other internal route would make this a general-purpose redirector), and
 * the result REBUILT from validated parts rather than the caller's own bytes.
 */
export function parsePayrollReturnTo(raw: string | undefined): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 300) return PAYROLL_WORKSPACE_PATH;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return PAYROLL_WORKSPACE_PATH;
  if (hasUnsafePathCharacter(raw)) return PAYROLL_WORKSPACE_PATH;

  const hashAt = raw.indexOf("#");
  const withoutHash = hashAt >= 0 ? raw.slice(0, hashAt) : raw;
  const queryAt = withoutHash.indexOf("?");
  const path = queryAt >= 0 ? withoutHash.slice(0, queryAt) : withoutHash;
  if (path !== PAYROLL_WORKSPACE_PATH) return PAYROLL_WORKSPACE_PATH;

  const search = new URLSearchParams(queryAt >= 0 ? withoutHash.slice(queryAt + 1) : "");
  return payrollWorkspaceHref(parsePayrollWorkspaceContext({ page: search.get("page") ?? undefined }));
}

export interface PayrollWorkspaceRequest {
  context: PayrollWorkspaceContext;
  /** The canonical url to send the caller to, or `null` when the request already IS canonical. */
  redirectTo: string | null;
}

/**
 * Read a workspace request and decide whether it is already spelled canonically. Mirrors
 * `readInventoryListRequest`: the canonical url is REBUILT from the validated context (never read off
 * the raw url), and `requestedHref` is rebuilt with `URLSearchParams` too, so an encoding difference
 * can never make a canonical request look non-canonical and loop.
 */
export function readPayrollWorkspaceRequest(params: { page?: string }): PayrollWorkspaceRequest {
  const context = parsePayrollWorkspaceContext(params);
  const canonical = payrollWorkspaceHref(context);
  const requested = new URLSearchParams();
  if (params.page != null) requested.set("page", params.page);
  const suffix = requested.toString();
  const requestedHref = suffix ? `${PAYROLL_WORKSPACE_PATH}?${suffix}` : PAYROLL_WORKSPACE_PATH;
  return { context, redirectTo: requestedHref === canonical ? null : canonical };
}

/** Zero-based offset for a validated page. */
export function payrollWorkspaceOffset(page: number, pageSize: number): number {
  return (page - 1) * pageSize;
}

/** How many pages an exact total needs. Zero matches is still one (empty) page. Exact in BigInt space. */
export function payrollPageCount(exactTotal: string, pageSize: number): number {
  const total = BigInt(exactTotal);
  const size = BigInt(pageSize);
  const pages = (total + size - BigInt(1)) / size;
  return pages < BigInt(1) ? 1 : Number(pages);
}

// ── the run 360's own bounded line list — a second, independent page number on the SAME route ────
//
// A run's frozen lines are a real limit/offset page too (fn_payroll_run_snapshot), so they need their
// own page parameter distinct from the workspace's — `lines` rather than `page`, so a `?from=` return
// path built by the workspace can never collide with a run's own line-page state.

const RUN_LINES_PARAM = "lines";

export function parsePayrollRunLinePage(raw: string | undefined): number {
  return parsePayrollWorkspacePage(raw);
}

/** Rebuild the canonical url for one run's own line page, given the run's id and the `from` it carries. */
export function payrollRunLineHref(runId: string, page: number, from: string | null): string {
  const search = new URLSearchParams();
  if (page > 1) search.set(RUN_LINES_PARAM, String(page));
  if (from && from !== PAYROLL_WORKSPACE_PATH) search.set("from", from);
  const suffix = search.toString();
  const base = `${PAYROLL_WORKSPACE_PATH}/${runId}`;
  return suffix ? `${base}?${suffix}` : base;
}

export interface PayrollRunLineRequest {
  page: number;
  /** The validated internal path to return to. Never the caller's own bytes. */
  from: string;
  /** The canonical url to send the caller to, or `null` when the request already IS canonical. */
  redirectTo: string | null;
}

/** Canonicalize a run's own `?lines=` page number, the same way the workspace canonicalizes `?page=`. */
export function readPayrollRunLineRequest(
  runId: string,
  params: { lines?: string; from?: string },
): PayrollRunLineRequest {
  const from = parsePayrollReturnTo(params.from);
  const page = parsePayrollRunLinePage(params.lines);
  const canonical = payrollRunLineHref(runId, page, from);
  const requested = new URLSearchParams();
  if (params.lines != null) requested.set(RUN_LINES_PARAM, params.lines);
  if (params.from != null) requested.set("from", params.from);
  const suffix = requested.toString();
  const requestedHref = suffix ? `${PAYROLL_WORKSPACE_PATH}/${runId}?${suffix}` : `${PAYROLL_WORKSPACE_PATH}/${runId}`;
  return { page, from, redirectTo: requestedHref === canonical ? null : canonical };
}
