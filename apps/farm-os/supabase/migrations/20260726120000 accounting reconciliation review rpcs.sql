-- Accounting reconciliation — slice 3 (DB: staging / review / freeze / approve RPCs only).
-- Source: "controlled accounting reconciliation design.md" §2.1-2.4, §4 steps 1 and 5-6, §9 item 3,
-- §10 row "3", §13A note ("basic freeze/approve state transitions … may be deferred to slice 3").
--
-- SCOPE. Four authenticated-only SECURITY DEFINER RPCs, plus five internal validation helpers. Every
-- write these RPCs make lands in EXACTLY the three slice-1A tables (reconciliation_batches,
-- reconciliation_evidence_items, reconciliation_batch_rows). This migration adds NO table, NO column,
-- NO new authorize() permission (reconciliation.write already exists from slice 1A), NO client DML grant
-- (the tables keep deny-by-default; the RPCs are the only write path), and NO trigger.
--
-- ABSOLUTELY OUT OF SCOPE (money boundary). No write to expenses / sales / journal_entries /
-- journal_lines / custody_* / payment_* — reconciliation-only. No execution RPC
-- (fn_execute_reconciliation_batch, slice 4/5) and no rollback RPC (slice 7). No baseline / ledger /
-- action-link writes (slice 1B tables are execution-time-only; slice 3 never touches them). Approval
-- flips ONLY reconciliation_batches.status/approved_by/approved_at — it posts nothing.
--
-- THE FOUR RPCs.
--   1) fn_stage_reconciliation_manifest(p_org, p_manifest jsonb) — atomic, BOUNDED (<= c_max_rows)
--      staging of the exact Slice-2 StagingDraft into the three tables. Parser-generated deterministic
--      batch/evidence/row ids are preserved; evidence items are reused only when every immutable field
--      agrees. EXACT REPLAY is serialized by deterministic batch id and is idempotent only when the
--      canonical manifest hash and persisted identities still agree. A conflicting id/global locator/
--      persisted replay is REJECTED (23505). Malformed shape, unexpected or missing keys, wrong types,
--      duplicate ids/locators, count mismatch, cross-org, or any partial-input failure aborts the call
--      (one transaction) — fail-closed, no partial batch survives.
--   2) fn_review_reconciliation_row(p_row_id, p_decision jsonb) — save a typed review / hold / reject
--      decision onto one batch row (only while its batch is 'staged'). Mandatory reason. The slice-1A
--      table CHECK constraints + fn_guard_reconciliation_batch_row_tenant() are the authoritative
--      backstop for typed-column-required / cross-org / correction-classification rules; this RPC adds
--      strict JSON-shape validation on top so an unexpected key/type fails closed before any write.
--   3) fn_freeze_reconciliation_batch(p_batch_id) — atomically freeze a fully-reviewed batch: reject if
--      any row is still 'unreviewed'; else compute a DETERMINISTIC server-side sha-256 payload_hash over
--      every row's typed decision, set frozen=true (included rows also move review_state='frozen'), and
--      move the batch 'staged' -> 'reviewed'. Idempotent: re-freezing an already-'reviewed'
--      batch recomputes nothing and returns the existing summary.
--   4) fn_approve_reconciliation_batch(p_batch_id) — OWNER-ONLY, with SEPARATION OF DUTIES: the approver
--      must be an org 'owner' AND must not be the batch's creator nor any row's reviewer (docs/CLAUDE.md
--      "Owner & approvals": the approver is "not the actor that produced the change"). Moves 'reviewed'
--      -> 'approved' and stamps approved_by/approved_at — nothing else.
--
-- AUTHZ (every RPC). Explicit membership (organization_member) AND authorize('reconciliation.write',
-- org) — owner/accountant only, from slice 1A. anon/farm_manager/storekeeper and any cross-org caller
-- fail closed (42501). EXECUTE is revoked from public/anon and granted to authenticated only; the
-- internal helper is revoked from public/anon/authenticated (callable only from these owner-context RPCs).
--
-- PORTABLE HASH. payload_hash uses encode(sha256(convert_to(<jsonb>::text,'UTF8')),'hex') — sha256 /
-- convert_to / encode / jsonb_build_object are all pg_catalog built-ins, so they resolve under
-- `set search_path = ''` with no dependence on where pgcrypto's digest() happens to live (public locally
-- vs extensions on Supabase). jsonb_build_object represents every field explicitly (a null field is
-- "key":null, never omitted), so two rows differing only in a null-vs-populated column cannot collide.
--
-- ROLLBACK RUNBOOK (exact):
--   begin;
--   drop function if exists public.fn_approve_reconciliation_batch(uuid);
--   drop function if exists public.fn_freeze_reconciliation_batch(uuid);
--   drop function if exists public.fn_review_reconciliation_row(uuid, jsonb);
--   drop function if exists public.fn_stage_reconciliation_manifest(uuid, jsonb);
--   drop function if exists public.fn_reconciliation_validate_staging_manifest(uuid, jsonb);
--   drop function if exists public.fn_reconciliation_stable_uuid(text[]);
--   drop function if exists public.fn_reconciliation_assert_json_scalar_types(jsonb, text[], text[], text);
--   drop function if exists public.fn_reconciliation_assert_exact_object_keys(jsonb, text[], text);
--   drop function if exists public.fn_reconciliation_assert_object_keys(jsonb, text[], text);
--   commit;
-- This migration is additive-only (four functions + five helpers + their grants). It performs no writes to
-- any table's data, so it is not destructive against an existing database.

begin;

-- ── 0) internal helper: assert a jsonb value is an object whose keys are all in an allowlist. Rejects a
--    non-object and any unexpected key (fail-closed on malformed input). SECURITY DEFINER + revoked from
--    every client role — reachable only from the owner-context RPCs below. ─────────────────────────────
create or replace function public.fn_reconciliation_assert_object_keys(p_obj jsonb, p_allowed text[], p_ctx text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bad text;
begin
  if p_obj is null or jsonb_typeof(p_obj) <> 'object' then
    raise exception 'reconciliation: % must be a JSON object', p_ctx using errcode = '22023';
  end if;
  select k into v_bad
    from jsonb_object_keys(p_obj) as k
   where k <> all (p_allowed)
   limit 1;
  if v_bad is not null then
    raise exception 'reconciliation: unexpected key "%" in %', v_bad, p_ctx using errcode = '22023';
  end if;
end;
$$;
revoke execute on function public.fn_reconciliation_assert_object_keys(jsonb, text[], text)
  from public, anon, authenticated;

create or replace function public.fn_reconciliation_assert_exact_object_keys(
  p_obj jsonb, p_required text[], p_ctx text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_missing text;
begin
  perform public.fn_reconciliation_assert_object_keys(p_obj, p_required, p_ctx);
  select k into v_missing
    from unnest(p_required) as k
   where not (p_obj ? k)
   limit 1;
  if v_missing is not null then
    raise exception 'reconciliation: missing key "%" in %', v_missing, p_ctx using errcode = '22023';
  end if;
end;
$$;
revoke execute on function public.fn_reconciliation_assert_exact_object_keys(jsonb, text[], text)
  from public, anon, authenticated;

-- Exact SQL mirror of Slice 2 stableUuid(...parts): SHA-256 over SOH-delimited UTF-8 parts, with
-- RFC-4122 version/variant nibbles rewritten after hashing. This prevents a structurally plausible
-- client manifest from substituting arbitrary batch/evidence/row identities.
create or replace function public.fn_reconciliation_stable_uuid(variadic p_parts text[])
returns uuid
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  v_digest text;
  v_variant text;
begin
  if p_parts is null or cardinality(p_parts) = 0 or array_position(p_parts, null) is not null then
    raise exception 'reconciliation stable id: every part is required' using errcode = '22023';
  end if;
  v_digest := encode(sha256(convert_to(array_to_string(p_parts, chr(1)), 'UTF8')), 'hex');
  v_variant := substr(
    '89ab', ((get_byte(decode(substr(v_digest,17,2),'hex'),0) >> 4) & 3) + 1, 1
  );
  return (
    substr(v_digest,1,8) || '-' || substr(v_digest,9,4) || '-5' || substr(v_digest,14,3) || '-'
    || v_variant || substr(v_digest,18,3) || '-' || substr(v_digest,21,12)
  )::uuid;
end;
$$;
revoke execute on function public.fn_reconciliation_stable_uuid(text[])
  from public, anon, authenticated;

create or replace function public.fn_reconciliation_assert_json_scalar_types(
  p_obj jsonb, p_string_keys text[], p_number_keys text[], p_ctx text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
begin
  foreach v_key in array p_string_keys loop
    if p_obj ? v_key and jsonb_typeof(p_obj->v_key) not in ('string','null') then
      raise exception 'reconciliation: %.% must be a string or null', p_ctx, v_key
        using errcode = '22023';
    end if;
  end loop;
  foreach v_key in array p_number_keys loop
    if p_obj ? v_key and jsonb_typeof(p_obj->v_key) not in ('number','null') then
      raise exception 'reconciliation: %.% must be a number or null', p_ctx, v_key
        using errcode = '22023';
    end if;
  end loop;
end;
$$;
revoke execute on function public.fn_reconciliation_assert_json_scalar_types(jsonb, text[], text[], text)
  from public, anon, authenticated;

-- Validate the exact application-layer StagingDraft before the staging RPC writes anything.
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
    -- A correction candidate can carry both source and production locators in the trusted
    -- evidence summary, so source_occurrence_count + production_occurrence_count may exceed
    -- exception_row_count. The staged evidence and classification totals must still be exact.
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
            'first_staged_batch_id'],
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

-- ── 1) fn_stage_reconciliation_manifest — atomic exact-Slice-2 manifest staging (§4 step 1, §3.1). ───
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

  -- The deterministic batch id is the concurrency and replay identity. Identical callers serialize.
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
            or ei.source_amount is not null
            or ei.source_date_text is not null
            or ei.source_date_parsed is not null
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

  -- Preflight every global id and locator before the first write.
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
      or v_existing_evidence.source_amount is not null
      or v_existing_evidence.source_date_text is not null
      or v_existing_evidence.source_date_parsed is not null
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
        first_staged_batch_id, created_by
      ) values (
        (v_item->>'id')::uuid, p_org, v_item->>'origin_kind',
        nullif(v_item->>'source_workbook_sha256',''), nullif(v_item->>'sheet_name',''),
        nullif(v_item->>'row_locator',''), nullif(v_item->>'production_snapshot_sha256',''),
        nullif(v_item->>'snapshot_target_table',''), nullif(v_item->>'snapshot_target_id','')::uuid,
        nullif(v_item->>'source_identity_fingerprint',''), v_item->>'classification',
        (v_item->>'invalid_calendar_quality_flag')::boolean, v_batch_id, v_uid
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

-- ── 2) fn_review_reconciliation_row — save a typed review / hold / reject decision (§4 steps 3-4). ────
create or replace function public.fn_review_reconciliation_row(p_row_id uuid, p_decision jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid          uuid := (select auth.uid());
  v_org          uuid;
  v_batch        uuid;
  v_batch_status text;
  v_frozen       boolean;
  v_action       text;
  v_reason       text;
  v_target       text;
  v_exp          jsonb;
  v_sale         jsonb;
  v_new_state    text;
  v_new_disp     text;
begin
  if p_row_id is null then raise exception 'row id required' using errcode = '23502'; end if;

  -- Resolve the tenant first, authorize, then take locks in the same parent->child order as freeze.
  -- A joined FOR UPDATE can retain a pre-wait joined status after EvalPlanQual; re-reading the row only
  -- after the parent lock is held makes a concurrent freeze visible before any review mutation.
  select br.org_id, br.batch_id
    into v_org, v_batch
    from public.reconciliation_batch_rows br
   where br.id = p_row_id;
  if v_org is null then raise exception 'reconciliation row % not found', p_row_id using errcode = 'P0002'; end if;

  -- authz: explicit membership + reconciliation.write; cross-org fails closed.
  if v_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org reconciliation row' using errcode = '42501';
  end if;
  if not exists (select 1 from public.organization_member m where m.org_id = v_org and m.user_id = v_uid) then
    raise exception 'forbidden: not a member of this organization' using errcode = '42501';
  end if;
  if not public.authorize('reconciliation.write', v_org) then
    raise exception 'forbidden: reconciliation.write is required' using errcode = '42501';
  end if;

  select b.status
    into v_batch_status
    from public.reconciliation_batches b
   where b.id = v_batch and b.org_id = v_org
     for update;
  if v_batch_status is null then
    raise exception 'reconciliation batch % not found', v_batch using errcode = 'P0002';
  end if;
  select br.frozen
    into v_frozen
    from public.reconciliation_batch_rows br
   where br.id = p_row_id and br.batch_id = v_batch and br.org_id = v_org
     for update;
  if not found then
    raise exception 'reconciliation row % changed while acquiring its batch lock', p_row_id
      using errcode = '40001';
  end if;

  -- reviews are only editable while the batch is still 'staged' and the row is not frozen.
  if v_batch_status <> 'staged' then
    raise exception 'reconciliation: batch is % — rows may only be reviewed while staged', v_batch_status
      using errcode = '22023';
  end if;
  if v_frozen then
    raise exception 'reconciliation: row is frozen and cannot be re-reviewed' using errcode = '22023';
  end if;

  perform public.fn_reconciliation_assert_object_keys(
    p_decision,
    array['action','reason','target_table','expense','sale','corrects_expense_id','corrects_sale_id'],
    'decision');
  perform public.fn_reconciliation_assert_json_scalar_types(
    p_decision,
    array['action','reason','target_table','corrects_expense_id','corrects_sale_id'],
    array[]::text[],
    'decision');

  v_action := p_decision->>'action';
  if v_action is null or v_action not in ('review','hold','reject') then
    raise exception 'decision: action must be review|hold|reject' using errcode = '22023';
  end if;
  v_reason := p_decision->>'reason';
  if v_reason is null or length(trim(v_reason)) = 0 then
    raise exception 'decision: a non-empty reason is mandatory' using errcode = '22023';
  end if;

  if v_action = 'reject' then
    perform public.fn_reconciliation_assert_exact_object_keys(
      p_decision, array['action','reason'], 'decision.reject');
    -- a rejected row is excluded from execution: it holds, and is never frozen/executed.
    update public.reconciliation_batch_rows
       set review_state = 'rejected', disposition = 'hold',
           reviewer_id = v_uid, review_reason = v_reason, reviewed_at = now()
     where id = p_row_id;
    return jsonb_build_object('row_id', p_row_id, 'review_state', 'rejected', 'disposition', 'hold');
  end if;

  if v_action = 'hold' then
    perform public.fn_reconciliation_assert_exact_object_keys(
      p_decision, array['action','reason'], 'decision.hold');
    -- a reviewed decision to exclude this row from the batch (§4 step 4 default for ambiguous rows).
    update public.reconciliation_batch_rows
       set review_state = 'reviewed', disposition = 'hold',
           reviewer_id = v_uid, review_reason = v_reason, reviewed_at = now()
     where id = p_row_id;
    return jsonb_build_object('row_id', p_row_id, 'review_state', 'reviewed', 'disposition', 'hold');
  end if;

  -- v_action = 'review' → include this row and populate its typed reviewed columns for the named domain.
  v_target := p_decision->>'target_table';
  if v_target is null or v_target not in ('expenses','sales') then
    raise exception 'decision: review requires target_table = expenses|sales' using errcode = '22023';
  end if;
  v_new_state := 'reviewed';
  v_new_disp  := 'include';

  if v_target = 'expenses' then
    perform public.fn_reconciliation_assert_object_keys(
      p_decision, array['action','reason','target_table','expense','corrects_expense_id'],
      'decision.expenses');
    v_exp := p_decision->'expense';
    perform public.fn_reconciliation_assert_object_keys(
      v_exp, array['category','description','kind','account_id','cost_center_id','supplier_id','payment_decision'],
      'decision.expense');
    perform public.fn_reconciliation_assert_json_scalar_types(
      v_exp,
      array['category','description','kind','account_id','cost_center_id','supplier_id','payment_decision'],
      array[]::text[],
      'decision.expense');
    update public.reconciliation_batch_rows
       set review_state = v_new_state, disposition = v_new_disp, target_table = 'expenses',
           reviewer_id = v_uid, review_reason = v_reason, reviewed_at = now(),
           expense_category        = v_exp->>'category',
           expense_description     = v_exp->>'description',
           expense_kind            = v_exp->>'kind',
           expense_account_id      = nullif(v_exp->>'account_id','')::uuid,
           expense_cost_center_id  = nullif(v_exp->>'cost_center_id','')::uuid,
           expense_supplier_id     = nullif(v_exp->>'supplier_id','')::uuid,
           expense_payment_decision= v_exp->>'payment_decision',
           corrects_expense_id     = nullif(p_decision->>'corrects_expense_id','')::uuid,
           -- clear any stale sale-domain fields so a re-review can't leave cross-domain residue.
           sale_crop = null, sale_quantity = null, sale_unit = null, sale_unit_price = null,
           sale_recorded_total = null, sale_buyer_id = null, sale_cost_center_id = null,
           sale_farm_id = null, sale_sector_id = null, sale_hawsha_id = null, sale_season = null,
           sale_delivery_date = null, sale_notes = null, sale_historical_date_decision = null,
           sale_effective_date = null, corrects_sale_id = null
     where id = p_row_id;
  else
    perform public.fn_reconciliation_assert_object_keys(
      p_decision, array['action','reason','target_table','sale','corrects_sale_id'],
      'decision.sales');
    v_sale := p_decision->'sale';
    perform public.fn_reconciliation_assert_object_keys(
      v_sale, array['crop','quantity','unit','unit_price','recorded_total','buyer_id','cost_center_id',
                    'farm_id','sector_id','hawsha_id','season','delivery_date','notes',
                    'historical_date_decision','effective_date'],
      'decision.sale');
    perform public.fn_reconciliation_assert_json_scalar_types(
      v_sale,
      array['crop','unit','buyer_id','cost_center_id','farm_id','sector_id','hawsha_id','season',
            'delivery_date','notes','historical_date_decision','effective_date'],
      array['quantity','unit_price','recorded_total'],
      'decision.sale');
    update public.reconciliation_batch_rows
       set review_state = v_new_state, disposition = v_new_disp, target_table = 'sales',
           reviewer_id = v_uid, review_reason = v_reason, reviewed_at = now(),
           sale_crop                     = v_sale->>'crop',
           sale_quantity                 = nullif(v_sale->>'quantity','')::numeric,
           sale_unit                     = v_sale->>'unit',
           sale_unit_price               = nullif(v_sale->>'unit_price','')::numeric,
           sale_recorded_total           = nullif(v_sale->>'recorded_total','')::numeric,
           sale_buyer_id                 = nullif(v_sale->>'buyer_id','')::uuid,
           sale_cost_center_id           = nullif(v_sale->>'cost_center_id','')::uuid,
           sale_farm_id                  = nullif(v_sale->>'farm_id','')::uuid,
           sale_sector_id                = nullif(v_sale->>'sector_id','')::uuid,
           sale_hawsha_id                = nullif(v_sale->>'hawsha_id','')::uuid,
           sale_season                   = v_sale->>'season',
           sale_delivery_date            = nullif(v_sale->>'delivery_date','')::date,
           sale_notes                    = v_sale->>'notes',
           sale_historical_date_decision = v_sale->>'historical_date_decision',
           sale_effective_date           = nullif(v_sale->>'effective_date','')::date,
           corrects_sale_id              = nullif(p_decision->>'corrects_sale_id','')::uuid,
           -- clear any stale expense-domain fields.
           expense_category = null, expense_description = null, expense_kind = null,
           expense_account_id = null, expense_cost_center_id = null, expense_supplier_id = null,
           expense_payment_decision = null, corrects_expense_id = null
     where id = p_row_id;
  end if;

  return jsonb_build_object('row_id', p_row_id, 'review_state', v_new_state, 'disposition', v_new_disp,
                            'target_table', v_target);
end;
$$;
revoke execute on function public.fn_review_reconciliation_row(uuid, jsonb) from public, anon;
grant execute on function public.fn_review_reconciliation_row(uuid, jsonb) to authenticated;

-- ── 3) fn_freeze_reconciliation_batch — atomic freeze with deterministic server hashes (§4 step 5). ──
create or replace function public.fn_freeze_reconciliation_batch(p_batch_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := (select auth.uid());
  v_org       uuid;
  v_status    text;
  v_unreviewed int;
  v_frozen_n  int := 0;
  r           public.reconciliation_batch_rows%rowtype;
  v_hash      text;
begin
  if p_batch_id is null then raise exception 'batch id required' using errcode = '23502'; end if;

  -- lock the batch row to serialize concurrent freeze attempts.
  select org_id, status into v_org, v_status
    from public.reconciliation_batches where id = p_batch_id for update;
  if v_org is null then raise exception 'reconciliation batch % not found', p_batch_id using errcode = 'P0002'; end if;

  if v_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org reconciliation batch' using errcode = '42501';
  end if;
  if not exists (select 1 from public.organization_member m where m.org_id = v_org and m.user_id = v_uid) then
    raise exception 'forbidden: not a member of this organization' using errcode = '42501';
  end if;
  if not public.authorize('reconciliation.write', v_org) then
    raise exception 'forbidden: reconciliation.write is required' using errcode = '42501';
  end if;

  -- idempotent: an already-frozen ('reviewed') batch recomputes nothing.
  if v_status = 'reviewed' then
    select count(*)::int into v_frozen_n
      from public.reconciliation_batch_rows where batch_id = p_batch_id and frozen = true;
    return jsonb_build_object('batch_id', p_batch_id, 'status', 'reviewed',
                              'idempotent', true, 'frozen_rows', v_frozen_n);
  end if;
  if v_status <> 'staged' then
    raise exception 'reconciliation: batch is % — only a staged batch may be frozen', v_status
      using errcode = '22023';
  end if;

  -- Every row needs an explicit human decision. Default unreviewed/hold is not an approval decision.
  select count(*)::int into v_unreviewed
    from public.reconciliation_batch_rows
   where batch_id = p_batch_id and review_state = 'unreviewed';
  if v_unreviewed > 0 then
    raise exception 'reconciliation: cannot freeze — % row(s) have no review decision', v_unreviewed
      using errcode = '22023';
  end if;

  -- Hash and freeze every decided row. Held/rejected rows retain their decision state, while included
  -- rows move to the execution-facing frozen state.
  for r in
    select * from public.reconciliation_batch_rows
     where batch_id = p_batch_id and review_state in ('reviewed','rejected')
     order by evidence_item_id
  loop
    v_hash := encode(sha256(convert_to(jsonb_build_object(
        'evidence_item_id', r.evidence_item_id,
        'target_table', r.target_table,
        'disposition', r.disposition,
        'expense_category', r.expense_category,
        'expense_description', r.expense_description,
        'expense_kind', r.expense_kind,
        'expense_account_id', r.expense_account_id,
        'expense_cost_center_id', r.expense_cost_center_id,
        'expense_supplier_id', r.expense_supplier_id,
        'expense_payment_decision', r.expense_payment_decision,
        'sale_crop', r.sale_crop,
        'sale_quantity', r.sale_quantity,
        'sale_unit', r.sale_unit,
        'sale_unit_price', r.sale_unit_price,
        'sale_recorded_total', r.sale_recorded_total,
        'sale_buyer_id', r.sale_buyer_id,
        'sale_cost_center_id', r.sale_cost_center_id,
        'sale_farm_id', r.sale_farm_id,
        'sale_sector_id', r.sale_sector_id,
        'sale_hawsha_id', r.sale_hawsha_id,
        'sale_season', r.sale_season,
        'sale_delivery_date', r.sale_delivery_date,
        'sale_notes', r.sale_notes,
        'sale_historical_date_decision', r.sale_historical_date_decision,
        'sale_effective_date', r.sale_effective_date,
        'corrects_expense_id', r.corrects_expense_id,
        'corrects_sale_id', r.corrects_sale_id
      )::text, 'UTF8')), 'hex');
    update public.reconciliation_batch_rows
       set payload_hash = v_hash, frozen = true, frozen_at = now(),
           review_state = case when disposition = 'include' then 'frozen' else review_state end
     where id = r.id;
    v_frozen_n := v_frozen_n + 1;
  end loop;

  update public.reconciliation_batches set status = 'reviewed' where id = p_batch_id;

  return jsonb_build_object('batch_id', p_batch_id, 'status', 'reviewed',
                            'idempotent', false, 'frozen_rows', v_frozen_n);
end;
$$;
revoke execute on function public.fn_freeze_reconciliation_batch(uuid) from public, anon;
grant execute on function public.fn_freeze_reconciliation_batch(uuid) to authenticated;

-- ── 4) fn_approve_reconciliation_batch — owner-only, separation of duties (§4 step 6). ───────────────
create or replace function public.fn_approve_reconciliation_batch(p_batch_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := (select auth.uid());
  v_org        uuid;
  v_status     text;
  v_created_by uuid;
begin
  if p_batch_id is null then raise exception 'batch id required' using errcode = '23502'; end if;

  select org_id, status, created_by into v_org, v_status, v_created_by
    from public.reconciliation_batches where id = p_batch_id for update;
  if v_org is null then raise exception 'reconciliation batch % not found', p_batch_id using errcode = 'P0002'; end if;

  if v_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org reconciliation batch' using errcode = '42501';
  end if;
  if not public.authorize('reconciliation.write', v_org) then
    raise exception 'forbidden: reconciliation.write is required' using errcode = '42501';
  end if;
  -- OWNER-ONLY: stricter than reconciliation.write (which the accountant also holds).
  if not exists (
    select 1 from public.organization_member m
     where m.org_id = v_org and m.user_id = v_uid and m.role = 'owner'
  ) then
    raise exception 'forbidden: only the owner may approve a reconciliation batch' using errcode = '42501';
  end if;

  -- only a frozen ('reviewed') batch may be approved.
  if v_status <> 'reviewed' then
    raise exception 'reconciliation: batch is % — only a reviewed (frozen) batch may be approved', v_status
      using errcode = '22023';
  end if;

  -- SEPARATION OF DUTIES: the approver must not be the batch creator nor any row's reviewer.
  if v_uid is not distinct from v_created_by then
    raise exception 'separation of duties: the batch creator may not approve it' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.reconciliation_batch_rows br
     where br.batch_id = p_batch_id and br.reviewer_id = v_uid
  ) then
    raise exception 'separation of duties: a reviewer of this batch may not approve it' using errcode = '42501';
  end if;

  -- approval changes ONLY reconciliation status — no financial write, no execution.
  update public.reconciliation_batches
     set status = 'approved', approved_by = v_uid, approved_at = now()
   where id = p_batch_id;

  return jsonb_build_object('batch_id', p_batch_id, 'status', 'approved', 'approved_by', v_uid);
end;
$$;
revoke execute on function public.fn_approve_reconciliation_batch(uuid) from public, anon;
grant execute on function public.fn_approve_reconciliation_batch(uuid) to authenticated;

commit;
