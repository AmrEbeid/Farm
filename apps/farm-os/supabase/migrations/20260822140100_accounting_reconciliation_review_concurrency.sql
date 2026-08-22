-- Prevent a stale reconciliation form from overwriting another reviewer's decision.
--
-- The original implementation remains as a private, non-executable helper. The public RPC acquires
-- locks in the established parent->child order, compares the caller's monotonic version while the row
-- lock is held, then invokes the original typed decision validator/writer in the same transaction.

begin;

alter table public.reconciliation_batch_rows
  add column if not exists review_version integer not null default 0;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.reconciliation_batch_rows'::regclass
       and conname = 'reconciliation_batch_rows_review_version_nonnegative'
  ) then
    alter table public.reconciliation_batch_rows
      add constraint reconciliation_batch_rows_review_version_nonnegative
      check (review_version >= 0);
  end if;
end;
$$;

create or replace function public.fn_reconciliation_bump_review_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.review_version := old.review_version + 1;
  return new;
end;
$$;

drop trigger if exists reconciliation_bump_review_version
  on public.reconciliation_batch_rows;
create trigger reconciliation_bump_review_version
before update on public.reconciliation_batch_rows
for each row execute function public.fn_reconciliation_bump_review_version();

revoke all on function public.fn_reconciliation_bump_review_version() from public, anon, authenticated;

do $$
begin
  if to_regprocedure('public.fn_review_reconciliation_row_unversioned(uuid,jsonb)') is null then
    if to_regprocedure('public.fn_review_reconciliation_row(uuid,jsonb)') is null then
      raise exception 'required fn_review_reconciliation_row(uuid,jsonb) is missing';
    end if;
    alter function public.fn_review_reconciliation_row(uuid, jsonb)
      rename to fn_review_reconciliation_row_unversioned;
  end if;
end;
$$;

revoke all on function public.fn_review_reconciliation_row_unversioned(uuid, jsonb)
  from public, anon, authenticated;

create or replace function public.fn_review_reconciliation_row(p_row_id uuid, p_decision jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid                 uuid := (select auth.uid());
  v_org                 uuid;
  v_batch               uuid;
  v_batch_status        text;
  v_frozen              boolean;
  v_current_reviewed_at timestamptz;
  v_current_review_version integer;
  v_expected_review_version integer;
  v_result              jsonb;
begin
  if p_row_id is null then
    raise exception 'row id required' using errcode = '23502';
  end if;
  if p_decision is null or jsonb_typeof(p_decision) <> 'object' then
    raise exception 'decision must be an object' using errcode = '22023';
  end if;

  select br.org_id, br.batch_id
    into v_org, v_batch
    from public.reconciliation_batch_rows br
   where br.id = p_row_id;
  if v_org is null then
    raise exception 'reconciliation row % not found', p_row_id using errcode = 'P0002';
  end if;

  if v_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org reconciliation row' using errcode = '42501';
  end if;
  if not exists (
    select 1
      from public.organization_member m
     where m.org_id = v_org and m.user_id = v_uid
  ) then
    raise exception 'forbidden: not a member of this organization' using errcode = '42501';
  end if;
  if not public.authorize('reconciliation.write', v_org) then
    raise exception 'forbidden: reconciliation.write is required' using errcode = '42501';
  end if;

  -- Preserve the existing freeze/review deadlock discipline: batch lock before row lock.
  select b.status
    into v_batch_status
    from public.reconciliation_batches b
   where b.id = v_batch and b.org_id = v_org
     for update;
  if v_batch_status is null then
    raise exception 'reconciliation batch % not found', v_batch using errcode = 'P0002';
  end if;

  select br.frozen, br.reviewed_at, br.review_version
    into v_frozen, v_current_reviewed_at, v_current_review_version
    from public.reconciliation_batch_rows br
   where br.id = p_row_id and br.batch_id = v_batch and br.org_id = v_org
     for update;
  if not found then
    raise exception 'reconciliation row % changed while acquiring its batch lock', p_row_id
      using errcode = '40001';
  end if;

  -- Let the original authoritative function retain its exact status/frozen error semantics.
  if v_batch_status <> 'staged' or v_frozen then
    return public.fn_review_reconciliation_row_unversioned(
      p_row_id,
      p_decision - 'expected_review_version'
    );
  end if;

  if not (p_decision ? 'expected_review_version') then
    -- Backward-safe only for a row that has never had a decision or any later mutation. Two tokenless
    -- first writers still serialize: the first increments review_version and the second fails here.
    if v_current_reviewed_at is not null or v_current_review_version <> 0 then
      raise exception 'reconciliation: row changed after it was loaded' using errcode = '40001';
    end if;
  elsif jsonb_typeof(p_decision->'expected_review_version') = 'number'
        and (p_decision->>'expected_review_version') ~ '^(0|[1-9][0-9]{0,9})$' then
    begin
      v_expected_review_version := (p_decision->>'expected_review_version')::integer;
    exception when numeric_value_out_of_range then
      raise exception 'decision.expected_review_version must be a nonnegative integer'
        using errcode = '22023';
    end;
  else
    raise exception 'decision.expected_review_version must be a nonnegative integer'
      using errcode = '22023';
  end if;

  if (p_decision ? 'expected_review_version')
     and v_current_review_version <> v_expected_review_version then
    raise exception 'reconciliation: row changed after it was loaded' using errcode = '40001';
  end if;

  v_result := public.fn_review_reconciliation_row_unversioned(
    p_row_id,
    p_decision - 'expected_review_version'
  );
  return v_result || jsonb_build_object(
    'review_version', (
      select br.review_version
        from public.reconciliation_batch_rows br
       where br.id = p_row_id
    )
  );
end;
$$;

revoke execute on function public.fn_review_reconciliation_row(uuid, jsonb) from public, anon;
grant execute on function public.fn_review_reconciliation_row(uuid, jsonb) to authenticated;

comment on function public.fn_review_reconciliation_row(uuid, jsonb) is
  'Saves one typed reconciliation decision only when expected_review_version still matches under lock.';

commit;
