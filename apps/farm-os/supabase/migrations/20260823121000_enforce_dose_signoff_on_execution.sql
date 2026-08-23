-- A fertilizer or spray operation is an editable template until both agronomy sign-off fields
-- are recorded. Enforce that product rule at the status transition so every write path, including
-- a direct fn_execute_operation RPC call, fails atomically instead of relying on a UI affordance.

begin;

create or replace function public.enforce_plan_operation_dose_signoff()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status = 'done'
     and new.subtype in ('fertilization', 'spraying')
     and (new.signed_off_by is null or new.signed_off_at is null) then
    raise exception 'dose-bearing operation requires complete agronomy sign-off before execution'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists plan_operations_require_complete_dose_signoff on public.plan_operations;
drop trigger if exists aa_plan_operations_require_complete_dose_signoff_insert on public.plan_operations;
drop trigger if exists aa_plan_operations_require_complete_dose_signoff_update on public.plan_operations;

create trigger aa_plan_operations_require_complete_dose_signoff_insert
before insert on public.plan_operations
for each row execute function public.enforce_plan_operation_dose_signoff();

-- The resulting row must stay valid whichever relevant field changes. The `aa_` prefix makes this
-- invariant run before the older sign-off authorization trigger, yielding the precise invariant
-- error when someone tries to clear sign-off from an already completed dose.
create trigger aa_plan_operations_require_complete_dose_signoff_update
before update of status, subtype, signed_off_by, signed_off_at on public.plan_operations
for each row execute function public.enforce_plan_operation_dose_signoff();

revoke all on function public.enforce_plan_operation_dose_signoff() from public;
revoke execute on function public.enforce_plan_operation_dose_signoff() from anon, authenticated;

comment on function public.enforce_plan_operation_dose_signoff() is
  'Rejects transition to done for fertilization or spraying until signed_off_by and signed_off_at are both recorded.';

commit;
