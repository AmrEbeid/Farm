-- SPEC-0028 C-4: append-only reversal for a standalone owner-funding custody movement.
-- Only the journaled owner-funding path is in scope. Linked and journal-less rows fail closed.

begin;

alter table public.custody_movements
  drop constraint if exists custody_movements_reversal_shape_check;
alter table public.custody_movements
  add constraint custody_movements_reversal_shape_check check (
    (
      (reversal_of is null and reversal_reason is null and expense_reversal_outcome is null)
      or (
        reversal_of is not null
        and reversal_of is distinct from id
        and nullif(btrim(reversal_reason), '') is not null
        and (
          (amount_in > 0 and amount_out = 0
            and expense_reversal_outcome in ('unrouted', 'cancelled') and expense_id is not null)
          or
          (amount_in = 0 and amount_out > 0
            and expense_reversal_outcome is null and expense_id is null
            and payment_request_id is null and transfer_group_id is null)
        )
      )
    )
    and (
      (reversed_by is null and reversed_at is null)
      or (reversed_by is not null and reversed_at is not null
        and reversal_of is null and (amount_in > 0 or amount_out > 0))
    )
  );

-- Preserve ordinary journal corrections while preventing an owner-funding journal from leaving its
-- custody movement posted. C-4 reaches the already-private helper only after it has locked and proved
-- the linked cash row. The helper repeats membership, permission and period-lock checks.
create or replace function public.fn_reverse_journal_entry(
  p_entry uuid,
  p_reason text,
  p_reversal_date date default current_date
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
      from public.journal_entries journal
     where journal.id = p_entry
       and journal.org_id in (select public.user_org_ids())
       and journal.source_type = 'custody_owner_funding'
  ) then
    raise exception 'owner-funding journal must be reversed through fn_reverse_custody_movement'
      using errcode = '22023';
  end if;

  return private.fn_reverse_journal_entry_internal(p_entry, p_reason, p_reversal_date, false);
end;
$$;
revoke execute on function public.fn_reverse_journal_entry(uuid, text, date)
  from public, anon;
grant execute on function public.fn_reverse_journal_entry(uuid, text, date)
  to authenticated;

create or replace function public.fn_reverse_custody_movement(
  p_movement uuid,
  p_reason text,
  p_reversal_date date
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_account uuid;
  v_original public.custody_movements%rowtype;
  v_existing public.custody_movements%rowtype;
  v_original_journal public.journal_entries%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_current_balance numeric;
  v_reversal_movement uuid;
  v_reversal_journal uuid;
  v_updated_lines integer;
  v_line_count bigint;
  v_linked_line_count bigint;
  v_debit_total numeric;
  v_credit_total numeric;
begin
  if p_movement is null then
    raise exception 'custody movement required' using errcode = '23502';
  end if;
  if v_reason is null then
    raise exception 'reversal reason required' using errcode = '23502';
  end if;
  if length(v_reason) > 500 then
    raise exception 'reversal reason exceeds 500 characters' using errcode = '22023';
  end if;
  if p_reversal_date is null then
    raise exception 'reversal date required' using errcode = '23502';
  end if;
  if p_reversal_date > (pg_catalog.now() at time zone 'Africa/Cairo')::date then
    raise exception 'reversal date cannot be after the current Cairo business date'
      using errcode = '22023';
  end if;

  -- Membership participates in lookup so foreign and missing UUIDs have the same outcome.
  select movement.org_id, movement.custody_account_id
    into v_org, v_account
    from public.custody_movements movement
   where movement.id = p_movement
     and movement.org_id in (select public.user_org_ids());
  if not found then
    raise exception 'custody movement not found' using errcode = 'P0002';
  end if;
  if not public.authorize('budget.write', v_org)
     or not public.authorize('custody.write', v_org) then
    raise exception 'forbidden: budget.write and custody.write are required' using errcode = '42501';
  end if;

  if not pg_catalog.pg_try_advisory_xact_lock_shared(
    ('x' || pg_catalog.substr(pg_catalog.md5(v_org::text), 1, 16))::bit(64)::bigint
  ) then
    raise exception 'month close is in progress; retry the custody reversal'
      using errcode = '55P03';
  end if;

  -- This is the custody balance mutex and matches the existing writer lock order.
  perform 1
    from public.custody_accounts account
   where account.id = v_account and account.org_id = v_org
   for update;
  if not found then
    raise exception 'custody account is inconsistent' using errcode = '55000';
  end if;

  select movement.*
    into v_original
    from public.custody_movements movement
   where movement.id = p_movement
     and movement.org_id = v_org
     and movement.custody_account_id = v_account
   for update;
  if not found then
    raise exception 'custody movement changed during reversal' using errcode = '55000';
  end if;
  if v_original.reversal_of is not null then
    raise exception 'a reversal movement cannot be reversed' using errcode = '22023';
  end if;

  select reversal.*
    into v_existing
    from public.custody_movements reversal
   where reversal.reversal_of = v_original.id
   for update;
  if found then
    if v_existing.reversal_reason is distinct from v_reason
       or v_existing.org_id is distinct from v_org
       or v_existing.custody_account_id is distinct from v_account
       or v_existing.occurred_at is distinct from p_reversal_date
       or v_existing.movement_type is distinct from 'عكس تمويل المالك'
       or v_existing.amount_in <> 0
       or v_existing.amount_out is distinct from v_original.amount_in
       or v_existing.expense_id is not null
       or v_existing.payment_request_id is not null
       or v_existing.transfer_group_id is not null
       or v_existing.journal_entry_id is null
       or v_original.reversed_by is distinct from v_existing.id
       or v_original.reversed_at is null
       or not exists (
         select 1
           from public.journal_entries reversal_journal
           join public.journal_entries original_journal
             on original_journal.id = v_original.journal_entry_id
          where reversal_journal.id = v_existing.journal_entry_id
            and reversal_journal.org_id = v_org
            and reversal_journal.entry_date = p_reversal_date
            and reversal_journal.source_type = 'custody_owner_funding'
            and reversal_journal.source_id = v_original.id
            and reversal_journal.status = 'reversed'
            and reversal_journal.reversal_of = original_journal.id
            and original_journal.org_id = v_org
            and original_journal.source_type = 'custody_owner_funding'
            and original_journal.source_id = v_original.id
            and original_journal.status = 'reversed'
            and original_journal.reversal_of is null
       )
       or not exists (
         select 1
           from public.journal_lines line
          where line.journal_entry_id = v_existing.journal_entry_id
          group by line.journal_entry_id
         having count(*) = 2
            and count(*) filter (
              where line.org_id = v_org
                and line.custody_account_id = v_account
                and line.custody_movement_id = v_existing.id
                and line.expense_id is null
                and line.payment_request_id is null
            ) = 2
            and coalesce(sum(line.debit), 0) = v_original.amount_in
            and coalesce(sum(line.credit), 0) = v_original.amount_in
       ) then
      raise exception 'custody movement was already reversed with a different request or state'
        using errcode = '22023';
    end if;
    return jsonb_build_object(
      'original_movement_id', v_original.id,
      'reversal_movement_id', v_existing.id,
      'reversal_journal_id', v_existing.journal_entry_id,
      'idempotent', true
    );
  end if;

  if v_original.reversed_by is not null or v_original.reversed_at is not null then
    raise exception 'custody movement reversal markers are inconsistent' using errcode = '55000';
  end if;
  if v_original.expense_id is not null
     or v_original.payment_request_id is not null
     or v_original.transfer_group_id is not null then
    raise exception 'linked custody movement requires its dedicated correction workflow'
      using errcode = '22023';
  end if;
  if v_original.amount_in <= 0
     or v_original.amount_out <> 0
     or v_original.movement_type is distinct from 'استلام عهدة من المالك'
     or v_original.journal_entry_id is null then
    raise exception 'only a journaled standalone owner-funding cash-in can be reversed'
      using errcode = '22023';
  end if;

  select journal.*
    into v_original_journal
    from public.journal_entries journal
   where journal.id = v_original.journal_entry_id
   for update;
  if not found
     or v_original_journal.org_id is distinct from v_org
     or v_original_journal.source_type is distinct from 'custody_owner_funding'
     or v_original_journal.source_id is distinct from v_original.id
     or v_original_journal.status is distinct from 'posted'
     or v_original_journal.reversal_of is not null then
    raise exception 'owner-funding journal link is structurally inconsistent' using errcode = '55000';
  end if;
  if p_reversal_date < v_original_journal.entry_date then
    raise exception 'reversal date cannot precede the original journal date' using errcode = '22023';
  end if;

  select
    count(*),
    count(*) filter (
      where line.org_id = v_org
        and line.custody_account_id = v_account
        and line.custody_movement_id = v_original.id
        and line.expense_id is null
        and line.payment_request_id is null
    ),
    coalesce(sum(line.debit), 0),
    coalesce(sum(line.credit), 0)
    into v_line_count, v_linked_line_count, v_debit_total, v_credit_total
    from public.journal_lines line
   where line.journal_entry_id = v_original_journal.id;
  if v_line_count <> 2
     or v_linked_line_count <> 2
     or v_debit_total is distinct from v_original.amount_in
     or v_credit_total is distinct from v_original.amount_in then
    raise exception 'owner-funding journal lines are structurally inconsistent' using errcode = '55000';
  end if;

  select coalesce(sum(movement.amount_in), 0) - coalesce(sum(movement.amount_out), 0)
    into v_current_balance
    from public.custody_movements movement
   where movement.org_id = v_org and movement.custody_account_id = v_account;
  if v_current_balance < v_original.amount_in then
    raise exception 'insufficient custody balance to reverse owner funding' using errcode = '22023';
  end if;

  insert into public.custody_movements(
    org_id, custody_account_id, occurred_at, movement_type, amount_in, amount_out,
    note, reversal_of, reversal_reason
  ) values (
    v_org, v_account, p_reversal_date, 'عكس تمويل المالك', 0, v_original.amount_in,
    concat('عكس الحركة ', v_original.id::text, ' — السبب: ', v_reason),
    v_original.id, v_reason
  ) returning id into v_reversal_movement;

  v_reversal_journal := private.fn_reverse_journal_entry_internal(
    v_original.journal_entry_id, v_reason, p_reversal_date, false
  );

  update public.journal_lines
     set custody_movement_id = v_reversal_movement
   where journal_entry_id = v_reversal_journal;
  get diagnostics v_updated_lines = row_count;
  if v_updated_lines <> 2 then
    raise exception 'custody reversal journal does not contain exactly two lines' using errcode = '55000';
  end if;

  update public.custody_movements
     set journal_entry_id = v_reversal_journal
   where id = v_reversal_movement;
  update public.custody_movements
     set reversed_by = v_reversal_movement, reversed_at = now()
   where id = v_original.id;

  return jsonb_build_object(
    'original_movement_id', v_original.id,
    'reversal_movement_id', v_reversal_movement,
    'reversal_journal_id', v_reversal_journal,
    'idempotent', false
  );
end;
$$;

comment on function public.fn_reverse_custody_movement(uuid, text, date) is
  'Reverse one journaled standalone owner-funding custody movement through linked cash and journal mirrors.';

revoke execute on function public.fn_reverse_custody_movement(uuid, text, date)
  from public, anon, authenticated;
grant execute on function public.fn_reverse_custody_movement(uuid, text, date)
  to authenticated;

commit;
