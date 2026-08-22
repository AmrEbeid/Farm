-- SPEC-0032: persist the operator's contact status without replacing imported provenance metadata.
-- Security: delegates the org/role gate to fn_save_marketing_contact, then atomically changes only
-- metadata.status. Rollback: drop public.fn_save_marketing_contact_v3(...).

create or replace function public.fn_save_marketing_contact_v3(
  p_id uuid,
  p_org uuid,
  p_name text,
  p_phone text,
  p_email text,
  p_org_name text,
  p_category text,
  p_source text,
  p_notes text,
  p_selected boolean default false,
  p_source_key text default null,
  p_status text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_id uuid;
begin
  if p_status is not null and p_status not in (
    'لم يبدأ', 'لم يتم التواصل', 'تم التواصل', 'تم إرسال العرض', 'بانتظار الرد', 'مهتم',
    'طلب معاينة', 'طلب عينة', 'طلب عرض سعر', 'تفاوض', 'تم الاتفاق', 'غير مهتم', 'غير مناسب'
  ) then
    raise exception 'invalid marketing contact status' using errcode = '22023';
  end if;

  v_row := public.fn_save_marketing_contact(
    p_id, p_org, p_name, p_phone, p_email, p_org_name, p_category,
    p_source, p_notes, p_selected, p_source_key
  );
  v_id := (v_row->>'id')::uuid;

  update public.marketing_contact
  set metadata = case
        when p_status is null then metadata - 'status'
        else jsonb_set(metadata, '{status}', to_jsonb(p_status), true)
      end,
      updated_at = now()
  where id = v_id
  returning to_jsonb(marketing_contact.*) into v_row;

  return v_row;
end;
$$;

revoke execute on function public.fn_save_marketing_contact_v3(
  uuid, uuid, text, text, text, text, text, text, text, boolean, text, text
) from public, anon;
grant execute on function public.fn_save_marketing_contact_v3(
  uuid, uuid, text, text, text, text, text, text, text, boolean, text, text
) to authenticated;
