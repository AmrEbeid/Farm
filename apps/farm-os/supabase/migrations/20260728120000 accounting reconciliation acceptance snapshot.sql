-- Accounting reconciliation — acceptance report READ snapshot (SPEC-0004, dual-run acceptance slice).
--
-- WHY THIS EXISTS. The acceptance report is a printable artifact an accountant and the owner SIGN.
-- Building it from several separate PostgREST statements had three defects that a signature makes
-- expensive:
--   1) PostgREST serialises `numeric` as a JSON NUMBER, so every accounting amount became a binary
--      double inside the JSON parser BEFORE any application code could read it. A `numeric` that a
--      double cannot represent was already lossy by the time it reached lib/decimal.ts.
--   2) The batch row, the row list and the row COUNT were three statements at three different
--      snapshots, so a concurrent review/freeze could produce a hybrid report — figures from one
--      instant filed against provenance from another.
--   3) The whole-batch bound and the "matches what staging recorded" check lived in the app, where a
--      future caller could skip them.
--
-- WHAT THIS ADDS. Exactly ONE function, and nothing else: no table, no column, no trigger, no new
-- authorize() permission, no client DML grant, no re-emit of any existing object.
--
--   public.fn_reconciliation_acceptance_snapshot(p_org uuid, p_batch_id uuid) returns jsonb
--
-- It is SECURITY INVOKER: it runs with the CALLER's privileges, so every existing RLS policy on
-- reconciliation_batches / reconciliation_evidence_items / reconciliation_batch_rows and on the eight
-- dimension tables it reads for labels applies unchanged. Nothing here is a privilege escalation, and
-- there is deliberately no SECURITY DEFINER arm and no service-role path — the report can never show a
-- row the caller could not already select for themselves.
--
-- READ-ONLY BY CONSTRUCTION. The body contains SELECTs only: no insert/update/delete, no call to any
-- staging/review/freeze/approve/execute/rollback RPC, no write to expenses / sales / journal_entries /
-- journal_lines / custody_* / payment_*. Opening or downloading an acceptance report posts nothing.
--
-- ONE SNAPSHOT PER CALL. The function is declared STABLE, so PostgreSQL gives every statement inside
-- it the snapshot of the CALLING QUERY rather than taking a fresh one per statement (a VOLATILE
-- function does the latter). The body is still several statements — this is not, and does not claim to
-- be, one SQL statement — but they all observe the same instant, so the batch identity, the rows, the
-- joined evidence, the readable dimension labels and both row counts describe ONE state of the
-- database. A concurrent review or freeze can no longer produce a report that mixes two.
--
-- The guarantee is per CALL. Two separate requests (the page and the CSV annex) are two calls at two
-- instants; that is exactly what the SHA-256 content digest is for.
--
-- EXACT DECIMALS. Every `numeric` accounting field (evidence.source_amount, sale_quantity,
-- sale_unit_price, sale_recorded_total) is serialised with ::text — the canonical decimal digits —
-- BEFORE the JSON leaves PostgreSQL. No accounting amount is ever a JSON number on the wire, so no
-- amount passes through a binary double on its way to the signed report or the CSV annex.
--
-- DETERMINISTIC TIMESTAMPS. timestamptz is rendered as explicit UTC ISO-8601 text rather than left to
-- to_jsonb, whose offset follows the session TimeZone. The page and the CSV annex are two separate
-- requests whose SHA-256 content digests must match; a session-dependent timestamp string would make
-- them differ for no reason other than which backend served them.
--
-- FAIL-CLOSED VERDICTS. The function answers with a `status`, never with a partial report:
--   'ok'             — the complete batch, bounded and cross-checked.
--   'not_found'      — no such batch in the caller's active org (cross-org is indistinguishable, by design).
--   'empty'          — the batch has NO rows. There is nothing to accept, and a fully-formed report
--                      whose every total is zero is exactly the document nobody should be handed to
--                      sign. Zero rows is never 'ok'.
--   'overflow'       — the batch has more rows than can be reported in full (> c_max_rows). Never truncated.
--   'incomplete'     — the rows read do not match the batch's own row count, or a row's evidence was
--                      unreadable. An acceptance report missing evidence is worse than no report.
--   'count_mismatch' — the batch's own staging record (result_summary.batch_row_count /
--                      evidence_item_count) disagrees with what is actually stored, OR that record is
--                      damaged: one key without the other, a non-number, or a value outside a
--                      non-negative 32-bit integer. Absence of BOTH keys is the only legitimate
--                      "cannot check", and only for an exact status-matched execution/failure/rollback
--                      verdict that legitimately replaced result_summary wholesale.
--                      Previously the app only WARNED and still rendered a signable page.
-- Authentication, tenancy and role failures RAISE (42501) rather than returning a verdict, so they can
-- never be mistaken for an empty-but-valid report.
--
-- AUTHZ. Three gates, in order:
--   1) p_org must be in public.user_org_ids() — the ACTIVE-org-narrowed, membership-validated set from
--      migration 0085. anon resolves to the empty set; a cross-org id can never be in it.
--   2) public.authorize('finance.read', p_org) — owner/accountant only, the pre-existing permission
--      (no authorize() re-emit here, so the re-emit-drops-a-permission footgun is not in play).
--   3) RLS itself, because the function is SECURITY INVOKER.
-- EXECUTE is revoked from public/anon and granted to authenticated only.
--
-- BOUNDED OUTPUT. At most c_max_rows (1000 — the same cap the staging RPC enforces) rows, each a fixed
-- key set. The row read asks for c_max_rows + 1 so an over-large batch is DETECTED rather than silently
-- truncated to the bound.
--
-- ROLLBACK RUNBOOK (exact):
--   begin;
--   drop function if exists public.fn_reconciliation_acceptance_snapshot(uuid, uuid);
--   commit;
-- Additive-only (one function + its grants). It writes to no table's data, so it is not destructive
-- against an existing database, and a fresh-DB replay after this rollback is byte-identical to a fresh
-- DB that never had it.

begin;

create or replace function public.fn_reconciliation_acceptance_snapshot(p_org uuid, p_batch_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  -- The staging RPC caps a batch at 1000 rows, so a whole-batch read is bounded by construction.
  c_max_rows constant int := 1000;
  -- Names HOW this payload is shaped. The reader pins it, so an older reader can never silently
  -- mis-read a newer snapshot (bump it if any key/serialisation below changes).
  c_version constant text := 'farm-os.reconciliation-acceptance-snapshot.v1';
  -- Explicit UTC ISO-8601 with a literal Z — independent of the session TimeZone / DateStyle.
  c_ts_format constant text := 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"';
  v_batch jsonb;
  v_summary jsonb;
  v_declared int;
  v_fetched int;
  v_missing_evidence int;
  v_distinct_evidence int;
  v_included_count int;
  v_executed_result_count int;
  v_skipped_result_count int;
  v_rows jsonb;
  v_staged_rows int;
  v_staged_evidence int;
  v_has_staged_rows boolean;
  v_has_staged_evidence boolean;
begin
  if p_org is null or p_batch_id is null then
    raise exception 'reconciliation acceptance: organization and batch are required'
      using errcode = '22023';
  end if;

  -- 1) AUTHN + TENANCY. user_org_ids() is active-org-narrowed and membership-validated (0085): an
  --    unauthenticated caller gets the empty set, and a forged/stale claim can only ever narrow.
  if not exists (
    select 1 from public.user_org_ids() as scoped(org_id) where scoped.org_id = p_org
  ) then
    raise exception 'reconciliation acceptance: not a member of the active organization'
      using errcode = '42501';
  end if;

  -- 2) ROLE. finance.read is owner/accountant — exactly the two roles allowed to read and sign this
  --    report. Reused as-is: this migration adds no permission and re-emits no authorize().
  if not public.authorize('finance.read', p_org) then
    raise exception 'reconciliation acceptance: owner or accountant role required'
      using errcode = '42501';
  end if;

  -- 3) The batch itself. RLS applies (SECURITY INVOKER) and the org predicate is the fail-closed
  --    mirror of it. org_id is deliberately NOT returned: the caller already knows it.
  select
    jsonb_build_object(
      'id', b.id,
      'source_label', b.source_label,
      'source_workbook_sha256', b.source_workbook_sha256,
      'status', b.status,
      'created_at', to_char(b.created_at at time zone 'UTC', c_ts_format),
      'created_by', b.created_by,
      'approved_at', to_char(b.approved_at at time zone 'UTC', c_ts_format),
      'approved_by', b.approved_by,
      'result_summary', b.result_summary
    ),
    b.result_summary
  into v_batch, v_summary
  from public.reconciliation_batches b
  where b.id = p_batch_id and b.org_id = p_org;

  if v_batch is null then
    return jsonb_build_object('version', c_version, 'status', 'not_found');
  end if;

  -- 4) The batch's OWN row count, at the same snapshot. Checked before the rows are materialised so an
  --    over-large batch is refused without building a payload for it.
  select count(*)::int
    into v_declared
    from public.reconciliation_batch_rows r
   where r.batch_id = p_batch_id and r.org_id = p_org;

  if v_declared > c_max_rows then
    return jsonb_build_object(
      'version', c_version, 'status', 'overflow',
      'row_count', v_declared, 'max_rows', c_max_rows);
  end if;

  -- A batch with no rows has nothing to accept. Refused here rather than answered with an 'ok'
  -- payload of zero rows, which would render as a complete, signable report whose every total is 0.
  if v_declared = 0 then
    return jsonb_build_object('version', c_version, 'status', 'empty', 'row_count', 0);
  end if;

  -- 5) Every row, with its evidence and its readable dimension labels, in ONE statement.
  --
  --    The evidence join is LEFT, not INNER, on purpose: an inner join would make a row whose evidence
  --    is unreadable VANISH from an otherwise complete-looking report. Here it survives, is counted in
  --    v_missing_evidence, and refuses the whole report below.
  --
  --    The eight label joins are left-outer + same-org, and RLS applies to each of them as well, so an
  --    unreadable dimension yields an EMPTY LABEL — never a dropped row and never another org's name.
  --
  --    LIMIT c_max_rows + 1: an over-large batch is detected, never truncated to the bound.
  select
    coalesce(jsonb_agg(x.row_json order by x.sort_key), '[]'::jsonb),
    count(*)::int,
    count(*) filter (where not x.evidence_present)::int,
    count(distinct x.evidence_item_id)::int,
    count(*) filter (where x.disposition = 'include')::int,
    count(*) filter (
      where x.disposition = 'include' and x.execution_result in ('posted', 'reversed'))::int,
    count(*) filter (
      where x.disposition = 'include' and x.execution_result = 'skipped')::int
    into
      v_rows, v_fetched, v_missing_evidence, v_distinct_evidence,
      v_included_count, v_executed_result_count, v_skipped_result_count
  from (
    select
      r.evidence_item_id::text as sort_key,
      r.evidence_item_id,
      r.disposition,
      r.execution_result,
      (e.id is not null) as evidence_present,
      jsonb_build_object(
        'id', r.id,
        'evidence_item_id', r.evidence_item_id,
        'review_state', r.review_state,
        'disposition', r.disposition,
        'reviewer_id', r.reviewer_id,
        'reviewed_at', to_char(r.reviewed_at at time zone 'UTC', c_ts_format),
        'review_reason', r.review_reason,
        'target_table', r.target_table
      )
      || jsonb_build_object(
        'expense_category', r.expense_category,
        'expense_description', r.expense_description,
        'expense_kind', r.expense_kind,
        'expense_account_id', r.expense_account_id,
        'expense_cost_center_id', r.expense_cost_center_id,
        'expense_supplier_id', r.expense_supplier_id,
        'expense_payment_decision', r.expense_payment_decision
      )
      || jsonb_build_object(
        'sale_crop', r.sale_crop,
        -- ::text — canonical decimal digits, never a JSON number (see EXACT DECIMALS above).
        'sale_quantity', r.sale_quantity::text,
        'sale_unit', r.sale_unit,
        'sale_unit_price', r.sale_unit_price::text,
        'sale_recorded_total', r.sale_recorded_total::text,
        'sale_buyer_id', r.sale_buyer_id,
        'sale_cost_center_id', r.sale_cost_center_id,
        'sale_farm_id', r.sale_farm_id,
        'sale_sector_id', r.sale_sector_id,
        'sale_hawsha_id', r.sale_hawsha_id,
        'sale_season', r.sale_season,
        'sale_delivery_date', r.sale_delivery_date,
        'sale_notes', r.sale_notes,
        'sale_historical_date_decision', r.sale_historical_date_decision,
        'sale_effective_date', r.sale_effective_date
      )
      || jsonb_build_object(
        'corrects_expense_id', r.corrects_expense_id,
        'corrects_sale_id', r.corrects_sale_id,
        'payload_hash', r.payload_hash,
        'frozen', r.frozen,
        'frozen_at', to_char(r.frozen_at at time zone 'UTC', c_ts_format),
        'execution_result', r.execution_result,
        'execution_error', r.execution_error
      )
      || jsonb_build_object(
        'expense_account', case when ea.id is null then null
          else jsonb_build_object('code', ea.code, 'name_ar', ea.name_ar) end,
        'expense_cost_center', case when ecc.id is null then null
          else jsonb_build_object('code', ecc.code, 'name_ar', ecc.name_ar) end,
        'expense_supplier', case when sup.id is null then null
          else jsonb_build_object('name', sup.name) end,
        'sale_buyer', case when buy.id is null then null
          else jsonb_build_object('name', buy.name) end,
        'sale_cost_center', case when scc.id is null then null
          else jsonb_build_object('code', scc.code, 'name_ar', scc.name_ar) end,
        'sale_farm', case when frm.id is null then null
          else jsonb_build_object('name', frm.name) end,
        'sale_sector', case when sec.id is null then null
          else jsonb_build_object('name', sec.name) end,
        'sale_hawsha', case when haw.id is null then null
          else jsonb_build_object('code', haw.code, 'name', haw.name) end
      )
      || jsonb_build_object(
        'evidence', case when e.id is null then null else jsonb_build_object(
          'id', e.id,
          'origin_kind', e.origin_kind,
          'sheet_name', e.sheet_name,
          'row_locator', e.row_locator,
          'snapshot_target_table', e.snapshot_target_table,
          'snapshot_target_id', e.snapshot_target_id,
          'source_workbook_sha256', e.source_workbook_sha256,
          'production_snapshot_sha256', e.production_snapshot_sha256,
          'source_identity_fingerprint', e.source_identity_fingerprint,
          'source_amount', e.source_amount::text,
          'source_date_text', e.source_date_text,
          'source_date_parsed', e.source_date_parsed,
          'classification', e.classification,
          'invalid_calendar_quality_flag', e.invalid_calendar_quality_flag,
          'evidence_label', e.evidence_label
        ) end
      ) as row_json
    from public.reconciliation_batch_rows r
    left join public.reconciliation_evidence_items e
      on e.id = r.evidence_item_id and e.org_id = r.org_id
    left join public.accounts ea       on ea.id  = r.expense_account_id     and ea.org_id  = r.org_id
    left join public.cost_centers ecc  on ecc.id = r.expense_cost_center_id and ecc.org_id = r.org_id
    left join public.suppliers sup     on sup.id = r.expense_supplier_id    and sup.org_id = r.org_id
    left join public.buyers buy        on buy.id = r.sale_buyer_id          and buy.org_id = r.org_id
    left join public.cost_centers scc  on scc.id = r.sale_cost_center_id    and scc.org_id = r.org_id
    left join public.farms frm         on frm.id = r.sale_farm_id           and frm.org_id = r.org_id
    left join public.sectors sec       on sec.id = r.sale_sector_id         and sec.org_id = r.org_id
    left join public.hawshat haw       on haw.id = r.sale_hawsha_id         and haw.org_id = r.org_id
    where r.batch_id = p_batch_id and r.org_id = p_org
    order by r.evidence_item_id
    limit c_max_rows + 1
  ) x;

  if v_fetched > c_max_rows then
    return jsonb_build_object(
      'version', c_version, 'status', 'overflow',
      'row_count', v_fetched, 'max_rows', c_max_rows);
  end if;

  -- 6) Completeness, all at the same snapshot: every row the batch has came back, each carries its
  --    evidence, and no two rows share an evidence item (the batch/evidence unique index).
  if v_fetched <> v_declared
     or v_missing_evidence > 0
     or v_distinct_evidence <> v_fetched
  then
    return jsonb_build_object(
      'version', c_version, 'status', 'incomplete',
      'row_count', v_fetched, 'declared_row_count', v_declared,
      'rows_missing_evidence', v_missing_evidence);
  end if;

  -- 7) The staging record must still describe what is actually stored.
  --
  --    ABSENCE IS ALLOWED ONLY FOR AN EXACT, STATUS-MATCHED TERMINAL VERDICT. Execution, failure and
  --    rollback replace result_summary, so both staging keys legitimately disappear together only
  --    after the batch reaches one of those final statuses. A staged/reviewed/approved batch with an
  --    empty, null or execution-shaped summary is damaged, not exempt from the count proof. The
  --    transient `executing` state is also refused because it has no final outcome to accept.
  --
  --    ANYTHING ELSE IS A REFUSAL, never a skipped check: one key without the other, a value that is
  --    not a JSON number, a non-integer, a negative, or a value beyond the 32-bit range these were
  --    written with. Treating a damaged record as an absent one is how an unverifiable batch would
  --    come to look verified. The digit bound also keeps a hostile value from raising on the ::int
  --    cast, so the refusal is a verdict rather than an error.
  v_has_staged_rows := v_summary is not null and v_summary ? 'batch_row_count';
  v_has_staged_evidence := v_summary is not null and v_summary ? 'evidence_item_count';

  if v_has_staged_rows or v_has_staged_evidence then
    if (v_batch ->> 'status') not in ('staged', 'reviewed', 'approved') then
      return jsonb_build_object(
        'version', c_version, 'status', 'count_mismatch',
        'row_count', v_fetched,
        'evidence_item_count', v_distinct_evidence,
        'staged_counts_state', 'malformed');
    end if;
    if not (v_has_staged_rows and v_has_staged_evidence)
       or jsonb_typeof(v_summary -> 'batch_row_count') <> 'number'
       or jsonb_typeof(v_summary -> 'evidence_item_count') <> 'number'
       or (v_summary ->> 'batch_row_count') !~ '^[0-9]{1,9}$'
       or (v_summary ->> 'evidence_item_count') !~ '^[0-9]{1,9}$'
    then
      return jsonb_build_object(
        'version', c_version, 'status', 'count_mismatch',
        'row_count', v_fetched,
        'evidence_item_count', v_distinct_evidence,
        'staged_counts_state', 'malformed');
    end if;
    v_staged_rows := (v_summary ->> 'batch_row_count')::int;
    v_staged_evidence := (v_summary ->> 'evidence_item_count')::int;

    if v_staged_rows <> v_fetched or v_staged_evidence <> v_distinct_evidence then
      return jsonb_build_object(
        'version', c_version, 'status', 'count_mismatch',
        'row_count', v_fetched,
        'evidence_item_count', v_distinct_evidence,
        'staged_counts_state', 'recorded',
        'staged_batch_row_count', v_staged_rows,
        'staged_evidence_item_count', v_staged_evidence);
    end if;
  elsif (v_batch ->> 'status') = 'executed' then
    if jsonb_typeof(v_summary) is distinct from 'object' then
      return jsonb_build_object(
        'version', c_version, 'status', 'count_mismatch',
        'row_count', v_fetched,
        'evidence_item_count', v_distinct_evidence,
        'staged_counts_state', 'malformed');
    end if;
    if not (v_summary ?& array['executed_rows', 'skipped_rows'])
       or (v_summary - array['executed_rows', 'skipped_rows']::text[]) <> '{}'::jsonb
       or jsonb_typeof(v_summary -> 'executed_rows') is distinct from 'number'
       or jsonb_typeof(v_summary -> 'skipped_rows') is distinct from 'number'
       or (v_summary ->> 'executed_rows') !~ '^[0-9]{1,9}$'
       or (v_summary ->> 'skipped_rows') !~ '^[0-9]{1,9}$'
    then
      return jsonb_build_object(
        'version', c_version, 'status', 'count_mismatch',
        'row_count', v_fetched,
        'evidence_item_count', v_distinct_evidence,
        'staged_counts_state', 'malformed');
    end if;
    if (v_summary ->> 'executed_rows')::int <> v_executed_result_count
       or (v_summary ->> 'skipped_rows')::int <> v_skipped_result_count
       or v_executed_result_count + v_skipped_result_count <> v_included_count
    then
      return jsonb_build_object(
        'version', c_version, 'status', 'count_mismatch',
        'row_count', v_fetched,
        'evidence_item_count', v_distinct_evidence,
        'staged_counts_state', 'recorded');
    end if;
  elsif (v_batch ->> 'status') = 'failed' then
    if jsonb_typeof(v_summary) is distinct from 'object' then
      return jsonb_build_object(
        'version', c_version, 'status', 'count_mismatch',
        'row_count', v_fetched,
        'evidence_item_count', v_distinct_evidence,
        'staged_counts_state', 'malformed');
    end if;
    if not (v_summary ?& array['failure_code', 'safe_locator'])
       or (v_summary - array['failure_code', 'safe_locator']::text[]) <> '{}'::jsonb
       or jsonb_typeof(v_summary -> 'failure_code') is distinct from 'string'
       or coalesce(btrim(v_summary ->> 'failure_code'), '') = ''
       or jsonb_typeof(v_summary -> 'safe_locator') is null
       or jsonb_typeof(v_summary -> 'safe_locator') not in ('string', 'null')
       or (jsonb_typeof(v_summary -> 'safe_locator') = 'string'
           and coalesce(btrim(v_summary ->> 'safe_locator'), '') = '')
    then
      return jsonb_build_object(
        'version', c_version, 'status', 'count_mismatch',
        'row_count', v_fetched,
        'evidence_item_count', v_distinct_evidence,
        'staged_counts_state', 'malformed');
    end if;
  elsif (v_batch ->> 'status') = 'rolled_back' then
    if jsonb_typeof(v_summary) is distinct from 'object' then
      return jsonb_build_object(
        'version', c_version, 'status', 'count_mismatch',
        'row_count', v_fetched,
        'evidence_item_count', v_distinct_evidence,
        'staged_counts_state', 'malformed');
    end if;
    if not (v_summary ?& array[
         'rolled_back_at', 'rollback_reason', 'reversed_journals', 'reinstated_journals',
         'zero_value_rows', 'ledger_rows_reversed', 'rows_marked_reversed'])
       or (v_summary - array[
         'rolled_back_at', 'rollback_reason', 'reversed_journals', 'reinstated_journals',
         'zero_value_rows', 'ledger_rows_reversed', 'rows_marked_reversed']::text[]) <> '{}'::jsonb
       or jsonb_typeof(v_summary -> 'rolled_back_at') is distinct from 'string'
       or coalesce(btrim(v_summary ->> 'rolled_back_at'), '') = ''
       or jsonb_typeof(v_summary -> 'rollback_reason') is distinct from 'string'
       or coalesce(btrim(v_summary ->> 'rollback_reason'), '') = ''
       or jsonb_typeof(v_summary -> 'reversed_journals') is distinct from 'number'
       or jsonb_typeof(v_summary -> 'reinstated_journals') is distinct from 'number'
       or jsonb_typeof(v_summary -> 'zero_value_rows') is distinct from 'number'
       or jsonb_typeof(v_summary -> 'ledger_rows_reversed') is distinct from 'number'
       or jsonb_typeof(v_summary -> 'rows_marked_reversed') is distinct from 'number'
       or (v_summary ->> 'reversed_journals') !~ '^[0-9]{1,9}$'
       or (v_summary ->> 'reinstated_journals') !~ '^[0-9]{1,9}$'
       or (v_summary ->> 'zero_value_rows') !~ '^[0-9]{1,9}$'
       or (v_summary ->> 'ledger_rows_reversed') !~ '^[0-9]{1,9}$'
       or (v_summary ->> 'rows_marked_reversed') !~ '^[0-9]{1,9}$'
    then
      return jsonb_build_object(
        'version', c_version, 'status', 'count_mismatch',
        'row_count', v_fetched,
        'evidence_item_count', v_distinct_evidence,
        'staged_counts_state', 'malformed');
    end if;
  else
    return jsonb_build_object(
      'version', c_version, 'status', 'count_mismatch',
      'row_count', v_fetched,
      'evidence_item_count', v_distinct_evidence,
      'staged_counts_state', 'malformed');
  end if;

  return jsonb_build_object(
    'version', c_version,
    'status', 'ok',
    'max_rows', c_max_rows,
    'row_count', v_fetched,
    'evidence_item_count', v_distinct_evidence,
    'batch', v_batch,
    'rows', v_rows);
end;
$$;

revoke execute on function public.fn_reconciliation_acceptance_snapshot(uuid, uuid) from public, anon;
grant execute on function public.fn_reconciliation_acceptance_snapshot(uuid, uuid) to authenticated;

comment on function public.fn_reconciliation_acceptance_snapshot(uuid, uuid) is
  'Read-only, SECURITY INVOKER, single-snapshot acceptance-report payload for one reconciliation batch: '
  'active-org + owner/accountant gated, bounded to 1000 rows, fail-closed on overflow / incomplete rows / '
  'staging-count mismatch, with every numeric accounting field serialised as canonical decimal text.';

commit;
