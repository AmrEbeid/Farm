-- Farm OS — defense-in-depth (#503): one cash-out movement per expense, enforced at the storage layer.
--
-- The "an expense is paid from custody exactly once" invariant is ALREADY maintained at runtime by
-- fn_set_expense_payment_status (SELECT … FOR UPDATE on the expense + atomic status+movement coupling + the
-- append-only ledger), so this is NOT a live-bug fix — a concurrent double-pay cannot happen today. This is a
-- permanent storage-layer backstop mirroring the existing `prl_expense_once_uniq` precedent, so no future code
-- path can ever double-post a cash-out for one expense. Prod was verified clean (no expense has >1
-- amount_out>0 movement) before adding.
--
-- Partial + NULL-safe: only expense-linked cash-out rows are constrained; custody top-ups (amount_in) and
-- non-expense withdrawals (expense_id IS NULL) are unaffected. Additive (CREATE INDEX), idempotent, no data
-- change. Rollback: drop the index.
create unique index if not exists custody_movements_one_out_per_expense_uniq
  on public.custody_movements (expense_id)
  where amount_out > 0 and expense_id is not null;
