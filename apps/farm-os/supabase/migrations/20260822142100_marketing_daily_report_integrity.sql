-- SPEC-0032: make daily marketing report totals canonical at the database boundary.
-- Security: the trigger covers every insert/update path, including direct authenticated RPC calls.
-- Rollback: drop trigger canonicalize_marketing_daily_report and function
-- public.fn_canonicalize_marketing_daily_report(); existing canonical rows remain valid.

create or replace function public.fn_canonicalize_marketing_daily_report()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_date text;
  v_seller text;
  v_buyer text;
  v_witnesses text;
  v_notes text;
  v_line jsonb;
  v_expense jsonb;
  v_sector text;
  v_channel text;
  v_name text;
  v_qty numeric;
  v_price numeric;
  v_expense_amount numeric;
  v_qty_total numeric := 0;
  v_revenue_total numeric := 0;
  v_expense_total numeric := 0;
  v_net numeric;
  v_avg_gross numeric;
  v_avg_net numeric;
  v_avg_cost numeric;
  v_lines jsonb := '[]'::jsonb;
  v_expenses jsonb := '[]'::jsonb;
  v_sectors jsonb := '[]'::jsonb;
begin
  if new.record_type <> 'daily_sales_report' then
    return new;
  end if;

  if jsonb_typeof(new.payload) is distinct from 'object' then
    raise exception 'daily sales report payload must be an object' using errcode = '22023';
  end if;
  v_date := new.payload->>'date';
  if v_date is null or v_date !~ '^\d{4}-\d{2}-\d{2}$'
     or to_char(to_date(v_date, 'YYYY-MM-DD'), 'YYYY-MM-DD') <> v_date then
    raise exception 'daily sales report date is invalid' using errcode = '22023';
  end if;
  if jsonb_typeof(new.payload->'lines') is distinct from 'array'
     or jsonb_array_length(new.payload->'lines') < 1
     or jsonb_array_length(new.payload->'lines') > 100 then
    raise exception 'daily sales report requires 1 to 100 sale lines' using errcode = '22023';
  end if;
  if new.payload ? 'expenseItems'
     and (jsonb_typeof(new.payload->'expenseItems') is distinct from 'array'
       or jsonb_array_length(new.payload->'expenseItems') > 100) then
    raise exception 'daily sales report expense items are invalid' using errcode = '22023';
  end if;

  v_seller := btrim(coalesce(new.payload->>'seller', ''));
  v_buyer := btrim(coalesce(new.payload->>'buyer', ''));
  v_witnesses := btrim(coalesce(new.payload->>'witnesses', ''));
  v_notes := btrim(coalesce(new.payload->>'notes', ''));
  if length(v_seller) > 120 or length(v_buyer) > 120 or length(v_witnesses) > 120
     or length(v_notes) > 2000 then
    raise exception 'daily sales report text is too long' using errcode = '22023';
  end if;

  for v_line in select value from jsonb_array_elements(new.payload->'lines') loop
    if jsonb_typeof(v_line) is distinct from 'object'
       or jsonb_typeof(v_line->'qtyKg') is distinct from 'number'
       or jsonb_typeof(v_line->'pricePerKg') is distinct from 'number' then
      raise exception 'daily sales report line is invalid' using errcode = '22023';
    end if;
    v_sector := btrim(coalesce(v_line->>'sector', ''));
    v_channel := btrim(coalesce(v_line->>'channel', ''));
    v_qty := (v_line->>'qtyKg')::numeric;
    v_price := (v_line->>'pricePerKg')::numeric;
    if v_sector = '' or length(v_sector) > 120 or length(v_channel) > 120
       or v_qty <= 0 or v_qty > 1000000000 or v_price <= 0 or v_price > 1000000000 then
      raise exception 'daily sales report line values are invalid' using errcode = '22023';
    end if;
    if v_channel = '' then v_channel := 'بيع'; end if;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'sector', v_sector, 'channel', v_channel, 'qtyKg', v_qty, 'pricePerKg', v_price
    ));
    v_qty_total := v_qty_total + v_qty;
    v_revenue_total := v_revenue_total + (v_qty * v_price);
  end loop;

  for v_expense in select value from jsonb_array_elements(coalesce(new.payload->'expenseItems', '[]'::jsonb)) loop
    if jsonb_typeof(v_expense) is distinct from 'object'
       or jsonb_typeof(v_expense->'amount') is distinct from 'number' then
      raise exception 'daily sales report expense item is invalid' using errcode = '22023';
    end if;
    v_name := btrim(coalesce(v_expense->>'name', ''));
    v_expense_amount := (v_expense->>'amount')::numeric;
    if v_name = '' or length(v_name) > 120 or v_expense_amount <= 0 or v_expense_amount > 1000000000000 then
      raise exception 'daily sales report expense values are invalid' using errcode = '22023';
    end if;
    v_expenses := v_expenses || jsonb_build_array(jsonb_build_object('name', v_name, 'amount', v_expense_amount));
    v_expense_total := v_expense_total + v_expense_amount;
  end loop;

  v_net := v_revenue_total - v_expense_total;
  v_avg_gross := v_revenue_total / v_qty_total;
  v_avg_net := v_net / v_qty_total;
  v_avg_cost := v_expense_total / v_qty_total;

  for v_line in select value from jsonb_array_elements(v_lines) loop
    v_qty := (v_line->>'qtyKg')::numeric;
    v_price := (v_line->>'pricePerKg')::numeric;
    v_sectors := v_sectors || jsonb_build_array(jsonb_build_object(
      'name', v_line->>'sector',
      'channel', v_line->>'channel',
      'qtyKg', v_qty,
      'pricePerKg', v_price,
      'revenueShare', v_qty * v_price,
      'expenseShare', v_qty * v_avg_cost,
      'netShare', (v_qty * v_price) - (v_qty * v_avg_cost)
    ));
  end loop;

  new.title := 'تقرير مبيعات يوم ' || v_date;
  new.amount := v_net;
  new.status := case when v_net >= 0 then 'profit' else 'loss' end;
  new.payload := jsonb_build_object(
    'date', v_date,
    'seller', v_seller,
    'buyer', v_buyer,
    'witnesses', v_witnesses,
    'notes', v_notes,
    'lines', v_lines,
    'expenseItems', v_expenses,
    'sectors', v_sectors,
    'qtyKg', v_qty_total,
    'totalRevenue', v_revenue_total,
    'totalExpenses', v_expense_total,
    'netAfterExpenses', v_net,
    'avgPriceGross', v_avg_gross,
    'avgPriceNet', v_avg_net,
    'avgCostPerKg', v_avg_cost
  );
  return new;
end;
$$;

revoke execute on function public.fn_canonicalize_marketing_daily_report() from public, anon, authenticated;

drop trigger if exists canonicalize_marketing_daily_report on public.marketing_record;
create trigger canonicalize_marketing_daily_report
  before insert or update on public.marketing_record
  for each row execute function public.fn_canonicalize_marketing_daily_report();
