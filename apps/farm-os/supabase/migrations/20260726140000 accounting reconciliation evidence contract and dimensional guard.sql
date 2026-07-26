-- Accounting reconciliation — slice 4A (DB/data-contract hardening for the review UI).
-- Source: SPEC-0004 §8 review workspace; independent-review REQUEST CHANGES (P1 source-evidence
-- contract + P1 dimensional integrity). Append-only, additive; existing production reconciliation
-- tables are empty (0/0/0) and this migration stages NO data.
--
-- SCOPE (three things, all reconciliation-only — NO money write, NO execution/rollback RPC):
--   1) add nullable evidence_label text to reconciliation_evidence_items;
--   2) re-emit fn_reconciliation_validate_staging_manifest + fn_stage_reconciliation_manifest so the
--      ENRICHED exact manifest (evidence_label + source_amount + source_date_text + source_date_parsed
--      per evidence item) validates, inserts, and replays idempotently, failing closed on a malformed
--      amount/date/label. ALL existing authz, grants, advisory locks, portable sha-256 hashes, exact-key
--      validation, count reconciliation, and deterministic-id/replay integrity are preserved verbatim;
--      the ONLY changes are the four new evidence keys (validated + persisted) and the replay/preflight
--      byte comparisons that used to assert those source columns null now comparing them to the manifest.
--   3) re-emit fn_guard_reconciliation_batch_row_tenant with EVERY existing tenant/correction check plus:
--      a sale farm→sector→hawsha hierarchy (a set sector needs a farm it belongs to; a set hawsha needs a
--      sector it belongs to; farm-only and sector-with-farm are allowed), and — for an INCLUDED expense —
--      the posting account must be active, have kind = expense_kind, and have no active children (leaf).
--
-- BACKWARD SAFETY. evidence_label is nullable, so historical rows / older pgTAP fixtures that never set
-- it stay valid. The derived-field consistency rule only constrains a manifest's own bytes; it never
-- rewrites an existing row.
--
-- ROLLBACK RUNBOOK (exact):
--   begin;
--   -- re-emit the three functions from migration "20260726120000 accounting reconciliation review rpcs.sql"
--   -- (validator + stage RPC) and "20260725201546_accounting_reconciliation_provenance.sql" (tenant guard)
--   -- verbatim — i.e. WITHOUT the four evidence keys and WITHOUT the hierarchy/account checks.
--   drop function if exists public.fn_reconciliation_is_real_calendar_date(text);
--   alter table public.reconciliation_evidence_items drop column if exists evidence_label;
--   commit;
-- A fresh-DB replay after this rollback is byte-identical to a DB that never had this migration.

begin;

-- ── 1) additive nullable column ───────────────────────────────────────────────────────────────────────
alter table public.reconciliation_evidence_items add column if not exists evidence_label text;

-- ── 2) helper: true only for a real Gregorian calendar date (rejects 2024-02-30, 2024-13-01, …). The
--    strict `::date` cast raises on an impossible date; the exception block turns that into `false`
--    instead of aborting. Revoked from every client role — reachable only from the validator. ──────────
create or replace function public.fn_reconciliation_is_real_calendar_date(p_text text)
returns boolean
language plpgsql
immutable
security definer
set search_path = ''
as $$
begin
  if p_text is null or p_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    return false;
  end if;
  -- A strict cast rejects 2024-02-30; to_char round-trip rejects any silent normalization.
  return to_char(p_text::date, 'YYYY-MM-DD') = p_text;
exception
  when others then
    return false;
end;
$$;
revoke execute on function public.fn_reconciliation_is_real_calendar_date(text)
  from public, anon, authenticated;

-- ── 3) re-emit the staging manifest validator (enriched evidence contract). Everything below is the
--    20260726120000 body verbatim EXCEPT: the evidence_item exact-key set gains the four new keys, and a
--    per-item block validates evidence_label + source_amount + source_date_text + source_date_parsed. ──
create or replace function public.fn_reconciliation_validate_staging_manifest(p_org uuid, p_manifest jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c_max_rows constant int := 1000;
  c_classes constant text[] := array[
    'source_addition_candidate','amount_correction_candidate','production_orphan_candidate',
    'zero_value_source_placeholder','ambiguous_identity_group'
  ];
  v_batch jsonb;
  v_summary jsonb;
  v_by_dataset jsonb;
  v_tool jsonb;
  v_quality jsonb;
  v_evidence jsonb;
  v_rows jsonb;
  v_batch_id uuid;
  v_source_sha text;
  v_snapshot_sha text;
  v_evidence_sha text;
  v_evidence_count int;
  v_row_count int;
  v_item jsonb;
  v_row jsonb;
  v_dataset text;
  v_origin text;
  v_position text;
  v_id uuid;
  v_evidence_id uuid;
  v_seen_evidence_ids uuid[] := array[]::uuid[];
  v_seen_row_ids uuid[] := array[]::uuid[];
  v_seen_row_evidence uuid[] := array[]::uuid[];
  v_seen_positions text[] := array[]::text[];
  v_dataset_count int;
  v_classification_sum int;
  v_quality_count int;
  v_declared int;
  v_key text;
begin
  perform public.fn_reconciliation_assert_exact_object_keys(
    p_manifest,
    array['batch','evidence_items','batch_rows','matched_invalid_calendar_quality_flags','tool_metadata'],
    'manifest');
  if jsonb_typeof(p_manifest->'batch') <> 'object'
    or jsonb_typeof(p_manifest->'evidence_items') <> 'array'
    or jsonb_typeof(p_manifest->'batch_rows') <> 'array'
    or jsonb_typeof(p_manifest->'matched_invalid_calendar_quality_flags') <> 'array'
    or jsonb_typeof(p_manifest->'tool_metadata') <> 'object'
  then
    raise exception 'manifest: batch/tool_metadata must be objects and row collections must be arrays'
      using errcode = '22023';
  end if;

  v_batch := p_manifest->'batch';
  v_evidence := p_manifest->'evidence_items';
  v_rows := p_manifest->'batch_rows';
  v_quality := p_manifest->'matched_invalid_calendar_quality_flags';
  v_tool := p_manifest->'tool_metadata';

  perform public.fn_reconciliation_assert_exact_object_keys(
    v_batch, array['id','org_id','source_workbook_sha256','status','result_summary'], 'manifest.batch');
  if jsonb_typeof(v_batch->'id') <> 'string'
    or jsonb_typeof(v_batch->'org_id') <> 'string'
    or jsonb_typeof(v_batch->'source_workbook_sha256') <> 'string'
    or jsonb_typeof(v_batch->'status') <> 'string'
    or jsonb_typeof(v_batch->'result_summary') <> 'object'
  then
    raise exception 'manifest.batch: invalid field type' using errcode = '22023';
  end if;
  v_batch_id := (v_batch->>'id')::uuid;
  if v_batch->>'org_id' <> p_org::text
    or (v_batch->>'org_id')::uuid <> p_org
    or v_batch->>'status' <> 'staged'
  then
    raise exception 'manifest.batch: org_id/status mismatch' using errcode = '22023';
  end if;
  v_source_sha := v_batch->>'source_workbook_sha256';
  if v_source_sha !~ '^[0-9a-f]{64}$' then
    raise exception 'manifest.batch: source_workbook_sha256 must be 64 lowercase hex characters'
      using errcode = '22023';
  end if;

  perform public.fn_reconciliation_assert_exact_object_keys(
    v_tool, array['production_snapshot_sha256','exception_evidence_sha256'], 'manifest.tool_metadata');
  if jsonb_typeof(v_tool->'production_snapshot_sha256') <> 'string'
    or jsonb_typeof(v_tool->'exception_evidence_sha256') <> 'string'
  then
    raise exception 'manifest.tool_metadata: hashes must be strings' using errcode = '22023';
  end if;
  v_snapshot_sha := v_tool->>'production_snapshot_sha256';
  v_evidence_sha := v_tool->>'exception_evidence_sha256';
  if v_snapshot_sha !~ '^[0-9a-f]{64}$' or v_evidence_sha !~ '^[0-9a-f]{64}$' then
    raise exception 'manifest.tool_metadata: hashes must be 64 lowercase hex characters'
      using errcode = '22023';
  end if;

  v_summary := v_batch->'result_summary';
  perform public.fn_reconciliation_assert_exact_object_keys(
    v_summary, array['evidence_item_count','batch_row_count','by_dataset'], 'manifest.batch.result_summary');
  if jsonb_typeof(v_summary->'evidence_item_count') <> 'number'
    or jsonb_typeof(v_summary->'batch_row_count') <> 'number'
    or (v_summary->>'evidence_item_count') !~ '^[0-9]+$'
    or (v_summary->>'batch_row_count') !~ '^[0-9]+$'
    or jsonb_typeof(v_summary->'by_dataset') <> 'object'
  then
    raise exception 'manifest.batch.result_summary: invalid counts/by_dataset' using errcode = '22023';
  end if;
  v_evidence_count := jsonb_array_length(v_evidence);
  v_row_count := jsonb_array_length(v_rows);
  if v_evidence_count < 1 or v_evidence_count > c_max_rows or v_row_count <> v_evidence_count
    or (v_summary->>'evidence_item_count')::int <> v_evidence_count
    or (v_summary->>'batch_row_count')::int <> v_row_count
  then
    raise exception 'manifest: row counts must agree and be within 1..%', c_max_rows using errcode = '22023';
  end if;
  if v_batch_id <> public.fn_reconciliation_stable_uuid(
    'reconciliation_batch', v_source_sha, v_snapshot_sha, p_org::text
  ) then
    raise exception 'manifest.batch: id does not match the Slice-2 deterministic identity'
      using errcode = '22023';
  end if;

  v_by_dataset := v_summary->'by_dataset';
  perform public.fn_reconciliation_assert_exact_object_keys(
    v_by_dataset, array['expense','sale'], 'manifest.batch.result_summary.by_dataset');
  foreach v_dataset in array array['expense','sale'] loop
    perform public.fn_reconciliation_assert_exact_object_keys(
      v_by_dataset->v_dataset,
      array['exception_row_count','source_occurrence_count','production_occurrence_count',
            'classification_counts','matched_invalid_calendar_quality_flag_count'],
      'manifest.batch.result_summary.by_dataset.' || v_dataset);
    if jsonb_typeof((v_by_dataset->v_dataset)->'classification_counts') <> 'object' then
      raise exception 'manifest summary: classification_counts must be an object' using errcode = '22023';
    end if;
    foreach v_key in array array[
      'exception_row_count','source_occurrence_count','production_occurrence_count',
      'matched_invalid_calendar_quality_flag_count'
    ] loop
      if jsonb_typeof((v_by_dataset->v_dataset)->v_key) <> 'number'
        or ((v_by_dataset->v_dataset)->>v_key) !~ '^[0-9]+$'
      then
        raise exception 'manifest summary: % must be a nonnegative integer', v_key using errcode = '22023';
      end if;
    end loop;
    v_classification_sum := 0;
    for v_key in select jsonb_object_keys((v_by_dataset->v_dataset)->'classification_counts') loop
      if not (v_key = any(c_classes))
        or jsonb_typeof(((v_by_dataset->v_dataset)->'classification_counts')->v_key) <> 'number'
        or (((v_by_dataset->v_dataset)->'classification_counts')->>v_key) !~ '^[0-9]+$'
      then
        raise exception 'manifest summary: invalid classification count key/value' using errcode = '22023';
      end if;
      v_classification_sum := v_classification_sum
        + (((v_by_dataset->v_dataset)->'classification_counts')->>v_key)::int;
    end loop;
    select count(*)::int into v_dataset_count
      from jsonb_array_elements(v_evidence) e
     where e->>'dataset' = v_dataset;
    v_declared := ((v_by_dataset->v_dataset)->>'exception_row_count')::int;
    if v_dataset_count <> v_declared or v_classification_sum <> v_declared then
      raise exception 'manifest summary: % dataset counts do not reconcile', v_dataset using errcode = '22023';
    end if;
  end loop;

  for v_item in select * from jsonb_array_elements(v_evidence) loop
    perform public.fn_reconciliation_assert_exact_object_keys(
      v_item,
      array['id','org_id','origin_kind','dataset','classification','source_workbook_sha256',
            'sheet_name','row_locator','production_snapshot_sha256','snapshot_target_table',
            'snapshot_target_id','source_identity_fingerprint','invalid_calendar_quality_flag',
            'first_staged_batch_id',
            'evidence_label','source_amount','source_date_text','source_date_parsed'],
      'manifest.evidence_item');
    if jsonb_typeof(v_item->'id') <> 'string'
      or jsonb_typeof(v_item->'org_id') <> 'string'
      or jsonb_typeof(v_item->'origin_kind') <> 'string'
      or jsonb_typeof(v_item->'dataset') <> 'string'
      or jsonb_typeof(v_item->'classification') <> 'string'
      or jsonb_typeof(v_item->'invalid_calendar_quality_flag') <> 'boolean'
      or jsonb_typeof(v_item->'first_staged_batch_id') <> 'string'
      or jsonb_typeof(v_item->'source_identity_fingerprint') not in ('string','null')
    then
      raise exception 'manifest.evidence_item: invalid field type' using errcode = '22023';
    end if;
    v_id := (v_item->>'id')::uuid;
    if v_id = any(v_seen_evidence_ids) then
      raise exception 'manifest: duplicate evidence id' using errcode = '22023';
    end if;
    v_seen_evidence_ids := array_append(v_seen_evidence_ids, v_id);
    if v_item->>'org_id' <> p_org::text
      or (v_item->>'org_id')::uuid <> p_org
      or (v_item->>'first_staged_batch_id')::uuid <> v_batch_id
      or not ((v_item->>'dataset') = any(array['expense','sale']))
      or not ((v_item->>'classification') = any(c_classes))
    then
      raise exception 'manifest.evidence_item: org/batch/dataset/classification mismatch' using errcode = '22023';
    end if;
    v_origin := v_item->>'origin_kind';
    if v_origin = 'source_workbook_row' then
      if jsonb_typeof(v_item->'source_workbook_sha256') <> 'string'
        or v_item->>'source_workbook_sha256' <> v_source_sha
        or jsonb_typeof(v_item->'sheet_name') <> 'string'
        or length(v_item->>'sheet_name') = 0
        or jsonb_typeof(v_item->'row_locator') <> 'string'
        or length(v_item->>'row_locator') = 0
        or jsonb_typeof(v_item->'production_snapshot_sha256') <> 'null'
        or jsonb_typeof(v_item->'snapshot_target_table') <> 'null'
        or jsonb_typeof(v_item->'snapshot_target_id') <> 'null'
      then
        raise exception 'manifest.evidence_item: invalid source-workbook locator shape' using errcode = '22023';
      end if;
      if v_id <> public.fn_reconciliation_stable_uuid(
        'evidence_item','source_workbook_row',v_source_sha,
        v_item->>'sheet_name',v_item->>'row_locator'
      ) then
        raise exception 'manifest.evidence_item: id does not match its deterministic source position'
          using errcode = '22023';
      end if;
      v_position := 'source|' || v_source_sha || '|' || (v_item->>'sheet_name') || '|' || (v_item->>'row_locator');
    elsif v_origin = 'production_snapshot_row' then
      if jsonb_typeof(v_item->'production_snapshot_sha256') <> 'string'
        or v_item->>'production_snapshot_sha256' <> v_snapshot_sha
        or jsonb_typeof(v_item->'snapshot_target_table') <> 'string'
        or (v_item->>'snapshot_target_table') <> (
          case when v_item->>'dataset' = 'expense' then 'expenses' else 'sales' end
        )
        or jsonb_typeof(v_item->'snapshot_target_id') <> 'string'
        or jsonb_typeof(v_item->'source_workbook_sha256') <> 'null'
        or jsonb_typeof(v_item->'sheet_name') <> 'null'
        or jsonb_typeof(v_item->'row_locator') <> 'null'
      then
        raise exception 'manifest.evidence_item: invalid production-snapshot locator shape' using errcode = '22023';
      end if;
      perform (v_item->>'snapshot_target_id')::uuid;
      if v_id <> public.fn_reconciliation_stable_uuid(
        'evidence_item','production_snapshot_row',v_snapshot_sha,
        v_item->>'snapshot_target_table',v_item->>'snapshot_target_id'
      ) then
        raise exception 'manifest.evidence_item: id does not match its deterministic snapshot position'
          using errcode = '22023';
      end if;
      v_position := 'snapshot|' || v_snapshot_sha || '|' || (v_item->>'snapshot_target_table')
        || '|' || (v_item->>'snapshot_target_id');
    else
      raise exception 'manifest.evidence_item: invalid origin_kind' using errcode = '22023';
    end if;

    -- Slice 4A evidence contract: a nonempty label on every row; the source-only amount/date fields
    -- must be null for a production-snapshot row, and — for a source row — an exact nonnegative decimal
    -- string / ISO date text / real-calendar parsed date derived by the fixed rule (parsed equals the
    -- text only when the text is a real calendar date and the invalid-calendar flag is false).
    if jsonb_typeof(v_item->'evidence_label') <> 'string' or length(v_item->>'evidence_label') = 0 then
      raise exception 'manifest.evidence_item: evidence_label must be a nonempty string' using errcode = '22023';
    end if;
    if v_origin = 'production_snapshot_row' then
      if jsonb_typeof(v_item->'source_amount') <> 'null'
        or jsonb_typeof(v_item->'source_date_text') <> 'null'
        or jsonb_typeof(v_item->'source_date_parsed') <> 'null'
      then
        raise exception 'manifest.evidence_item: a production-snapshot row carries no source amount/date'
          using errcode = '22023';
      end if;
    else
      if jsonb_typeof(v_item->'source_amount') not in ('string','null')
        or (jsonb_typeof(v_item->'source_amount') = 'string'
            and (v_item->>'source_amount') !~ '^[0-9]+(\.[0-9]+)?$')
      then
        raise exception 'manifest.evidence_item: source_amount must be a nonnegative decimal string or null'
          using errcode = '22023';
      end if;
      if jsonb_typeof(v_item->'source_date_text') not in ('string','null')
        or (jsonb_typeof(v_item->'source_date_text') = 'string'
            and (v_item->>'source_date_text') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
      then
        raise exception 'manifest.evidence_item: source_date_text must be an ISO-shaped date string or null'
          using errcode = '22023';
      end if;
      if jsonb_typeof(v_item->'source_date_parsed') not in ('string','null')
        or (jsonb_typeof(v_item->'source_date_parsed') = 'string'
            and (v_item->>'source_date_parsed') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
      then
        raise exception 'manifest.evidence_item: source_date_parsed must be a date string or null'
          using errcode = '22023';
      end if;
      declare
        v_text text := v_item->>'source_date_text';
        v_parsed text := v_item->>'source_date_parsed';
        v_flag boolean := (v_item->>'invalid_calendar_quality_flag')::boolean;
        v_expected text;
      begin
        if v_text is null or v_flag or not public.fn_reconciliation_is_real_calendar_date(v_text) then
          v_expected := null;
        else
          v_expected := v_text;
        end if;
        if v_parsed is distinct from v_expected then
          raise exception 'manifest.evidence_item: source_date_parsed does not match the derivation rule'
            using errcode = '22023';
        end if;
      end;
    end if;

    if v_position = any(v_seen_positions) then
      raise exception 'manifest: duplicate evidence position' using errcode = '22023';
    end if;
    v_seen_positions := array_append(v_seen_positions, v_position);
  end loop;

  for v_row in select * from jsonb_array_elements(v_rows) loop
    perform public.fn_reconciliation_assert_exact_object_keys(
      v_row,
      array['id','org_id','batch_id','evidence_item_id','review_state','target_table','disposition'],
      'manifest.batch_row');
    if jsonb_typeof(v_row->'id') <> 'string'
      or jsonb_typeof(v_row->'org_id') <> 'string'
      or jsonb_typeof(v_row->'batch_id') <> 'string'
      or jsonb_typeof(v_row->'evidence_item_id') <> 'string'
      or jsonb_typeof(v_row->'review_state') <> 'string'
      or jsonb_typeof(v_row->'target_table') <> 'null'
      or jsonb_typeof(v_row->'disposition') <> 'string'
    then
      raise exception 'manifest.batch_row: invalid field type/default' using errcode = '22023';
    end if;
    v_id := (v_row->>'id')::uuid;
    v_evidence_id := (v_row->>'evidence_item_id')::uuid;
    if v_id = any(v_seen_row_ids) or v_evidence_id = any(v_seen_row_evidence) then
      raise exception 'manifest: duplicate batch-row id or evidence reference' using errcode = '22023';
    end if;
    v_seen_row_ids := array_append(v_seen_row_ids, v_id);
    v_seen_row_evidence := array_append(v_seen_row_evidence, v_evidence_id);
    if v_id <> public.fn_reconciliation_stable_uuid(
      'reconciliation_batch_row',v_batch_id::text,v_evidence_id::text
    ) then
      raise exception 'manifest.batch_row: id does not match its deterministic batch/evidence identity'
        using errcode = '22023';
    end if;
    if v_row->>'org_id' <> p_org::text
      or (v_row->>'org_id')::uuid <> p_org
      or (v_row->>'batch_id')::uuid <> v_batch_id
      or not (v_evidence_id = any(v_seen_evidence_ids))
      or v_row->>'review_state' <> 'unreviewed'
      or v_row->>'disposition' <> 'hold'
    then
      raise exception 'manifest.batch_row: org/batch/link/default mismatch' using errcode = '22023';
    end if;
  end loop;
  if cardinality(v_seen_row_evidence) <> cardinality(v_seen_evidence_ids)
    or exists (
      select 1 from unnest(v_seen_evidence_ids) e_id
       where not (e_id = any(v_seen_row_evidence))
    )
  then
    raise exception 'manifest: evidence items and batch rows must map one-to-one' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(v_quality) loop
    perform public.fn_reconciliation_assert_exact_object_keys(
      v_item,
      array['dataset','source_workbook_sha256','sheet_name','row_locator',
            'source_date_text','legacy_import_date'],
      'manifest.matched_invalid_calendar_quality_flag');
    if jsonb_typeof(v_item->'dataset') <> 'string'
      or not ((v_item->>'dataset') = any(array['expense','sale']))
      or jsonb_typeof(v_item->'source_workbook_sha256') <> 'string'
      or v_item->>'source_workbook_sha256' <> v_source_sha
      or jsonb_typeof(v_item->'sheet_name') <> 'string'
      or jsonb_typeof(v_item->'row_locator') <> 'string'
      or jsonb_typeof(v_item->'source_date_text') <> 'string'
      or jsonb_typeof(v_item->'legacy_import_date') <> 'string'
    then
      raise exception 'manifest quality flag: invalid field type/hash/dataset' using errcode = '22023';
    end if;
  end loop;
  foreach v_dataset in array array['expense','sale'] loop
    select count(*)::int into v_quality_count
      from jsonb_array_elements(v_quality) q
     where q->>'dataset' = v_dataset;
    if v_quality_count
      <> ((v_by_dataset->v_dataset)->>'matched_invalid_calendar_quality_flag_count')::int
    then
      raise exception 'manifest quality flag: % count mismatch', v_dataset using errcode = '22023';
    end if;
  end loop;

  return jsonb_build_object(
    'batch_id', v_batch_id,
    'source_workbook_sha256', v_source_sha,
    'production_snapshot_sha256', v_snapshot_sha,
    'exception_evidence_sha256', v_evidence_sha,
    'evidence_item_count', v_evidence_count,
    'batch_row_count', v_row_count,
    'result_summary', v_summary,
    'staging_manifest_sha256',
      encode(sha256(convert_to(p_manifest::text, 'UTF8')), 'hex')
  );
end;
$$;
revoke execute on function public.fn_reconciliation_validate_staging_manifest(uuid, jsonb)
  from public, anon, authenticated;

-- ── 4) re-emit the stage RPC. Verbatim 20260726120000 body EXCEPT: the replay/preflight byte checks that
--    asserted the source columns null now compare them (and evidence_label) to the manifest, and the
--    INSERT persists the four enriched columns. All authz/locks/counts/replay integrity preserved. ─────
create or replace function public.fn_stage_reconciliation_manifest(p_org uuid, p_manifest jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_meta jsonb;
  v_batch_id uuid;
  v_manifest_sha text;
  v_existing public.reconciliation_batches%rowtype;
  v_item jsonb;
  v_row jsonb;
  v_existing_evidence public.reconciliation_evidence_items%rowtype;
  v_position_id uuid;
  v_inserted_evidence int;
  v_inserted_rows int;
begin
  if p_org is null then raise exception 'org required' using errcode = '23502'; end if;
  if not exists (
    select 1 from public.organization_member m where m.org_id = p_org and m.user_id = v_uid
  ) then
    raise exception 'forbidden: not a member of this organization' using errcode = '42501';
  end if;
  if not public.authorize('reconciliation.write', p_org) then
    raise exception 'forbidden: reconciliation.write is required' using errcode = '42501';
  end if;

  v_meta := public.fn_reconciliation_validate_staging_manifest(p_org, p_manifest);
  v_batch_id := (v_meta->>'batch_id')::uuid;
  v_manifest_sha := v_meta->>'staging_manifest_sha256';

  perform pg_advisory_xact_lock(hashtextextended(v_batch_id::text, 0));
  select * into v_existing from public.reconciliation_batches where id = v_batch_id;
  if v_existing.id is not null then
    if v_existing.org_id <> p_org
      or v_existing.result_summary->>'staging_manifest_sha256' is distinct from v_manifest_sha
      or v_existing.source_workbook_sha256 is distinct from v_meta->>'source_workbook_sha256'
      or (
        select count(*) from public.reconciliation_batch_rows br
         where br.batch_id = v_batch_id and br.org_id = p_org
      ) <> (v_meta->>'batch_row_count')::int
      or exists (
        select 1
          from jsonb_array_elements(p_manifest->'batch_rows') manifest_row
          left join public.reconciliation_batch_rows br
            on br.id = (manifest_row->>'id')::uuid
           and br.org_id = p_org
           and br.batch_id = v_batch_id
           and br.evidence_item_id = (manifest_row->>'evidence_item_id')::uuid
         where br.id is null
      )
      or exists (
        select 1
          from jsonb_array_elements(p_manifest->'evidence_items') manifest_item
          left join public.reconciliation_evidence_items ei
            on ei.id = (manifest_item->>'id')::uuid
         where ei.id is null
            or ei.org_id <> p_org
            or ei.origin_kind <> manifest_item->>'origin_kind'
            or ei.source_workbook_sha256
               is distinct from nullif(manifest_item->>'source_workbook_sha256','')
            or ei.sheet_name is distinct from nullif(manifest_item->>'sheet_name','')
            or ei.row_locator is distinct from nullif(manifest_item->>'row_locator','')
            or ei.production_snapshot_sha256
               is distinct from nullif(manifest_item->>'production_snapshot_sha256','')
            or ei.snapshot_target_table
               is distinct from nullif(manifest_item->>'snapshot_target_table','')
            or ei.snapshot_target_id
               is distinct from nullif(manifest_item->>'snapshot_target_id','')::uuid
            or ei.source_identity_fingerprint
               is distinct from nullif(manifest_item->>'source_identity_fingerprint','')
            or ei.evidence_label is distinct from manifest_item->>'evidence_label'
            or ei.source_amount is distinct from (manifest_item->>'source_amount')::numeric
            or ei.source_date_text is distinct from (manifest_item->>'source_date_text')
            or ei.source_date_parsed is distinct from (manifest_item->>'source_date_parsed')::date
            or ei.classification <> manifest_item->>'classification'
            or ei.invalid_calendar_quality_flag
               <> (manifest_item->>'invalid_calendar_quality_flag')::boolean
      )
    then
      raise exception 'manifest: deterministic batch replay conflicts with persisted staging state'
        using errcode = '23505';
    end if;
    return jsonb_build_object(
      'batch_id', v_batch_id, 'status', v_existing.status, 'idempotent_replay', true,
      'staged_rows', 0, 'total_rows', (v_meta->>'batch_row_count')::int);
  end if;

  for v_item in select * from jsonb_array_elements(p_manifest->'evidence_items') loop
    select * into v_existing_evidence
      from public.reconciliation_evidence_items where id = (v_item->>'id')::uuid;
    if v_item->>'origin_kind' = 'source_workbook_row' then
      select id into v_position_id
        from public.reconciliation_evidence_items
       where org_id = p_org and origin_kind = 'source_workbook_row'
         and source_workbook_sha256 = v_item->>'source_workbook_sha256'
         and sheet_name = v_item->>'sheet_name' and row_locator = v_item->>'row_locator';
    else
      select id into v_position_id
        from public.reconciliation_evidence_items
       where org_id = p_org and origin_kind = 'production_snapshot_row'
         and production_snapshot_sha256 = v_item->>'production_snapshot_sha256'
         and snapshot_target_table = v_item->>'snapshot_target_table'
         and snapshot_target_id = (v_item->>'snapshot_target_id')::uuid;
    end if;
    if v_position_id is not null and v_position_id <> (v_item->>'id')::uuid then
      raise exception 'manifest: global evidence position already belongs to a different deterministic id'
        using errcode = '23505';
    end if;
    if v_existing_evidence.id is not null and (
      v_existing_evidence.org_id <> p_org
      or v_existing_evidence.origin_kind <> v_item->>'origin_kind'
      or v_existing_evidence.source_workbook_sha256 is distinct from nullif(v_item->>'source_workbook_sha256','')
      or v_existing_evidence.sheet_name is distinct from nullif(v_item->>'sheet_name','')
      or v_existing_evidence.row_locator is distinct from nullif(v_item->>'row_locator','')
      or v_existing_evidence.production_snapshot_sha256 is distinct from nullif(v_item->>'production_snapshot_sha256','')
      or v_existing_evidence.snapshot_target_table is distinct from nullif(v_item->>'snapshot_target_table','')
      or v_existing_evidence.snapshot_target_id is distinct from nullif(v_item->>'snapshot_target_id','')::uuid
      or v_existing_evidence.source_identity_fingerprint
         is distinct from nullif(v_item->>'source_identity_fingerprint','')
      or v_existing_evidence.evidence_label is distinct from v_item->>'evidence_label'
      or v_existing_evidence.source_amount is distinct from (v_item->>'source_amount')::numeric
      or v_existing_evidence.source_date_text is distinct from (v_item->>'source_date_text')
      or v_existing_evidence.source_date_parsed is distinct from (v_item->>'source_date_parsed')::date
      or v_existing_evidence.classification <> v_item->>'classification'
      or v_existing_evidence.invalid_calendar_quality_flag
         <> (v_item->>'invalid_calendar_quality_flag')::boolean
    ) then
      raise exception 'manifest: deterministic evidence id already exists with different bytes'
        using errcode = '23505';
    end if;
  end loop;

  insert into public.reconciliation_batches (
    id, org_id, source_workbook_sha256, status, created_by, result_summary
  ) values (
    v_batch_id, p_org, v_meta->>'source_workbook_sha256', 'staged', v_uid,
    (v_meta->'result_summary') || jsonb_build_object(
      'staging_manifest_sha256', v_manifest_sha,
      'tool_metadata', jsonb_build_object(
        'production_snapshot_sha256', v_meta->>'production_snapshot_sha256',
        'exception_evidence_sha256', v_meta->>'exception_evidence_sha256'
      ),
      'matched_invalid_calendar_quality_flag_count',
        jsonb_array_length(p_manifest->'matched_invalid_calendar_quality_flags')
    )
  );

  for v_item in select * from jsonb_array_elements(p_manifest->'evidence_items') loop
    if not exists (
      select 1 from public.reconciliation_evidence_items where id = (v_item->>'id')::uuid
    ) then
      insert into public.reconciliation_evidence_items (
        id, org_id, origin_kind, source_workbook_sha256, sheet_name, row_locator,
        production_snapshot_sha256, snapshot_target_table, snapshot_target_id,
        source_identity_fingerprint, classification, invalid_calendar_quality_flag,
        first_staged_batch_id, created_by,
        evidence_label, source_amount, source_date_text, source_date_parsed
      ) values (
        (v_item->>'id')::uuid, p_org, v_item->>'origin_kind',
        nullif(v_item->>'source_workbook_sha256',''), nullif(v_item->>'sheet_name',''),
        nullif(v_item->>'row_locator',''), nullif(v_item->>'production_snapshot_sha256',''),
        nullif(v_item->>'snapshot_target_table',''), nullif(v_item->>'snapshot_target_id','')::uuid,
        nullif(v_item->>'source_identity_fingerprint',''), v_item->>'classification',
        (v_item->>'invalid_calendar_quality_flag')::boolean, v_batch_id, v_uid,
        v_item->>'evidence_label', (v_item->>'source_amount')::numeric,
        v_item->>'source_date_text', (v_item->>'source_date_parsed')::date
      );
    end if;
  end loop;
  for v_row in select * from jsonb_array_elements(p_manifest->'batch_rows') loop
    insert into public.reconciliation_batch_rows (
      id, org_id, batch_id, evidence_item_id, review_state, target_table, disposition, created_by
    ) values (
      (v_row->>'id')::uuid, p_org, v_batch_id, (v_row->>'evidence_item_id')::uuid,
      'unreviewed', null, 'hold', v_uid
    );
  end loop;
  select count(*)::int into v_inserted_rows
    from public.reconciliation_batch_rows where batch_id = v_batch_id;
  if v_inserted_rows <> (v_meta->>'batch_row_count')::int then
    raise exception 'manifest: inserted batch-row count mismatch' using errcode = '22023';
  end if;
  select count(*)::int into v_inserted_evidence
    from public.reconciliation_evidence_items
   where id in (
     select (e->>'id')::uuid from jsonb_array_elements(p_manifest->'evidence_items') e
   );
  if v_inserted_evidence <> (v_meta->>'evidence_item_count')::int then
    raise exception 'manifest: staged evidence count mismatch' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'batch_id', v_batch_id, 'status', 'staged', 'idempotent_replay', false,
    'staged_rows', (v_meta->>'batch_row_count')::int,
    'total_rows', (v_meta->>'batch_row_count')::int);
end;
$$;
revoke execute on function public.fn_stage_reconciliation_manifest(uuid, jsonb) from public, anon;
grant execute on function public.fn_stage_reconciliation_manifest(uuid, jsonb) to authenticated;

-- ── 5) re-emit the tenant/correction guard (verbatim provenance body) + Slice 4A dimensional integrity:
--    the sale farm→sector→hawsha hierarchy, and the included-expense active-leaf/kind account rule. ────
create or replace function public.fn_guard_reconciliation_batch_row_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_evidence_classification text;
  v_acct_active boolean;
  v_acct_kind text;
begin
  if new.expense_account_id is not null and not exists (
    select 1 from public.accounts a where a.id = new.expense_account_id and a.org_id = new.org_id
  ) then
    raise exception 'reconciliation_batch_rows: expense_account_id belongs to another organization' using errcode = '23514';
  end if;
  if new.expense_cost_center_id is not null and not exists (
    select 1 from public.cost_centers c where c.id = new.expense_cost_center_id and c.org_id = new.org_id
  ) then
    raise exception 'reconciliation_batch_rows: expense_cost_center_id belongs to another organization' using errcode = '23514';
  end if;
  if new.expense_supplier_id is not null and not exists (
    select 1 from public.suppliers s where s.id = new.expense_supplier_id and s.org_id = new.org_id
  ) then
    raise exception 'reconciliation_batch_rows: expense_supplier_id belongs to another organization' using errcode = '23514';
  end if;
  if new.sale_buyer_id is not null and not exists (
    select 1 from public.buyers b where b.id = new.sale_buyer_id and b.org_id = new.org_id
  ) then
    raise exception 'reconciliation_batch_rows: sale_buyer_id belongs to another organization' using errcode = '23514';
  end if;
  if new.sale_cost_center_id is not null and not exists (
    select 1 from public.cost_centers c where c.id = new.sale_cost_center_id and c.org_id = new.org_id
  ) then
    raise exception 'reconciliation_batch_rows: sale_cost_center_id belongs to another organization' using errcode = '23514';
  end if;
  if new.sale_farm_id is not null and not exists (
    select 1 from public.farms f where f.id = new.sale_farm_id and f.org_id = new.org_id
  ) then
    raise exception 'reconciliation_batch_rows: sale_farm_id belongs to another organization' using errcode = '23514';
  end if;
  if new.sale_sector_id is not null and not exists (
    select 1 from public.sectors s where s.id = new.sale_sector_id and s.org_id = new.org_id
  ) then
    raise exception 'reconciliation_batch_rows: sale_sector_id belongs to another organization' using errcode = '23514';
  end if;
  if new.sale_hawsha_id is not null and not exists (
    select 1 from public.hawshat h where h.id = new.sale_hawsha_id and h.org_id = new.org_id
  ) then
    raise exception 'reconciliation_batch_rows: sale_hawsha_id belongs to another organization' using errcode = '23514';
  end if;
  if new.corrects_expense_id is not null and not exists (
    select 1 from public.expenses e where e.id = new.corrects_expense_id and e.org_id = new.org_id
  ) then
    raise exception 'reconciliation_batch_rows: corrects_expense_id belongs to another organization' using errcode = '23514';
  end if;
  if new.corrects_sale_id is not null and not exists (
    select 1 from public.sales sl where sl.id = new.corrects_sale_id and sl.org_id = new.org_id
  ) then
    raise exception 'reconciliation_batch_rows: corrects_sale_id belongs to another organization' using errcode = '23514';
  end if;
  if new.reviewer_id is not null and not exists (
    select 1 from public.organization_member m where m.user_id = new.reviewer_id and m.org_id = new.org_id
  ) then
    raise exception 'reconciliation_batch_rows: reviewer_id is not a member of this organization' using errcode = '23514';
  end if;

  select ei.classification into v_evidence_classification
  from public.reconciliation_evidence_items ei
  where ei.id = new.evidence_item_id and ei.org_id = new.org_id;

  if (new.corrects_expense_id is not null or new.corrects_sale_id is not null)
    and v_evidence_classification is distinct from 'amount_correction_candidate'
  then
    raise exception
      'reconciliation_batch_rows: a correction target id requires amount_correction_candidate evidence classification'
      using errcode = '23514';
  end if;

  if new.disposition = 'include' and v_evidence_classification = 'amount_correction_candidate' then
    if new.target_table = 'expenses' and new.corrects_expense_id is null then
      raise exception
        'reconciliation_batch_rows: an included amount_correction_candidate expenses row requires corrects_expense_id'
        using errcode = '23514';
    end if;
    if new.target_table = 'sales' and new.corrects_sale_id is null then
      raise exception
        'reconciliation_batch_rows: an included amount_correction_candidate sales row requires corrects_sale_id'
        using errcode = '23514';
    end if;
  end if;

  -- Slice 4A dimensional integrity — sale farm→sector→hawsha hierarchy (farm-only and sector-with-farm
  -- are allowed; a set sector needs a farm it belongs to; a set hawsha needs a sector it belongs to).
  if new.sale_sector_id is not null then
    if new.sale_farm_id is null then
      raise exception 'reconciliation_batch_rows: sale_sector_id requires sale_farm_id' using errcode = '23514';
    end if;
    if not exists (
      select 1 from public.sectors s
       where s.id = new.sale_sector_id and s.org_id = new.org_id and s.farm_id = new.sale_farm_id
    ) then
      raise exception 'reconciliation_batch_rows: sale_sector_id does not belong to sale_farm_id' using errcode = '23514';
    end if;
  end if;
  if new.sale_hawsha_id is not null then
    if new.sale_sector_id is null then
      raise exception 'reconciliation_batch_rows: sale_hawsha_id requires sale_sector_id' using errcode = '23514';
    end if;
    if not exists (
      select 1 from public.hawshat h
       where h.id = new.sale_hawsha_id and h.org_id = new.org_id and h.sector_id = new.sale_sector_id
    ) then
      raise exception 'reconciliation_batch_rows: sale_hawsha_id does not belong to sale_sector_id' using errcode = '23514';
    end if;
  end if;

  -- Slice 4A — an INCLUDED expense must post to an active leaf account whose kind equals expense_kind.
  if new.disposition = 'include' and new.target_table = 'expenses' and new.expense_account_id is not null then
    select a.active, a.kind into v_acct_active, v_acct_kind
      from public.accounts a where a.id = new.expense_account_id and a.org_id = new.org_id;
    if not coalesce(v_acct_active, false) then
      raise exception 'reconciliation_batch_rows: included expense account must be active' using errcode = '23514';
    end if;
    if v_acct_kind is distinct from new.expense_kind then
      raise exception 'reconciliation_batch_rows: included expense account kind must equal expense_kind' using errcode = '23514';
    end if;
    if exists (
      select 1 from public.accounts c
       where c.parent_id = new.expense_account_id and c.org_id = new.org_id and c.active
    ) then
      raise exception 'reconciliation_batch_rows: included expense account must be a leaf (no active children)' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;
revoke execute on function public.fn_guard_reconciliation_batch_row_tenant() from public, anon, authenticated;

commit;
