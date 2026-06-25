# Integrity Finding — the #159 stock floor is not enforced under concurrency (CONC-1)   (2026-06-25)

Reviewer: independent adversarial pass over the post-re-audit ledger RPCs (`fn_post_movement`,
`fn_bin_rebuild`). Owner: Amr Ebeid. Severity: **MEDIUM (integrity, concurrency-only)** — the same
damage class #159 (migration `0031`) set out to prevent (negative `on_hand` → the coverage engine
trusts garbage and over-recommends a purchase), but reachable via two simultaneous outflows.

## The gap

`0031` added a stock floor to `fn_post_movement`: for an outflow (`issue`/`loss`/`expiry`/`transfer`)
it reads `on_hand` and rejects `p_qty > on_hand`. But the read takes **no row lock**, and
`fn_bin_rebuild` only locks the bin at its closing `UPDATE` — *after* it has already summed the
ledger. So the floor check is a classic **check-then-act (TOCTOU)** with no serialization.

### Reproduction (reasoned, READ COMMITTED — the Postgres default)

Item X, `on_hand = 100`. Two concurrent `fn_post_movement(X, 'issue', 80)` calls (e.g. two
supervisors executing operations that consume X at the same instant):

| | T_A | T_B |
|---|---|---|
| 1 | read `on_hand` = 100 (no lock) | read `on_hand` = 100 (A uncommitted → sees 100) |
| 2 | floor check 80 ≤ 100 ✓ | floor check 80 ≤ 100 ✓ |
| 3 | insert `issue 80` | insert `issue 80` |
| 4 | `fn_bin_rebuild` sums → 20, `UPDATE` (row lock) | `fn_bin_rebuild` sums → 20 (misses A's uncommitted row), `UPDATE` blocks on A |
| 5 | commit (releases lock) | unblocks → writes `on_hand = 20`, commit |

**Result:** the ledger truly sums to `100 − 80 − 80 = −60` (160 issued against 100 physical), yet
`bin.on_hand = 20` (the last writer's stale recompute). `fn_stock_coverage` then trusts a wrong
`available`, and physical stock went negative — the precise failure #159 exists to prevent, plus the
bin is now out of sync with the ledger.

## The fix (recommended) — serialize movements on the bin row

Take a row lock on the `(item, location)` bin **before** the floor check, so concurrent posts on the
same bin serialize:

```sql
-- ensure the bin row exists, THEN lock+read it (serializes concurrent movements on this bin)
insert into public.inventory_bin (org_id, item_id, location)
  values (v_org, p_item, p_location) on conflict (item_id, location) do nothing;
select coalesce(on_hand, 0) into v_onhand
  from public.inventory_bin where item_id = p_item and location = p_location
  for update;                                            -- ← the serialization point
if p_type in ('issue','loss','expiry','transfer') and p_qty > v_onhand then
  raise exception 'insufficient stock …' using errcode = '23514';
end if;
-- … insert movement … fn_bin_rebuild (its sum now runs under our lock → no missed inserts)
```

With the lock, T_B's `FOR UPDATE` blocks until T_A commits, then reads the *post-A* `on_hand = 20`
and the floor check `80 > 20` correctly **rejects** (23514). It also fixes the rebuild lost-update
(T_B's sum now sees A's committed insert). Cost: movements on the *same* bin serialize — negligible
for the pilot, and correct (a bin's balance is inherently a serialization point).

## Status

Fixed in **migration `0033`** (re-emits `fn_post_movement` from `0031` with only the lock + reorder
added) + the existing single-call floor test (`32`) still green. **Core money/stock RPC → independent
review required + Owner ratification before the prod DB push** (prod is at `0029`; `0030`–`0033`
remain the pending delta). True concurrency cannot be exercised in single-session pgTAP; the fix is
the standard `FOR UPDATE` serialization, verified not to regress the single-call path (shim harness
green).
