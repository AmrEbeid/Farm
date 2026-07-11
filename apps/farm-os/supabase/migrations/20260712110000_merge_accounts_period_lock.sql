-- Problem (#719 item 1): fn_merge_accounts repoints journal_lines.account_id from source→target across
--   ALL periods with no period-lock check, so an account merge can rewrite the per-account composition of
--   a LOCKED period — violating the period-lock immutability guarantee. Mitigated today (source/target must
--   share account_type AND kind, so type-level totals + double-entry balance are preserved, and it's
--   budget.write-gated + audited), so it can't unbalance or fabricate — but a locked period must be immutable.
--
-- Intent: make the period lock comprehensive. Reject a merge when the SOURCE account carries any posting whose
--   journal entry falls in a locked period (repointing such a line would mutate that locked period's per-account
--   balances). Merges touching only open periods are unaffected. This is enforcing the EXISTING lock invariant,
--   not a new policy; a deliberate locked-period admin override, if ever wanted, would be a separate explicit path.
--
-- Security implications: none new — same SECURITY DEFINER, same budget.write gate, same grants (re-emitted
--   verbatim below). Adds one read-only EXISTS guard using the internal fn_period_locked. No RLS/permission change.
--
-- Rollback: re-emit the prior fn_merge_accounts body (this file's minus the locked-period EXISTS block).
--
-- Idempotent: create-or-replace + verbatim revoke/grant, so a replay (and the MCP apply under its own version)
--   is a safe no-op. Pre-req verified before apply: no behavioral change for merges outside locked periods.

create or replace function public.fn_merge_accounts(p_source uuid, p_target uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_source record;
  v_target record;
  v_refs_expenses int := 0;
  v_refs_lines int := 0;
begin
  if p_source is null or p_target is null or p_source = p_target then
    raise exception 'source and target accounts must be different' using errcode = '22023';
  end if;

  select * into v_source from public.accounts where id = p_source for update;
  select * into v_target from public.accounts where id = p_target for update;
  if v_source.id is null then raise exception 'source account % not found', p_source using errcode = 'P0002'; end if;
  if v_target.id is null then raise exception 'target account % not found', p_target using errcode = 'P0002'; end if;
  if v_source.org_id is distinct from v_target.org_id then
    raise exception 'cannot merge accounts across orgs' using errcode = '42501';
  end if;
  if v_source.org_id not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org account' using errcode = '42501';
  end if;
  if not public.authorize('budget.write', v_source.org_id) then
    raise exception 'forbidden: budget.write is required' using errcode = '42501';
  end if;
  if coalesce(v_source.is_system, false) then
    raise exception 'system account cannot be merged away' using errcode = '22023';
  end if;
  if not coalesce(v_target.active, false) then
    raise exception 'target account is inactive' using errcode = '22023';
  end if;
  if v_source.account_type is distinct from v_target.account_type
     or v_source.kind is distinct from v_target.kind then
    raise exception 'source and target account type/kind must match' using errcode = '22023';
  end if;
  if exists (select 1 from public.accounts where parent_id = p_source and active) then
    raise exception 'source account must be a leaf to merge' using errcode = '22023';
  end if;
  if exists (select 1 from public.accounts where parent_id = p_target and active) then
    raise exception 'target account must be a leaf to merge' using errcode = '22023';
  end if;

  -- #719-1: a locked period is immutable. Repointing a source line dated in a locked period would rewrite
  -- that period's per-account balances, so reject the merge (errcode 55000, matching the posting-lock guard).
  if exists (
    select 1
      from public.journal_lines jl
      join public.journal_entries je on je.id = jl.journal_entry_id
     where jl.account_id = p_source
       and public.fn_period_locked(je.org_id, je.entry_date)
  ) then
    raise exception 'cannot merge: source account has postings in a locked period' using errcode = '55000';
  end if;

  perform set_config('app.account_merge_source', p_source::text, true);
  perform set_config('app.account_merge_target', p_target::text, true);
  update public.journal_lines
     set account_id = p_target
   where account_id = p_source;
  get diagnostics v_refs_lines = row_count;

  update public.expenses
     set account_id = p_target
   where account_id = p_source;
  get diagnostics v_refs_expenses = row_count;
  perform set_config('app.account_merge_source', '', true);
  perform set_config('app.account_merge_target', '', true);

  update public.accounts
     set active = false
   where id = p_source;

  return jsonb_build_object(
    'source_id', p_source,
    'target_id', p_target,
    'expenses_repointed', v_refs_expenses,
    'journal_lines_repointed', v_refs_lines);
end;
$$;
revoke execute on function public.fn_merge_accounts(uuid, uuid) from public, anon, authenticated;
grant execute on function public.fn_merge_accounts(uuid, uuid) to authenticated;
