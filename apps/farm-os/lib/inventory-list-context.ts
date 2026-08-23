// SPEC-0033 R4a — the inventory list's URL contract, and the ONE way the item 360 gets back to it.
//
// WHY A MODULE. The list is paginated and filtered on the server, so its state lives entirely in the
// URL. Opening a row must not throw that state away, which means the row link has to carry it — and
// the moment a page accepts a destination from a query string, it is one careless `redirect()` away
// from an open redirect. Everything a caller supplies is therefore treated as untrusted text and
// REBUILT from validated parts here; the raw string is never echoed back into a link or a redirect.
//
// The default is always the bare list. An unparseable, foreign, or hostile value is not an error the
// user has to solve — it silently becomes `/inventory`, which is always a legal place to be.

import { INVENTORY_LIST_PAGE_SIZE, parseInventoryListFilter, type InventoryListFilter, type InventoryScope } from "./inventory-snapshot-reads";

export const INVENTORY_LIST_PATH = "/inventory";

/**
 * The deepest page a link may address. The list RPC caps its offset at 1,000,000; this is far below
 * that and keeps a pasted `?page=99999999` from becoming a pointless deep scan.
 */
export const INVENTORY_LIST_MAX_PAGE = 10_000;

/** The longest search text the list accepts, matching the RPC's own bound. */
export const INVENTORY_QUERY_MAX_LENGTH = 60;

/**
 * C0/C1 control characters. Written as escapes so no invisible byte ever lives in this source, and
 * matched on purpose: a control character in a search box is not text, it is an injection attempt.
 */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;

/**
 * Anything that must never appear in a return path: every control character, a literal space, and a
 * backslash (browsers normalise `\` to `/`, so `/\evil.example` would leave the site).
 */
const UNSAFE_PATH_CHARACTERS = /[\u0000-\u0020\u007f\\]/;

export interface InventoryListContext {
  query: string;
  filter: InventoryListFilter;
  page: number;
}

export const EMPTY_INVENTORY_LIST_CONTEXT: InventoryListContext = {
  query: "",
  filter: "all",
  page: 1,
};

/** A page number from a URL. Anything that is not a whole page in range becomes page 1. */
export function parseInventoryPage(raw: string | undefined): number {
  if (typeof raw !== "string" || !/^[1-9]\d{0,6}$/.test(raw)) return 1;
  const page = Number(raw);
  return page > INVENTORY_LIST_MAX_PAGE ? 1 : page;
}

/**
 * Search text from a URL. Trimmed, control characters stripped, and truncated to the RPC's bound so
 * an over-long value narrows the search rather than 22023-ing a page the user just opened.
 */
export function parseInventoryQuery(raw: string | undefined): string {
  if (typeof raw !== "string") return "";
  return raw.replace(CONTROL_CHARACTERS, " ").trim().slice(0, INVENTORY_QUERY_MAX_LENGTH).trim();
}

export function parseInventoryListContext(
  params: { q?: string; filter?: string; page?: string },
  scope: InventoryScope,
): InventoryListContext {
  return {
    query: parseInventoryQuery(params.q),
    filter: parseInventoryListFilter(params.filter, scope),
    page: parseInventoryPage(params.page),
  };
}

/** Rebuild the canonical list URL from validated state. Defaults are omitted so `/inventory` stays clean. */
export function inventoryListHref(context: Partial<InventoryListContext> = {}): string {
  const { query, filter, page } = { ...EMPTY_INVENTORY_LIST_CONTEXT, ...context };
  const search = new URLSearchParams();
  if (query) search.set("q", query);
  if (filter !== "all") search.set("filter", filter);
  if (page > 1) search.set("page", String(page));
  const suffix = search.toString();
  return suffix ? `${INVENTORY_LIST_PATH}?${suffix}` : INVENTORY_LIST_PATH;
}

/** The item 360 link, carrying the list state it was opened from as one internal `from` path. */
export function inventoryItemHref(itemId: string, context: InventoryListContext): string {
  const from = inventoryListHref(context);
  return from === INVENTORY_LIST_PATH
    ? `${INVENTORY_LIST_PATH}/${itemId}`
    : `${INVENTORY_LIST_PATH}/${itemId}?from=${encodeURIComponent(from)}`;
}

/**
 * Validate a `from` value and return a path that is safe to link to or redirect to.
 *
 * The rules are deliberately narrow, and each one closes a real way out of the application:
 *   * it must be a string that starts with a single `/` — no scheme, no `mailto:`, no `javascript:`;
 *   * `//host` and `/\host` are protocol-relative URLs that browsers resolve OFF-SITE, so both are
 *     rejected even though they start with `/`;
 *   * no control characters or whitespace, which is how a filtered scheme gets smuggled back in;
 *   * the path part must be exactly the inventory list — this contract exists to return to that one
 *     page, and accepting any other internal route would make it a general-purpose redirector;
 *   * a fragment is dropped, and only the three known list parameters survive, each re-validated.
 *
 * The returned value is REBUILT from those validated parts. The caller's bytes are never echoed.
 */
export function parseInventoryReturnTo(
  raw: string | undefined,
  scope: InventoryScope,
): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 300) return INVENTORY_LIST_PATH;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return INVENTORY_LIST_PATH;
  if (UNSAFE_PATH_CHARACTERS.test(raw)) return INVENTORY_LIST_PATH;

  const hashAt = raw.indexOf("#");
  const withoutHash = hashAt >= 0 ? raw.slice(0, hashAt) : raw;
  const queryAt = withoutHash.indexOf("?");
  const path = queryAt >= 0 ? withoutHash.slice(0, queryAt) : withoutHash;
  if (path !== INVENTORY_LIST_PATH) return INVENTORY_LIST_PATH;

  const search = new URLSearchParams(queryAt >= 0 ? withoutHash.slice(queryAt + 1) : "");
  return inventoryListHref(parseInventoryListContext(
    {
      q: search.get("q") ?? undefined,
      filter: search.get("filter") ?? undefined,
      page: search.get("page") ?? undefined,
    },
    scope,
  ));
}

export interface InventoryListRequest {
  context: InventoryListContext;
  /** The canonical url to send the caller to, or `null` when the request already IS canonical. */
  redirectTo: string | null;
}

/**
 * Read a list request and decide whether it is already spelled canonically.
 *
 * The list has exactly one url per state. Without this, the same page is reachable under several
 * spellings (`?filter=all`, `?page=1`, `?q=`, a filter the caller's scope may not use, a page number
 * that is not one), each of which would be a different cache key and a different thing to share. The
 * canonical url is REBUILT from the validated context, so a hostile parameter is normalised away
 * rather than echoed back into a redirect target.
 *
 * `requestedHref` is rebuilt with `URLSearchParams` too, not read off the raw url, so an encoding
 * difference (`%20` versus `+`) can never make a canonical request look non-canonical and loop.
 */
export function readInventoryListRequest(
  params: { q?: string; filter?: string; page?: string },
  scope: InventoryScope,
): InventoryListRequest {
  const context = parseInventoryListContext(params, scope);
  const canonical = inventoryListHref(context);
  const requested = new URLSearchParams();
  if (params.q != null) requested.set("q", params.q);
  if (params.filter != null) requested.set("filter", params.filter);
  if (params.page != null) requested.set("page", params.page);
  const suffix = requested.toString();
  const requestedHref = suffix ? `${INVENTORY_LIST_PATH}?${suffix}` : INVENTORY_LIST_PATH;
  return { context, redirectTo: requestedHref === canonical ? null : canonical };
}

/** Zero-based offset for a validated page. */
export function inventoryListOffset(page: number, pageSize = INVENTORY_LIST_PAGE_SIZE): number {
  return (page - 1) * pageSize;
}

/** How many pages an exact matching total needs. Zero matches is still one (empty) page. */
export function inventoryPageCount(matching: string, pageSize = INVENTORY_LIST_PAGE_SIZE): number {
  const total = BigInt(matching);
  const size = BigInt(pageSize);
  const pages = (total + size - BigInt(1)) / size;
  return pages < BigInt(1) ? 1 : Number(pages);
}
