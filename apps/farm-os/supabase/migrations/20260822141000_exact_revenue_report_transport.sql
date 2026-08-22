-- Exact transport for the full revenue/A-R report without changing its established accounting query.
-- The compatibility RPC remains available; this wrapper converts only known numeric money/quantity JSON
-- fields to text while they are still exact PostgreSQL jsonb numerics, before PostgREST/JavaScript parsing.

begin;

create or replace function private.fn_jsonb_numeric_keys_to_text(p_value jsonb, p_keys text[])
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_result jsonb := p_value;
  v_key text;
  v_type text;
begin
  if p_value is null or jsonb_typeof(p_value) <> 'object' then
    raise exception 'expected a JSON object for exact numeric transport' using errcode = '22023';
  end if;
  foreach v_key in array p_keys loop
    if not (v_result ? v_key) then
      raise exception 'exact numeric transport key % is missing', v_key using errcode = '22023';
    end if;
    v_type := jsonb_typeof(v_result -> v_key);
    if v_type = 'number' then
      v_result := jsonb_set(v_result, array[v_key], to_jsonb(v_result ->> v_key));
    elsif v_type <> 'null' then
      raise exception 'exact numeric transport key % has type %, expected number or null', v_key, v_type
        using errcode = '22023';
    end if;
  end loop;
  return v_result;
end;
$$;
revoke all on function private.fn_jsonb_numeric_keys_to_text(jsonb, text[]) from public, anon, authenticated;

create or replace function private.fn_jsonb_array_numeric_keys_to_text(p_value jsonb, p_keys text[])
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if p_value is null or jsonb_typeof(p_value) <> 'array' then
    raise exception 'expected a JSON array for exact numeric transport' using errcode = '22023';
  end if;
  select coalesce(
    jsonb_agg(private.fn_jsonb_numeric_keys_to_text(item.value, p_keys) order by item.ordinality),
    '[]'::jsonb
  )
  into v_result
  from jsonb_array_elements(p_value) with ordinality as item(value, ordinality);
  return v_result;
end;
$$;
revoke all on function private.fn_jsonb_array_numeric_keys_to_text(jsonb, text[]) from public, anon, authenticated;

create or replace function public.fn_revenue_sales_report_exact(
  p_org uuid,
  p_period_start date default null,
  p_period_end date default null,
  p_as_of date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_report jsonb;
begin
  if p_org is null then raise exception 'org required' using errcode = '23502'; end if;
  if p_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org exact revenue report' using errcode = '42501';
  end if;
  if not public.authorize('finance.read', p_org) then
    raise exception 'forbidden: finance.read is required' using errcode = '42501';
  end if;

  v_report := public.fn_revenue_sales_report(p_org, p_period_start, p_period_end, p_as_of);
  v_report := private.fn_jsonb_numeric_keys_to_text(
    v_report,
    array['finalized_revenue', 'period_collections', 'outstanding_total', 'over_30_amount', 'pending_qty']
  );
  v_report := jsonb_set(v_report, '{sales}', private.fn_jsonb_array_numeric_keys_to_text(
    v_report -> 'sales',
    array['qty', 'unit_price', 'total', 'collected_to_as_of', 'collected_in_period', 'outstanding']
  ));
  v_report := jsonb_set(v_report, '{by_buyer}', private.fn_jsonb_array_numeric_keys_to_text(
    v_report -> 'by_buyer',
    array['qty', 'finalized_revenue', 'collected_in_period', 'collected_to_as_of', 'outstanding']
  ));
  v_report := jsonb_set(v_report, '{by_crop_season}', private.fn_jsonb_array_numeric_keys_to_text(
    v_report -> 'by_crop_season',
    array['qty', 'finalized_revenue', 'collected_in_period', 'outstanding']
  ));
  v_report := jsonb_set(v_report, '{ar_rows}', private.fn_jsonb_array_numeric_keys_to_text(
    v_report -> 'ar_rows', array['total', 'collected_to_as_of', 'outstanding']
  ));
  v_report := jsonb_set(v_report, '{collections}', private.fn_jsonb_array_numeric_keys_to_text(
    v_report -> 'collections', array['amount']
  ));
  return v_report;
end;
$$;
revoke execute on function public.fn_revenue_sales_report_exact(uuid, date, date, date)
  from public, anon, authenticated;
grant execute on function public.fn_revenue_sales_report_exact(uuid, date, date, date) to authenticated;

commit;
