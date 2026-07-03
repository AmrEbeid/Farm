import type { ExecuteInput } from "@/app/(app)/m/execute/[opId]/actions";

/**
 * F1 — offline outbox for operation execution (confirm-on-reconnect model).
 *
 * A field worker on a flaky connection can lose their execute submission when the network drops
 * mid-request (the server action's fetch rejects). Before this, the only recourse was to keep the
 * page open and retry; navigating away or the phone locking lost the typed actuals. This persists a
 * FAILED-ON-NETWORK execute payload to `localStorage` so it survives an app-close, and surfaces it
 * on `/m` for the worker to RE-SEND with an explicit tap.
 *
 * Deliberately conservative (this is the stock-issuing path — a wrong or silent replay is worse than
 * none, non-negotiables #1/#2):
 *  - Queued ONLY on a genuine network failure (the ExecuteForm `catch`), never on a server rejection
 *    (a validation/authz "no" is shown, not queued).
 *  - NO auto-replay. The worker taps «إعادة الإرسال» per item; the queue is always visible.
 *  - The banner never claims the op was sent — only that it was saved on the device.
 *  - The outbox's job is only to survive the NETWORK gap: once the server responds to a resend
 *    (accept OR reject), the entry is dropped — the server is authoritative (`fn_execute_operation`
 *    is idempotent/claim-first, so a duplicate resend is safe).
 *
 * The pure list helpers below are unit-tested; the `window.localStorage` wrappers are thin and
 * guarded (`typeof window`), so they no-op safely during SSR.
 */
export interface OutboxEntry {
  /** = opId. One pending execution per op (you can't execute an op twice), so opId is the identity
   *  and the dedupe key — a fresh submit for the same op replaces the older queued payload. */
  id: string;
  opId: string;
  /** Arabic op label for the queue display (e.g. "تلقيح") — display only. */
  opLabel: string;
  payload: ExecuteInput;
  /** ISO timestamp the payload was queued (for "منذ …" display / ordering). */
  queuedAt: string;
}

const STORAGE_KEY = "farm-os:exec-outbox";

/** Replace-or-insert by opId (a newer submit for the same op supersedes the queued one). Pure. */
export function upsertEntry(list: OutboxEntry[], entry: OutboxEntry): OutboxEntry[] {
  return [...list.filter((e) => e.opId !== entry.opId), entry];
}

/** Remove an entry by id. Pure. */
export function removeEntry(list: OutboxEntry[], id: string): OutboxEntry[] {
  return list.filter((e) => e.id !== id);
}

function isValidEntry(e: unknown): e is OutboxEntry {
  if (e == null || typeof e !== "object") return false;
  const r = e as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.opId === "string" &&
    typeof r.opLabel === "string" &&
    typeof r.queuedAt === "string" &&
    r.payload != null &&
    typeof r.payload === "object"
  );
}

/**
 * Parse a raw localStorage string into a clean entry list. Tolerant by design: corrupt JSON, a
 * non-array, or malformed entries yield `[]`/are dropped rather than throwing — a broken outbox must
 * degrade to "nothing queued" (i.e. today's behaviour), never crash the field view. Pure.
 */
export function parseOutbox(raw: string | null): OutboxEntry[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidEntry);
  } catch {
    return [];
  }
}

/** Read the raw stored string, guarding BOTH the SSR case and a throwing accessor: `window.
 *  localStorage` throws `SecurityError` when storage is disabled (blocked cookies, some WebViews,
 *  sandboxed iframes). A throw here would crash `/m` at render (getOutboxSnapshot) or abort the
 *  ExecuteForm catch — so treat "can't read storage" as "nothing queued". */
function safeGetRaw(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function readOutbox(): OutboxEntry[] {
  return parseOutbox(safeGetRaw());
}

/** Persist the list. Returns whether it was actually saved — callers MUST NOT claim "saved on this
 *  device" on a false return (storage full/disabled). Never throws on the execute path. */
function writeOutbox(list: OutboxEntry[]): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

/** Queue an entry. Returns true iff it was actually persisted (see writeOutbox). */
export function addToOutbox(entry: OutboxEntry): boolean {
  const saved = writeOutbox(upsertEntry(readOutbox(), entry));
  if (saved) emit();
  return saved;
}

export function removeFromOutbox(id: string): void {
  if (writeOutbox(removeEntry(readOutbox(), id))) emit();
}

// ── React external-store binding (useSyncExternalStore) ─────────────────────────────────────────
// localStorage doesn't emit change events for same-tab writes, so we keep an in-process listener set
// and notify it on add/remove; the `storage` event covers OTHER tabs. This lets the /m outbox view
// react to a resend without a setState-in-effect (which cascades renders).

const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function subscribeOutbox(onChange: () => void): () => void {
  listeners.add(onChange);
  if (typeof window !== "undefined") window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    if (typeof window !== "undefined") window.removeEventListener("storage", onChange);
  };
}

// A stable empty reference so the server snapshot (and an empty client store) don't churn identity —
// useSyncExternalStore compares snapshots by Object.is and would loop on a fresh [] each call.
const EMPTY: readonly OutboxEntry[] = Object.freeze([]);
let snapshotRaw: string | null = null;
let snapshotVal: OutboxEntry[] = [];

/** Cached client snapshot: re-parse only when the raw localStorage string actually changed, so the
 *  returned array keeps a stable identity between reads (required by useSyncExternalStore). */
export function getOutboxSnapshot(): readonly OutboxEntry[] {
  if (typeof window === "undefined") return EMPTY;
  const raw = safeGetRaw();
  if (raw !== snapshotRaw) {
    snapshotRaw = raw;
    snapshotVal = parseOutbox(raw);
  }
  return snapshotVal;
}

export function getServerOutboxSnapshot(): readonly OutboxEntry[] {
  return EMPTY;
}
