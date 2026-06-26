# DECISION-0199 — Reservation double-count in the stock-coverage projection

*Status: **DECISION REQUIRED (Owner) — design + decision-support only.** No code, migration, or data
change is performed by this document. The fix it scopes is an **engine-SQL / reservation-semantics**
change (PROJECT RULES hard stop): Owner-ratified, independent-review-required, applied via a forward
migration. Companion to [`SPEC-0001`](SPEC-0001-stock-coverage-engine.md) (the disjointness invariant this
protects). Source: GitHub issue **#199** (open). Verified 2026-06-26 against repo @ prod migration `0048`.*

---

## 1. The bug (with evidence)
On a coverage **re-compute after a reserve**, the same op's consumption is subtracted twice:
- `migrations/...0047_engine_nulldate_guard.sql:89` `v_avail := v_onhand - v_reserved` — a `reserve`
  movement (via `fn_reserve_stock`, `...0037`; `bin.reserved` rebuilt in `...0013`) lowers the opening; and
- `...0047:114-130` the demand loop still sums the op's `pmr.qty` into `v_issues`, filtered `:124`
  `po.status in ('planned','reserved','ready')`.

**Worked PAB** (`on_hand=300`, demand `pmr.qty=500`, `ss=0`, `pack=50`):
- First compute (`reserved=0`): `PAB[1]=300−500=−200` → shortfall 200, recommend 200.
- UI reserves `reserveQty=recommend_qty=200` (`coverage/page.tsx:142`) → `bin.reserved=200`.
- Re-compute (`reserved=200`): `v_avail=100`, `v_issues[1]=500`, `PAB[1]=−400` → shortfall **400**.
- True remaining shortfall is still **200** → over-stated by exactly the reserved amount `R`.

**Premise correction:** nothing ever sets an op to `status='reserved'` (only `set status='done'`,
`...0020:72`; seed ops are `'planned'`, `seed.sql:187-189`). The op stays `'planned'` — also in the
`:124` set — so the double-count is live today; `'reserved'`-in-the-set is a *latent* second trap.

## 2. Why it is currently SAFE
`v_raw = greatest(0, shortfall + ss)` (`:197`) is monotonic in shortfall → the bug can only
OVER-recommend (over-purchase). It is over-conservative and **never masks a shortage**. `tests/06`
uses `reserved=0` throughout, so the re-compute path is untested. (This is why it is parked, not patched:
the current behaviour is the *safe* direction.)

## 3. Candidate fixes — and exactly when each MASKS
- **(a) Exclude `'reserved'` from `v_issues` (`:124`).** No-op until a writer flips the op to
  `'reserved'`. Once it does, the op's consumption is counted only via `reserved→v_avail`, which is
  correct ONLY IF `reserved == op's full demand`. Under a partial reserve, or `reserve=recommend_qty≠demand`,
  it drops `(demand−R)` of real demand → UNDER-recommend → **MASK**.
- **(b) Change what `reserveStock` reserves.** Alone it only rescales the `+R` over-count (never
  removes it). It is the companion that makes (a) safe: reserve **exactly `pmr.qty`**.
- **Neither alone is correct.** The coherent fix is the triple: reserve = full op demand; flip
  op → `'reserved'` on reserve; exclude `'reserved'` from `v_issues`.

## 4. The ONE Owner decision
Does a reservation mean **"committed demand removed from the forward projection" (Model A)**? If yes:
reserve exactly the op's material requirement, flip the op to `'reserved'`, and exclude `'reserved'`
ops from `v_issues` — the `v_avail` drop becomes the sole accounting of that consumption. The decisive
sub-question: is **`reserveQty` the op's `pmr.qty` (what both docstrings claim) or the order qty
`recommend_qty` (what `coverage/page.tsx:142` actually wires)?** They differ (500 vs 200; `recommend_qty`
is pack-rounded and netted of on-hand/SS). Model A *requires* `reserveQty = pmr.qty`; the current
`recommend_qty` wiring is incompatible with excluding reserved ops from the projection.

## 5. Ready slice (AFTER §4 ratified) + pgTAP oracle (write first)
- App: pass `reserveQty = the op's material requirement` (not `recommend_qty`) at `page.tsx:142` /
  `coverage/actions.ts`; flip the demanding op to `status='reserved'` inside the reserve transaction.
- Engine: drop `'reserved'` from the `v_issues` `:124` filter (keep it in `v_avail`); receipts /
  `v_period_start` unchanged. Forward migration, create-or-replace, ADR-0006 conventions.
- **pgTAP oracle:** (1) FULL reserve == op demand → re-compute `recommend_qty` and `shortfall` are
  IDENTICAL to the first compute (no double-count); (2) PARTIAL reserve `R < demand` → re-compute still
  reports the residual `(demand − R)` shortage (no MASK); (3) `reserved=0` path byte-identical to today.

## 6. Decision log
- **2026-06-26 (held, pending Owner):** confirmed a live `+R` double-count on re-compute, but it is the
  SAFE direction (over-recommend, never mask), and every partial fix risks flipping it to a MASK. Needs the
  Owner's reservation-model call (§4) before any engine change. One message — *"reserved = committed demand
  pulled from the projection; reserve the op's requirement, not the order qty"* — unblocks §5.
