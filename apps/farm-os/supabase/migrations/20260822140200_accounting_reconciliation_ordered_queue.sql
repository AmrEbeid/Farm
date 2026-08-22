-- Give the daily reconciliation queue the same deterministic evidence-locator order as the
-- acceptance report without transferring or materialising every detailed row in the application.
-- This migration is additive and read-only: one private pure sort-key helper and one public page RPC.

begin;

create or replace function private.fn_reconciliation_natural_sort_key(p_value text)
returns bytea[]
language plpgsql
immutable
strict
parallel safe
security invoker
set search_path = ''
as $$
declare
  v_match text[];
  v_segment text;
  v_significant text;
  v_text_key bytea;
  v_codepoint integer;
  v_code_unit integer;
  v_index integer;
  v_key bytea[] := array[]::bytea[];
begin
  -- Mirrors compareLocatorText(): alternating ASCII digit/non-digit runs; digit runs compare by
  -- significant length, value, then original padding. Text runs use UTF-16 code-unit order because
  -- JavaScript relational string comparison is defined over UTF-16 code units.
  for v_match in
    select m
      from pg_catalog.regexp_matches(p_value, '([0-9]+|[^0-9]+)', 'g') as m
  loop
    v_segment := v_match[1];
    if v_segment ~ '^[0-9]+$' then
      v_significant := pg_catalog.ltrim(v_segment, '0');
      if v_significant = '' then
        v_significant := '0';
      end if;
      v_key := pg_catalog.array_append(
        v_key,
        '\x01'::bytea || pg_catalog.convert_to(
          ''
          || pg_catalog.lpad(pg_catalog.length(v_significant)::text, 20, '0')
          || ':' || v_significant
          || ':' || pg_catalog.lpad(pg_catalog.length(v_segment)::text, 20, '0'),
          'UTF8'
        )
      );
    else
      v_text_key := case when pg_catalog.ascii(v_segment) < 48 then '\x00'::bytea else '\x02'::bytea end;
      for v_index in 1..pg_catalog.char_length(v_segment) loop
        v_codepoint := pg_catalog.ascii(pg_catalog.substr(v_segment, v_index, 1));
        if v_codepoint <= 65535 then
          v_text_key := v_text_key || pg_catalog.decode(
            pg_catalog.lpad(pg_catalog.to_hex(v_codepoint), 4, '0'),
            'hex'
          );
        else
          v_codepoint := v_codepoint - 65536;
          v_code_unit := 55296 + (v_codepoint / 1024);
          v_text_key := v_text_key || pg_catalog.decode(
            pg_catalog.lpad(pg_catalog.to_hex(v_code_unit), 4, '0'),
            'hex'
          );
          v_code_unit := 56320 + (v_codepoint % 1024);
          v_text_key := v_text_key || pg_catalog.decode(
            pg_catalog.lpad(pg_catalog.to_hex(v_code_unit), 4, '0'),
            'hex'
          );
        end if;
      end loop;
      v_key := pg_catalog.array_append(v_key, v_text_key);
    end if;
  end loop;
  return v_key;
end;
$$;

revoke execute on function private.fn_reconciliation_natural_sort_key(text)
  from public, anon;
grant execute on function private.fn_reconciliation_natural_sort_key(text)
  to authenticated;

comment on function private.fn_reconciliation_natural_sort_key(text) is
  'Pure natural-sort key used by the bounded reconciliation queue page RPC; reads no application data.';

create or replace function public.fn_reconciliation_queue_page(
  p_org uuid,
  p_batch_id uuid,
  p_classification text default null,
  p_state text default null,
  p_quality text default null,
  p_page integer default 1,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  c_version constant text := 'farm-os.reconciliation-queue-page.v2';
  v_batch_rows integer;
  v_evidence_rows integer;
  v_unreviewed integer;
  v_included integer;
  v_held integer;
  v_rejected integer;
  v_frozen integer;
  v_executed integer;
  v_total integer;
  v_page_count integer;
  v_page integer;
  v_offset integer;
  v_rows jsonb;
begin
  if p_org is null or p_batch_id is null then
    raise exception 'reconciliation queue: organization and batch are required'
      using errcode = '22023';
  end if;
  if p_page is null or p_page < 1 then
    raise exception 'reconciliation queue: page must be a positive integer'
      using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'reconciliation queue: limit must be between 1 and 50'
      using errcode = '22023';
  end if;
  if p_classification is not null and p_classification not in (
    'source_addition_candidate', 'amount_correction_candidate',
    'production_orphan_candidate', 'zero_value_source_placeholder',
    'ambiguous_identity_group'
  ) then
    raise exception 'reconciliation queue: invalid classification filter'
      using errcode = '22023';
  end if;
  if p_state is not null and p_state not in (
    'unreviewed', 'included', 'held', 'rejected', 'frozen'
  ) then
    raise exception 'reconciliation queue: invalid state filter'
      using errcode = '22023';
  end if;
  if p_quality is not null and p_quality not in (
    'invalid_source_date', 'missing_source_amount', 'unlinked_correction'
  ) then
    raise exception 'reconciliation queue: invalid quality filter'
      using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.user_org_ids() as scoped(org_id) where scoped.org_id = p_org
  ) then
    raise exception 'reconciliation queue: not a member of the active organization'
      using errcode = '42501';
  end if;
  if not public.authorize('finance.read', p_org) then
    raise exception 'reconciliation queue: owner or accountant role required'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
      from public.reconciliation_batches b
     where b.id = p_batch_id and b.org_id = p_org
  ) then
    return pg_catalog.jsonb_build_object('version', c_version, 'status', 'not_found');
  end if;

  select
    pg_catalog.count(*)::integer,
    pg_catalog.count(e.id)::integer,
    (pg_catalog.count(*) filter (where r.review_state = 'unreviewed'))::integer,
    (pg_catalog.count(*) filter (where r.disposition = 'include'))::integer,
    pg_catalog.count(*) filter (
      where r.review_state = 'reviewed' and r.disposition = 'hold'
    )::integer,
    (pg_catalog.count(*) filter (where r.review_state = 'rejected'))::integer,
    (pg_catalog.count(*) filter (where r.frozen))::integer,
    (pg_catalog.count(*) filter (where r.execution_result in ('posted', 'reversed')))::integer
    into
      v_batch_rows, v_evidence_rows, v_unreviewed, v_included,
      v_held, v_rejected, v_frozen, v_executed
    from public.reconciliation_batch_rows r
    left join public.reconciliation_evidence_items e
      on e.id = r.evidence_item_id and e.org_id = r.org_id
   where r.batch_id = p_batch_id and r.org_id = p_org;

  if v_batch_rows <> v_evidence_rows then
    return pg_catalog.jsonb_build_object(
      'version', c_version,
      'status', 'incomplete',
      'row_count', v_batch_rows,
      'rows_with_evidence', v_evidence_rows
    );
  end if;

  select pg_catalog.count(*)::integer
    into v_total
    from public.reconciliation_batch_rows r
    join public.reconciliation_evidence_items e
      on e.id = r.evidence_item_id and e.org_id = r.org_id
    where r.batch_id = p_batch_id
      and r.org_id = p_org
      and (p_classification is null or e.classification = p_classification)
      and (
        p_state is null
        or (p_state = 'unreviewed' and r.review_state = 'unreviewed')
        or (p_state = 'included' and r.disposition = 'include')
        or (p_state = 'held' and r.review_state = 'reviewed' and r.disposition = 'hold')
        or (p_state = 'rejected' and r.review_state = 'rejected')
        or (p_state = 'frozen' and r.frozen)
      )
      and (
        p_quality is null
        or (p_quality = 'invalid_source_date' and e.invalid_calendar_quality_flag)
        or (p_quality = 'missing_source_amount' and e.source_amount is null)
        or (
          p_quality = 'unlinked_correction'
          and e.classification = 'amount_correction_candidate'
          and r.corrects_expense_id is null
          and r.corrects_sale_id is null
        )
      );

  v_page_count := greatest(1, pg_catalog.ceil(v_total::numeric / p_limit)::integer);
  v_page := least(p_page, v_page_count);
  v_offset := (v_page - 1) * p_limit;

  with filtered as materialized (
    select
      r.id,
      r.evidence_item_id,
      case e.origin_kind
        when 'source_workbook_row' then 0
        when 'production_snapshot_row' then 1
        else 2
      end as origin_rank,
      private.fn_reconciliation_natural_sort_key(coalesce(e.sheet_name, '')) as sheet_key,
      private.fn_reconciliation_natural_sort_key(coalesce(e.row_locator, '')) as row_key,
      private.fn_reconciliation_natural_sort_key(
        coalesce(e.snapshot_target_table, '')
      ) as target_table_key,
      private.fn_reconciliation_natural_sort_key(
        coalesce(e.snapshot_target_id::text, '')
      ) as target_id_key
    from public.reconciliation_batch_rows r
    join public.reconciliation_evidence_items e
      on e.id = r.evidence_item_id and e.org_id = r.org_id
    where r.batch_id = p_batch_id
      and r.org_id = p_org
      and (p_classification is null or e.classification = p_classification)
      and (
        p_state is null
        or (p_state = 'unreviewed' and r.review_state = 'unreviewed')
        or (p_state = 'included' and r.disposition = 'include')
        or (p_state = 'held' and r.review_state = 'reviewed' and r.disposition = 'hold')
        or (p_state = 'rejected' and r.review_state = 'rejected')
        or (p_state = 'frozen' and r.frozen)
      )
      and (
        p_quality is null
        or (p_quality = 'invalid_source_date' and e.invalid_calendar_quality_flag)
        or (p_quality = 'missing_source_amount' and e.source_amount is null)
        or (
          p_quality = 'unlinked_correction'
          and e.classification = 'amount_correction_candidate'
          and r.corrects_expense_id is null
          and r.corrects_sale_id is null
        )
      )
  ), paged as materialized (
    select
      f.id,
      pg_catalog.row_number() over (
        order by
          f.origin_rank,
          f.sheet_key,
          f.row_key,
          f.target_table_key,
          f.target_id_key,
          f.evidence_item_id
      ) as ordinal
    from filtered f
    order by
      f.origin_rank,
      f.sheet_key,
      f.row_key,
      f.target_table_key,
      f.target_id_key,
      f.evidence_item_id
    offset v_offset
    limit p_limit
  )
  select coalesce(pg_catalog.jsonb_agg(
      pg_catalog.to_jsonb(r) || pg_catalog.jsonb_build_object(
        'evidence', pg_catalog.to_jsonb(e),
        'expense_account', case when expense_account.id is null then null else
          pg_catalog.jsonb_build_object('code', expense_account.code, 'name_ar', expense_account.name_ar) end,
        'expense_cost_center', case when expense_cost_center.id is null then null else
          pg_catalog.jsonb_build_object('code', expense_cost_center.code, 'name_ar', expense_cost_center.name_ar) end,
        'expense_supplier', case when expense_supplier.id is null then null else
          pg_catalog.jsonb_build_object('name', expense_supplier.name) end,
        'sale_buyer', case when sale_buyer.id is null then null else
          pg_catalog.jsonb_build_object('name', sale_buyer.name) end,
        'sale_cost_center', case when sale_cost_center.id is null then null else
          pg_catalog.jsonb_build_object('code', sale_cost_center.code, 'name_ar', sale_cost_center.name_ar) end,
        'sale_farm', case when sale_farm.id is null then null else
          pg_catalog.jsonb_build_object('name', sale_farm.name) end,
        'sale_sector', case when sale_sector.id is null then null else
          pg_catalog.jsonb_build_object('name', sale_sector.name) end,
        'sale_hawsha', case when sale_hawsha.id is null then null else
          pg_catalog.jsonb_build_object('code', sale_hawsha.code, 'name', sale_hawsha.name) end,
        'correction_expense', case when correction_expense.id is null then null else
          pg_catalog.jsonb_build_object(
            'id', correction_expense.id, 'date', correction_expense.date,
            'category', correction_expense.category, 'description', correction_expense.description,
            'total', correction_expense.total
          ) end,
        'correction_sale', case when correction_sale.id is null then null else
          pg_catalog.jsonb_build_object(
            'id', correction_sale.id, 'sale_date', correction_sale.sale_date,
            'crop', correction_sale.crop, 'notes', correction_sale.notes,
            'total', correction_sale.total
          ) end
      ) order by page_rows.ordinal
    ), '[]'::jsonb)
    into v_rows
    from paged page_rows
    join public.reconciliation_batch_rows r
      on r.id = page_rows.id and r.batch_id = p_batch_id and r.org_id = p_org
    join public.reconciliation_evidence_items e
      on e.id = r.evidence_item_id and e.org_id = r.org_id
    left join public.accounts expense_account
      on expense_account.id = r.expense_account_id and expense_account.org_id = r.org_id
    left join public.cost_centers expense_cost_center
      on expense_cost_center.id = r.expense_cost_center_id and expense_cost_center.org_id = r.org_id
    left join public.suppliers expense_supplier
      on expense_supplier.id = r.expense_supplier_id and expense_supplier.org_id = r.org_id
    left join public.buyers sale_buyer
      on sale_buyer.id = r.sale_buyer_id and sale_buyer.org_id = r.org_id
    left join public.cost_centers sale_cost_center
      on sale_cost_center.id = r.sale_cost_center_id and sale_cost_center.org_id = r.org_id
    left join public.farms sale_farm
      on sale_farm.id = r.sale_farm_id and sale_farm.org_id = r.org_id
    left join public.sectors sale_sector
      on sale_sector.id = r.sale_sector_id and sale_sector.org_id = r.org_id
    left join public.hawshat sale_hawsha
      on sale_hawsha.id = r.sale_hawsha_id and sale_hawsha.org_id = r.org_id
    left join public.expenses correction_expense
      on correction_expense.id = r.corrects_expense_id and correction_expense.org_id = r.org_id
    left join public.sales correction_sale
      on correction_sale.id = r.corrects_sale_id and correction_sale.org_id = r.org_id;

  return pg_catalog.jsonb_build_object(
    'version', c_version,
    'status', 'ok',
    'total', v_total,
    'page', v_page,
    'page_size', p_limit,
    'counts', pg_catalog.jsonb_build_object(
      'total', v_batch_rows,
      'unreviewed', v_unreviewed,
      'included', v_included,
      'held', v_held,
      'rejected', v_rejected,
      'frozen', v_frozen,
      'executed', v_executed
    ),
    'rows', v_rows
  );
end;
$$;

revoke execute on function public.fn_reconciliation_queue_page(
  uuid, uuid, text, text, text, integer, integer
) from public, anon;
grant execute on function public.fn_reconciliation_queue_page(
  uuid, uuid, text, text, text, integer, integer
) to authenticated;

comment on function public.fn_reconciliation_queue_page(
  uuid, uuid, text, text, text, integer, integer
) is
  'Read-only active-org reconciliation queue page in the acceptance packet evidence-locator order.';

commit;
