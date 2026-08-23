// SPEC-0033 R4c — the people directory's URL contract, and the ONE way the person 360 gets back to
// it.
//
// WHY A MODULE. The directory is searched, filtered and paginated on the SERVER now, so its state
// lives entirely in the URL. Opening a colleague must not throw that state away, which means the row
// link has to carry it — and the moment a page accepts a destination from a query string, it is one
// careless `redirect()` away from an open redirect. Everything a caller supplies is therefore
// treated as untrusted text and REBUILT from validated parts here; the raw string is never echoed
// back into a link or a redirect.
//
// The default is always the bare directory. An unparseable, foreign or hostile value is not an error
// the user has to solve — it silently becomes `/people`, which is always a legal place to be.
//
// Mirrors lib/inventory-list-context.ts and lib/payroll-workspace-context.ts, so the three list →
// 360 pairs in the product answer a hostile `?from=` exactly the same way.

import {
  PEOPLE_DIRECTORY_PAGE_SIZE,
  parsePeopleDirectoryFilter,
  type PeopleDirectoryFilter,
} from "./people-snapshot-reads";

export const PEOPLE_DIRECTORY_PATH = "/people";

/**
 * The deepest page a link may address. The directory RPC caps its offset at 1,000,000; this is far
 * below that and keeps a pasted `?page=99999999` from becoming a pointless deep scan.
 */
export const PEOPLE_DIRECTORY_MAX_PAGE = 10_000;

/** The longest search text the directory accepts, matching the RPC's own bound. */
export const PEOPLE_QUERY_MAX_LENGTH = 60;

/**
 * True for any C0/C1 control character. Checked by character code rather than with a regex literal,
 * so no invisible byte ever has to live in this source file — a control character in a search box is
 * not text, it is an injection attempt, and it is replaced with a space before the value is trimmed.
 */
function isControlCharacter(code: number): boolean {
  return code <= 0x1f || code === 0x7f;
}

/**
 * True for anything that must never appear in a return path: every control character, a literal
 * space, and a backslash (browsers normalise `\` to `/`, so `/\evil.example` would leave the site).
 */
function hasUnsafePathCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x20 || code === 0x7f || value[index] === "\\") return true;
  }
  return false;
}

export interface PeopleDirectoryContext {
  query: string;
  filter: PeopleDirectoryFilter;
  page: number;
}

export const EMPTY_PEOPLE_DIRECTORY_CONTEXT: PeopleDirectoryContext = {
  query: "",
  filter: "all",
  page: 1,
};

/** A page number from a URL. Anything that is not a whole page in range becomes page 1. */
export function parsePeoplePage(raw: string | undefined): number {
  if (typeof raw !== "string" || !/^[1-9]\d{0,6}$/.test(raw)) return 1;
  const page = Number(raw);
  return page > PEOPLE_DIRECTORY_MAX_PAGE ? 1 : page;
}

/**
 * Search text from a URL. Control characters become spaces, then the value is trimmed and truncated
 * to the RPC's bound, so an over-long paste narrows the search rather than 22023-ing a page the user
 * just opened.
 */
export function parsePeopleQuery(raw: string | undefined): string {
  if (typeof raw !== "string") return "";
  let cleaned = "";
  for (let index = 0; index < raw.length; index += 1) {
    cleaned += isControlCharacter(raw.charCodeAt(index)) ? " " : raw[index];
  }
  return cleaned.trim().slice(0, PEOPLE_QUERY_MAX_LENGTH).trim();
}

export function parsePeopleDirectoryContext(
  params: { q?: string; filter?: string; page?: string },
): PeopleDirectoryContext {
  return {
    query: parsePeopleQuery(params.q),
    filter: parsePeopleDirectoryFilter(params.filter),
    page: parsePeoplePage(params.page),
  };
}

/** Rebuild the canonical directory URL from validated state. Defaults are omitted so `/people` stays clean. */
export function peopleDirectoryHref(context: Partial<PeopleDirectoryContext> = {}): string {
  const { query, filter, page } = { ...EMPTY_PEOPLE_DIRECTORY_CONTEXT, ...context };
  const search = new URLSearchParams();
  if (query) search.set("q", query);
  if (filter !== "all") search.set("filter", filter);
  if (page > 1) search.set("page", String(page));
  const suffix = search.toString();
  return suffix ? `${PEOPLE_DIRECTORY_PATH}?${suffix}` : PEOPLE_DIRECTORY_PATH;
}

/**
 * Validate a `from` value and return a path that is safe to link to or redirect to.
 *
 * The rules are deliberately narrow, and each one closes a real way out of the application:
 *   * it must be a string that starts with a single `/` — no scheme, no `mailto:`, no `javascript:`;
 *   * `//host` and `/\host` are protocol-relative URLs that browsers resolve OFF-SITE, so both are
 *     rejected even though they start with `/`;
 *   * no control characters or whitespace, which is how a filtered scheme gets smuggled back in;
 *   * the path part must be exactly the people directory — this contract exists to return to that
 *     one page, and accepting any other internal route would make it a general-purpose redirector;
 *   * a fragment is dropped, and only the three known directory parameters survive, re-validated.
 *
 * The returned value is REBUILT from those validated parts. The caller's bytes are never echoed.
 */
export function parsePeopleReturnTo(raw: string | undefined): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 300) return PEOPLE_DIRECTORY_PATH;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return PEOPLE_DIRECTORY_PATH;
  if (hasUnsafePathCharacter(raw)) return PEOPLE_DIRECTORY_PATH;

  const hashAt = raw.indexOf("#");
  const withoutHash = hashAt >= 0 ? raw.slice(0, hashAt) : raw;
  const queryAt = withoutHash.indexOf("?");
  const path = queryAt >= 0 ? withoutHash.slice(0, queryAt) : withoutHash;
  if (path !== PEOPLE_DIRECTORY_PATH) return PEOPLE_DIRECTORY_PATH;

  const search = new URLSearchParams(queryAt >= 0 ? withoutHash.slice(queryAt + 1) : "");
  return peopleDirectoryHref(parsePeopleDirectoryContext({
    q: search.get("q") ?? undefined,
    filter: search.get("filter") ?? undefined,
    page: search.get("page") ?? undefined,
  }));
}

export interface PeopleDirectoryRequest {
  context: PeopleDirectoryContext;
  /** The canonical url to send the caller to, or `null` when the request already IS canonical. */
  redirectTo: string | null;
}

/**
 * Read a directory request and decide whether it is already spelled canonically.
 *
 * The directory has exactly one url per state. Without this, the same page is reachable under
 * several spellings (`?filter=all`, `?page=1`, `?q=`, a page number that is not one), each of which
 * would be a different cache key and a different thing to share. The canonical url is REBUILT from
 * the validated context, so a hostile parameter is normalised away rather than echoed back into a
 * redirect target.
 *
 * `requestedHref` is rebuilt with `URLSearchParams` too, not read off the raw url, so an encoding
 * difference (`%20` versus `+`) can never make a canonical request look non-canonical and loop.
 */
export function readPeopleDirectoryRequest(
  params: { q?: string; filter?: string; page?: string },
): PeopleDirectoryRequest {
  const context = parsePeopleDirectoryContext(params);
  const canonical = peopleDirectoryHref(context);
  const requested = new URLSearchParams();
  if (params.q != null) requested.set("q", params.q);
  if (params.filter != null) requested.set("filter", params.filter);
  if (params.page != null) requested.set("page", params.page);
  const suffix = requested.toString();
  const requestedHref = suffix ? `${PEOPLE_DIRECTORY_PATH}?${suffix}` : PEOPLE_DIRECTORY_PATH;
  return { context, redirectTo: requestedHref === canonical ? null : canonical };
}

/** Zero-based offset for a validated page. */
export function peopleDirectoryOffset(page: number, pageSize = PEOPLE_DIRECTORY_PAGE_SIZE): number {
  return (page - 1) * pageSize;
}

/** How many pages an exact matching total needs. Zero matches is still one (empty) page. */
export function peoplePageCount(matching: string, pageSize = PEOPLE_DIRECTORY_PAGE_SIZE): number {
  const total = BigInt(matching);
  const size = BigInt(pageSize);
  const pages = (total + size - BigInt(1)) / size;
  return pages < BigInt(1) ? 1 : Number(pages);
}

// ── the person 360's own URL state — a tab, and the directory it was opened from ────────────────

export const PERSON_TABS = ["overview", "work", "activity", "team"] as const;
export type PersonTab = (typeof PERSON_TABS)[number];

export function parsePersonTab(raw: string | undefined): PersonTab {
  return (PERSON_TABS as readonly string[]).includes(raw ?? "") ? (raw as PersonTab) : "overview";
}

/** Rebuild the canonical url for one person's file, given the tab and the validated `from`. */
export function personHref(personId: string, tab: PersonTab, from: string | null): string {
  const search = new URLSearchParams();
  if (tab !== "overview") search.set("tab", tab);
  if (from && from !== PEOPLE_DIRECTORY_PATH) search.set("from", from);
  const suffix = search.toString();
  const base = `${PEOPLE_DIRECTORY_PATH}/${personId}`;
  return suffix ? `${base}?${suffix}` : base;
}

/** The person link from a directory row, carrying the directory state it was opened from. */
export function personHrefFromDirectory(personId: string, context: PeopleDirectoryContext): string {
  const from = peopleDirectoryHref(context);
  return personHref(personId, "overview", from === PEOPLE_DIRECTORY_PATH ? null : from);
}

export interface PersonRequest {
  tab: PersonTab;
  /** The validated internal path to return to. Never the caller's own bytes. */
  from: string;
  /** The canonical url to send the caller to, or `null` when the request already IS canonical. */
  redirectTo: string | null;
}

/** Canonicalize a person file's `?tab=`/`?from=`, the same way the directory canonicalizes its own. */
export function readPersonRequest(
  personId: string,
  params: { tab?: string; from?: string },
): PersonRequest {
  const from = parsePeopleReturnTo(params.from);
  const tab = parsePersonTab(params.tab);
  const canonical = personHref(personId, tab, from);
  const requested = new URLSearchParams();
  if (params.tab != null) requested.set("tab", params.tab);
  if (params.from != null) requested.set("from", params.from);
  const suffix = requested.toString();
  const base = `${PEOPLE_DIRECTORY_PATH}/${personId}`;
  const requestedHref = suffix ? `${base}?${suffix}` : base;
  return { tab, from, redirectTo: requestedHref === canonical ? null : canonical };
}
