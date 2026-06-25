-- Farm OS MVP-0 — #160: an approved PR's monetary footprint is immutable, and the AP-3 optimistic
-- lock actually works.
--
-- CONFIRMED gap (local probe): purchase_request_items carries only the blanket tenant_all policy, so
-- ANY org member (e.g. an accountant — not the approver) could `update purchase_request_items set
-- qty=…` AFTER the parent PR is approved (probe: 100 → 10099). The pr_guard_approval trigger is on
-- purchase_requests, NOT on the items table. Separately, purchase_requests.version exists and the app's
-- approvePurchaseRequest does `.eq("version", version)` (AP-3 stale-write guard), but NOTHING ever
-- increments version (0 triggers bump it), so the guard is inert.
--
-- Fix (two pieces):
--   1) fn_pr_items_lock_when_decided — BEFORE INSERT/UPDATE/DELETE on purchase_request_items: reject a
--      CLIENT mutation when the parent PR is already 'approved' or 'received'. Exempts the trusted
--      null-uid service/superuser/seed context (auth.uid() is null), mirroring pr_guard_approval.
--   2) fn_pr_bump_version — BEFORE UPDATE on purchase_requests: version := version + 1, so the AP-3
--      optimistic lock genuinely rejects a stale concurrent approval.
--
-- Safe — confirmed (grep): the app only INSERTs PR items at draft creation and READS them; no app flow
-- edits an approved PR's items, and fn_post_receipt only READS items (never writes them), so the lock
-- never fires on a legitimate path. fn_post_receipt's own status flip (approved→received) bumps version
-- harmlessly. Independent of migrations 0030 (#163) / 0031 (#164) — different objects, any merge order.
--
-- Product note (owner-ratified at merge): this HARD-FREEZES approved/received PR lines. The alternative
-- — allow edits but reset status to 'draft' / require re-approval — is a larger workflow feature. Hard-
-- freeze is the conservative financial-control default (an approved purchase commitment is immutable;
-- to change it, re-issue). Flagged for the owner, not assumed.

-- ── 1) lock PR line items once the parent PR is decided ───────────────────────────────────────────
create or replace function public.fn_pr_items_lock_when_decided()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  -- trusted server/seed context (no JWT) is exempt — same precedent as pr_guard_approval (0017/0023).
  if (select auth.uid()) is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  -- Guard the line's CURRENT parent (old) on UPDATE/DELETE: you cannot edit, delete, OR detach
  -- (pr_id-rewrite) a line that currently belongs to a decided PR — that mutates the approved PR's
  -- monetary footprint. (Reviewer-found bypass: checking only new.pr_id let a line be moved OFF an
  -- approved PR onto a draft.)
  if tg_op in ('UPDATE','DELETE') then
    select pr.status into v_status from public.purchase_requests pr where pr.id = old.pr_id;
    if v_status in ('approved','received') then
      raise exception
        'cannot % a line of purchase request % — it is already % (approved purchase commitments are immutable; re-issue instead)',
        lower(tg_op), old.pr_id, v_status
        using errcode = '42501';
    end if;
  end if;

  -- Guard the TARGET parent (new) on INSERT/UPDATE: you cannot add a line to, or move a line onto, a
  -- decided PR.
  if tg_op in ('INSERT','UPDATE') then
    select pr.status into v_status from public.purchase_requests pr where pr.id = new.pr_id;
    if v_status in ('approved','received') then
      raise exception
        'cannot % a line onto purchase request % — it is already % (approved purchase commitments are immutable)',
        (case when tg_op = 'INSERT' then 'add' else 'move' end), new.pr_id, v_status
        using errcode = '42501';
    end if;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists pr_items_lock_when_decided on public.purchase_request_items;
create trigger pr_items_lock_when_decided
  before insert or update or delete on public.purchase_request_items
  for each row execute function public.fn_pr_items_lock_when_decided();

-- ── 2) make the AP-3 optimistic lock real: bump version on every PR update ─────────────────────────
create or replace function public.fn_pr_bump_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.version := coalesce(old.version, 0) + 1;
  return new;
end $$;

drop trigger if exists pr_bump_version on public.purchase_requests;
-- name sorts before pr_guard_approval so it runs first; both only set NEW columns (no conflict).
create trigger pr_bump_version
  before update on public.purchase_requests
  for each row execute function public.fn_pr_bump_version();

-- trigger functions are never called directly — lock them down (mirrors migration 0021).
revoke execute on function public.fn_pr_items_lock_when_decided() from public, anon, authenticated;
revoke execute on function public.fn_pr_bump_version()           from public, anon, authenticated;
