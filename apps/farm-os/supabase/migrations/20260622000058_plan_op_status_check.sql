-- Farm OS MVP-0 — #235 (defense-in-depth, recommended in the #298 review): constrain
-- plan_operations.status to its known vocabulary.
--
-- THE GAP. plan_operations.status is `text not null default 'planned'` with NO CHECK (migration 0006),
-- unlike farm_event.status (0004) which is constrained. So a typo'd or arbitrary status can be written
-- via direct REST. That is more than cosmetic now: the execute guard (0057) and its UI mirror
-- (isExecutableOpStatus) classify "executable" as the NEGATIVE of {done, blocked, abandoned, skipped} —
-- so an UNKNOWN status (e.g. 'cancled') would be treated as EXECUTABLE and could be executed/issued.
-- Constraining the column closes that hole at the source.
--
-- THE FIX. CHECK status against the 9-value OP_STATUS_AR vocabulary (the set the UI knows how to render
-- and the engine/guards reason about): planned, approved, reserved, ready, in_progress, done, blocked,
-- abandoned, skipped. (This is the plan-op set — a superset of farm_event's 8, which additionally has
-- 'approved' for a plan-approved op.) Prod has only 'planned' rows and 0 outside this set (verified), so
-- the constraint validates immediately.

alter table public.plan_operations
  add constraint plan_operations_status_valid
  check (status in (
    'planned', 'approved', 'reserved', 'ready', 'in_progress', 'done', 'blocked', 'abandoned', 'skipped'
  ));
