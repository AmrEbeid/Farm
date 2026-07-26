begin;

-- Frozen reconciliation rows are immutable through privileged paths as well as
-- normal client paths. Only execution bookkeeping may change after freezing.
create or replace function public.fn_guard_frozen_batch_row_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.frozen = true then
      raise exception 'reconciliation_batch_rows: cannot delete a frozen row'
        using errcode = '22023';
    end if;
    return old;
  end if;

  if old.frozen = true then
    if new.frozen = false then
      raise exception 'reconciliation_batch_rows: cannot unfreeze a frozen row'
        using errcode = '22023';
    end if;

    if (to_jsonb(new) - 'execution_result' - 'execution_error')
      is distinct from
      (to_jsonb(old) - 'execution_result' - 'execution_error')
    then
      raise exception
        'reconciliation_batch_rows: frozen row - only execution_result/execution_error may change'
        using errcode = '22023';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.fn_guard_frozen_batch_row_immutable()
  from public, anon, authenticated;

drop trigger if exists guard_frozen_batch_row_immutable
  on public.reconciliation_batch_rows;
create trigger guard_frozen_batch_row_immutable
  before update or delete on public.reconciliation_batch_rows
  for each row execute function public.fn_guard_frozen_batch_row_immutable();

commit;
