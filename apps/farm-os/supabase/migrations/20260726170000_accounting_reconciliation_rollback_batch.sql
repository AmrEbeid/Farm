-- Accounting reconciliation ROLLBACK (append-only; the reverse of the one execution path).
--
-- WHAT THIS SLICE ADDS. `public.fn_rollback_reconciliation_batch(uuid, text)` — owner-only,
-- whole-batch atomic, and the ONLY way to undo an `executed` reconciliation batch. It reverses
-- every posting the batch created and reinstates every production journal the batch reversed, for
-- expense-only, sale-only and MIXED batches alike, WITHOUT A SINGLE DELETE: the execution's own
-- action links, ledger rows, journals and domain rows all survive verbatim and the undo is appended
-- on top of them.
--
-- It also closes the two lock-order defects the mutex this slice introduces would otherwise leave open:
-- §0a re-emits `public.fn_execute_reconciliation_batch` so the executor takes the mutex before its own
-- row locks like every other money writer, and §0's reversal re-emit resolves its org through the
-- caller's membership so no authenticated caller can take — or time — another tenant's mutex.
--
-- WHY THIS IS NOT "JUST REVERSE EVERYTHING". The execution path takes two structurally different
-- kinds of action, and they undo in opposite directions:
--
--   * It CREATED money (`addition`, `correction_replacement`): a brand-new expense/sale row plus a
--     brand-new posted journal. Undoing that means posting the exact inverse of the created journal
--     and moving the created row into the existing `historical_reversed` state, stamped with
--     `reversed_by_rollback_at` (the column 20260726090000 added for exactly this moment).
--
--   * It REVERSED money that already existed (`correction_reversal`, and the `orphan_reversal` kind
--     the schema reserves): a production journal that was posted BEFORE the batch ran was reversed,
--     and its domain row moved to `historical_reversed`. Undoing that means REINSTATING the original
--     posting — and it must be reinstated EXACTLY, which is precisely why 20260726090000 captured an
--     immutable typed snapshot (reconciliation_baseline_journal_headers/_lines) instead of a bare
--     hash. Reversing the reversal would NOT do: `private.fn_reverse_journal_entry_internal` writes
--     its own `عكس القيد:` description, dates the new entry on the reversal date it is handed, and
--     rewrites every line description — so the reinstated entry would carry rollback metadata where
--     the original's own text, and only the original's own text, belongs. The baseline snapshot is
--     replayed column-for-column instead, and the result is proved against that snapshot before the
--     transaction is allowed to continue.
--
--   * `zero_value_noop` moved no money and writes nothing here. Its ledger row still transitions, so
--     the evidence item is released for a future batch exactly like every other row.
--
-- POSTED-AUDIT COLUMNS ARE NOT FABRICATED. A reinstated entry copies every replay-relevant typed
-- column from the snapshot — entry_date, source_type, source_id, description, reversal_of, and every
-- line's account/debit/credit/description/cost_center/custody/expense/payment-request dimension — but
-- takes a NEW `source_sequence` (deterministically `max + 1`, the same rule 20260706081636
-- established for re-posting a source) and lets `posted_at`/`posted_by` default to now()/auth.uid().
-- Copying the original's `posted_at` would assert that this row was written at a time it was not:
-- project rule #1 forbids fabricating a financial fact, and "when the ledger was written" is one.
-- The exactness proof therefore covers every accounting-relevant column and deliberately excludes the
-- three identity/audit columns that MUST differ for a new row (id, source_sequence, posted_at/by).
--
-- NO TERMINAL FAILURE STATE, ON PURPOSE. Execution has a `failed` batch status because a failed
-- execution is a real, reportable verdict on an approved batch. A rollback has no such state: the
-- batch genuinely IS still `executed` until the whole undo succeeds. So this function installs NO
-- exception handler at all — every error (including a transient 40001/40P01/55P03) aborts the whole
-- transaction, the early `rolled_back` status write disappears with it, and the batch is left exactly
-- `executed` for the owner to retry. A concurrency blip can therefore never strand a terminal state,
-- and a half-rolled-back batch is unrepresentable.
--
-- THE TWO LIFECYCLE GUARDS ARE EXTENDED, NEVER WEAKENED. `private.fn_guard_historical_treasury_expense`
-- (20260726150000) and `private.fn_guard_historical_treasury_sale` (20260726160000) both freeze a
-- `historical_reversed` row against every column except `reversed_by_rollback_at`, and both prove a
-- `historical_reversed` claim ONLY through an execution-time `correction_reversal` action link. Two
-- transitions this rollback must perform are therefore currently impossible, and both are opened by
-- ADDING an alternative proof, never by removing an existing one:
--
--   1. created row  historical_treasury -> historical_reversed. Proved by
--      private.fn_reconciliation_rollback_reversed_proof: an `addition`/`correction_replacement` link
--      for this exact row, in a batch whose status is ALREADY `rolled_back`, whose created journal is
--      now `reversed` and has a real reversing entry behind it.
--   2. original row historical_reversed -> historical_treasury. Proved by
--      private.fn_reconciliation_rollback_reinstated_proof: a reinstatement link for this exact row,
--      in a batch whose status is ALREADY `rolled_back`, whose `journal_entry_id` is a POSTED journal
--      for this row and whose `reinstates_journal_entry_id` is a REVERSED journal for this row.
--
-- Both proofs read only append-only evidence this rollback has already written, which is why the
-- batch status moves to `rolled_back` FIRST: the guards must be able to see that this is a rollback,
-- and a status a caller cannot set (reconciliation_batches is RPC-write-only) is the honest signal.
-- Every other clause of both guards — insert-time claims, field immutability, the no-reroute rule,
-- the DELETE refusal, and the original `correction_reversal` proof — is reproduced verbatim.
--
-- FIELD IMMUTABILITY IS NOT RELAXED EITHER. The created row's two changes are written as two separate
-- single-column UPDATEs (`payment_status`, then `reversed_by_rollback_at`) precisely so neither guard's
-- "a historical transition cannot alter other fields" clause has to be widened to admit a second
-- column. The restore is a single-column UPDATE for the same reason.
--
-- LOCK ORDER (deterministic, and identical for an expense-only, sale-only or mixed batch):
--   per-org period mutex (SHARED) -> batch -> batch rows (by evidence_item_id) -> cash 1010
--   -> action links (by id) -> execution ledger rows (by id) -> target expenses (by id)
--   -> their journals (by id) -> their lines (by id) -> target sales (by id) -> their journals (by id)
--   -> their lines (by id)
-- The mutex comes FIRST — before every row lock — and §0a puts `fn_execute_reconciliation_batch` on the
-- identical prefix, so neither function can ever be queued for the mutex while holding a row the other
-- one wants. Cash 1010 is then taken at exactly the position the executor takes it, so execution and
-- rollback contend on the same single serialization point and can never interleave into a lock cycle —
-- even though rollback afterwards touches action links and ledger rows BEFORE the domain rows the
-- executor locks first.
--
-- A RESTORED SALE STAYS CORRECTABLE — the exact-history proof is EXTENDED, not weakened. After a
-- rollback, a reinstated SALE carries three journals for one source (original, execution reversal,
-- reinstatement), and after a second correction+rollback cycle, five. The
-- 20260726160000 §3 definition of `private.fn_reconciliation_sale_has_exact_historical_journal`
-- demanded exactly ONE journal in ANY status, so it stopped certifying such a row and a future batch
-- could never pick it as an amount-correction target again. A reconciliation tool that can undo a
-- mistake exactly once is not a reconciliation tool, so §1b re-emits that proof with a SECOND
-- accepted shape. The two shapes are:
--
--   (a) PRISTINE — exactly one journal for this sale, in any status, and it is the posted one.
--       Byte-for-byte the original predicate, so nothing that used to certify stops certifying.
--   (b) RESTORED — exactly one CURRENT POSTED journal, which must itself be a rollback
--       reinstatement, plus a CLOSED CHAIN accounting for every other journal the sale carries.
--
-- WHAT "CLOSED CHAIN" PROVES (private.fn_reconciliation_sale_restoration_chain_is_closed). The count
-- is NOT loosened to "one posted"; every additional journal must be shown to be a spent half of a
-- completed reversal/reinstatement cycle, and the cycles must exactly tile the sale's history:
--
--   * every action link naming this sale lives in a batch whose status is `rolled_back` — a link in
--     an executed/executing batch means a cycle is still OPEN, and the sale is not restored at all;
--   * the current posted journal is the `journal_entry_id` of a reinstatement link whose
--     `reinstates_journal_entry_id` is a REVERSED journal of THIS sale in THIS org;
--   * every other journal is `reversed` AND is either (i) an original that a linked reversal entry
--     really reverses and that the SAME batch reinstated, or (ii) a reversal entry that a
--     `correction_reversal`/`orphan_reversal` link names and whose own target was reinstated by the
--     SAME batch. An injected, unlinked, cross-batch, cross-org or wrong-target journal satisfies
--     neither and fails the whole proof closed;
--   * the arithmetic closes: reversed originals = reversal entries = reversal links = reinstatement
--     links, those links are distinct (no two reinstatements may claim one original), exactly one
--     journal is posted, and originals + reversals + that one posted entry is EVERY journal the sale
--     has. A stray draft/void/extra entry breaks the total and fails.
--
-- Everything the original proof asserted about the CURRENT posted journal is untouched and still
-- applies to shape (b): finalized price, a positive total, zero collection rows, the entry on the
-- sale's own economic date under the pinned UTC zone, exactly TWO lines, Dr 1010 for the exact total
-- and Cr one TYPED revenue leaf (never the 4000 parent) for the exact total. The expense side needs
-- no equivalent change — its proof was always journal-shape based, never journal-count based.
--
-- THE ACTION LINKS ARE THE EXECUTION RECORD, SO THEY ARE MADE UNFORGEABLE AND PROVED COMPLETE.
-- Everything below is driven by `reconciliation_action_links`, and the ledger claim is released for
-- every row this batch executed whether or not a link was found for it — so a missing, duplicated,
-- relabelled or detached link would release the claim and mark the batch `rolled_back` while the
-- journal it named stayed POSTED: money reported as returned that is still spent. Two additions close
-- that, and they are independent:
--
--   * §0b makes the table APPEND-ONLY — every UPDATE and every DELETE is refused by a trigger, from any
--     role including the table owner and any SECURITY DEFINER path, in exactly the shape 20260726090000
--     §6 uses for the baseline snapshots — plus a unique index on (batch_row_id, action_kind), which is
--     compatible with every bundle the executor and this rollback can produce.
--   * §4b PROVES the bundle before the batch status moves and before any money is touched, in both
--     directions: forward, every `executed` ledger row this batch owns carries EXACTLY the kinds its
--     frozen review decision and its evidence item require; reverse, every original execution link maps
--     to exactly one owned `executed` ledger row for the same batch row, evidence item and org. Each
--     link is then matched against what it claims to have done. Nothing derives the expectation from
--     the links themselves, so a forged link cannot certify itself.
--
-- PERIOD CLOSE NO LONGER RACES A POSTING. `public.fn_period_locked` is a plain SELECT, so every caller
-- had a window between "is this date closed?" and the INSERT in which another transaction could commit
-- a close. §0 replaces that with one per-org transaction advisory mutex for the whole codebase: journal
-- posting, reversal and rollback reinstatement take it SHARED; period close and reopen take it
-- EXCLUSIVE. FIVE functions are re-emitted from their CURRENT definitions to add nothing but the
-- acquisition — `public.fn_close_accounting_period`, `public.fn_reopen_accounting_period`,
-- `public.fn_post_two_line_journal` (from 20260706081636, so source_sequence semantics and the
-- cost-center dimension are preserved), `private.fn_reverse_journal_entry_internal` (from
-- 20260726160000, so the historical direct-reversal block for BOTH domains is preserved) and
-- `public.fn_execute_reconciliation_batch` (§0a, from 20260726160000 §8, so every expense, sale and
-- mixed guarantee is preserved). The executor is in that list because the mutex-first order is only a
-- real guarantee if EVERY money writer obeys it: an executor that took its rows first and the mutex
-- later could sit in the share queue behind a pending close while holding rows a rollback needed, and
-- that is a three-party cycle. See §0a.
--
-- THE PUBLIC REVERSAL NEVER TOUCHES ANOTHER TENANT'S MUTEX — OR ANOTHER TENANT'S ROW.
-- `private.fn_reverse_journal_entry_internal` receives an ENTRY, not an org, and is reachable from the
-- AUTHENTICATED wrapper `public.fn_reverse_journal_entry`. Its org-resolving read is therefore
-- membership-filtered with the same predicate as its own authorization check, and that read now
-- gates BOTH locks it takes: a foreign journal uuid resolves to null and is refused by a non-locking
-- existence probe with the unchanged 42501, never reaching the mutex; and the `for update` that
-- follows for an admitted caller is scoped to `org_id = v_lock_org`, so a foreign journal ROW can no
-- longer be queued on either. No foreign lock of any kind, and no wait to time — neither a period
-- close nor a concurrent write on that tenant's journal is observable through this entry point. Same
-- for the executor's resolving read and a foreign batch uuid.
--
-- NO DATA IS ROLLED BACK BY THIS MIGRATION. No real reconciliation batch runs here.
--
-- ROLLBACK RUNBOOK (exact):
--   begin;
--   drop function if exists public.fn_rollback_reconciliation_batch(uuid, text);
--   drop function if exists private.fn_reconciliation_rollback_assert_action_bundle(uuid, uuid);
--   drop function if exists private.fn_reconciliation_reinstate_baseline_journal(uuid, uuid, uuid);
--   drop function if exists private.fn_reconciliation_rollback_reinstated_proof(uuid, text, uuid);
--   drop function if exists private.fn_reconciliation_rollback_reversed_proof(uuid, text, uuid);
--   -- §0b append-only guard + uniqueness on the action links:
--   drop trigger if exists guard_reconciliation_action_link_append_only
--     on public.reconciliation_action_links;
--   drop function if exists public.fn_guard_reconciliation_action_link_append_only();
--   drop index if exists public.reconciliation_action_links_row_kind_uq;
--   -- §0 period mutex — RE-EMIT each function from the source named below FIRST (each is otherwise
--   -- unchanged, so the re-emit simply removes the acquisition), and only THEN drop the key helper,
--   -- because Postgres refuses to drop a function a current definition still calls:
--   --   re-emit public.fn_close_accounting_period(uuid, date, date, text)  from 20260701550000 §3
--   --   re-emit public.fn_reopen_accounting_period(uuid, uuid)             from 20260701550000 §4
--   --   re-emit public.fn_post_two_line_journal(...14 args...)             from 20260706081636
--   --   re-emit private.fn_reverse_journal_entry_internal(uuid, text, date, boolean)
--   --                                                                      from 20260726160000 §7
--   --   re-emit public.fn_execute_reconciliation_batch(uuid)               from 20260726160000 §8
--   --     (the §0a re-emit is that definition plus one mutex block and one `v_lock_org` declaration,
--   --      so re-emitting §8 verbatim removes both and restores the pre-slice executor exactly)
--   -- (re-apply each one's trailing revoke/grant/comment lines verbatim with it), THEN
--   drop function if exists private.fn_accounting_period_mutex_key(uuid);
--   -- RESTORE THE PREVIOUS PROOF HELPER FIRST, then drop the chain helper it depends on:
--   -- re-emit private.fn_reconciliation_sale_has_exact_historical_journal from 20260726160000 §3
--   --   verbatim (the count(*) = 1 form), which drops this migration's chain branch, THEN
--   drop function if exists private.fn_reconciliation_sale_restoration_chain_is_closed(uuid, uuid);
--   -- (dropping the chain helper before re-emitting the proof would fail: the proof is a SQL-bodied
--   --  function and Postgres refuses to drop a function the current definition still calls.)
--   -- re-emit private.fn_guard_historical_treasury_sale from 20260726160000 §4 verbatim.
--   -- re-emit private.fn_guard_historical_treasury_expense from 20260726150000 verbatim.
--   commit;
-- After that restore, a sale rolled back while this migration was applied reverts to being
-- uncorrectable (it carries three journals again) — the data is untouched and correct, only the
-- future-correction eligibility narrows back to the pre-slice behaviour.
-- A fresh-DB replay after this rollback DDL is byte-identical to a fresh DB with only 20260726160000
-- applied. This migration performs no writes to any existing table's DATA and adds no DDL to any
-- table, so it is not destructive against an existing database either.

begin;

-- ── 0) THE PER-ORG ACCOUNTING-PERIOD MUTEX ────────────────────────────────────────────────────────
--
-- `public.fn_period_locked` is a plain SELECT, so every caller that asks "is this date closed?" and
-- then writes a journal has a window between the answer and the write. Another transaction can COMMIT
-- a period close inside that window, and the posting lands in a period the ledger now reports as
-- closed. This affects rollback reinstatement, rollback reversal, and every pre-existing posting and
-- reversal path, because they all funnel through the same two helpers.
--
-- THE CONTRACT (one, deterministic, per organization, for the whole codebase):
--
--   * MONEY WRITERS take the mutex in SHARE mode — `public.fn_post_two_line_journal`,
--     `private.fn_reverse_journal_entry_internal`, `private.fn_reconciliation_reinstate_baseline_journal`,
--     `public.fn_rollback_reconciliation_batch` and `public.fn_execute_reconciliation_batch` (§0a).
--     Share mode does not conflict with itself, so ordinary concurrent posting is exactly as parallel
--     as it was before this migration. The list is EXHAUSTIVE by construction: every path that writes a
--     journal row funnels through one of these five, and each of the five takes the mutex before its own
--     first row lock (§0a explains why "before" is the load-bearing word).
--   * PERIOD-STATE WRITERS take it EXCLUSIVE — `public.fn_close_accounting_period` and
--     `public.fn_reopen_accounting_period`. Exclusive conflicts with every share holder, so a close
--     cannot commit while any posting transaction is still open, and a posting cannot start while a
--     close is in flight. `fn_period_locked` is then read under a lock state that cannot change
--     underneath it for the rest of the transaction.
--
-- IT IS A TRANSACTION lock (`pg_advisory_xact_lock*`), never a session lock: it is released by COMMIT
-- or ROLLBACK with no unlock call, so an aborted rollback can never strand it. `pg_catalog`-qualified
-- so an empty `search_path` cannot be tricked into resolving a shadowing function.
--
-- LOCK ORDER, AND WHY THERE IS NO UPGRADE DEADLOCK. No function in this codebase takes SHARE and then
-- asks for EXCLUSIVE, so the classic upgrade cycle cannot form. The money writers take the mutex as
-- EARLY as they can — before their own row locks — which is the stronger of the two available
-- orderings: a transaction that holds a row lock therefore already holds the share lock and can never
-- queue behind a pending exclusive request while another transaction waits on its rows. (Postgres
-- queues a later share request behind a pending exclusive one to avoid writer starvation, so the
-- opposite ordering — rows first, mutex second — really can close a three-party cycle.)
-- `public.fn_rollback_reconciliation_batch` therefore takes it before its own lock ladder,
-- `public.fn_execute_reconciliation_batch` does the same as of §0a, and the reinstatement helper takes
-- it again as a defence in depth: a lock already held by this transaction is re-granted immediately, so
-- the second acquisition is free.
--
-- NO ACQUISITION IS EVER MADE FOR AN ORGANIZATION THE CALLER IS NOT A MEMBER OF. Two of the five money
-- writers are handed an opaque uuid by an authenticated caller — the executor a batch id, the reversal
-- a journal id — and must resolve the org from it before they can compute a key. Both resolving reads
-- are membership-filtered with `org_id in (select public.user_org_ids())`, the same predicate as the
-- authorization each is about to apply, so a foreign uuid resolves to null and no lock is taken. This
-- matters twice over: an unauthorized caller must not be able to hold another tenant's accounting close
-- open, and must not be able to tell a foreign uuid from a non-existent one by timing how long the
-- redacted refusal takes to come back.
--
-- THE KEY IS DERIVED FROM THE ORG UUID AND NOTHING ELSE, so every backend computes the same bigint for
-- the same tenant with no shared registry and no ordering assumption. md5 is used rather than
-- `hashtext`/`hashtextextended` because its output is defined by the algorithm, not by a server
-- implementation detail that may be re-tuned across major versions. A hypothetical 2^-64 collision
-- with another advisory-lock user (20260701530000's بون serial, 20260726140000's batch key) can only
-- cost extra serialization; it can never make either lock admit a writer it should have blocked.
create or replace function private.fn_accounting_period_mutex_key(p_org uuid)
returns bigint
language sql
immutable
parallel safe
set search_path = ''
as $$
  select ('x' || pg_catalog.substr(pg_catalog.md5(p_org::text), 1, 16))::bit(64)::bigint;
$$;
revoke execute on function private.fn_accounting_period_mutex_key(uuid)
  from public, anon, authenticated;
comment on function private.fn_accounting_period_mutex_key(uuid) is
  'Deterministic per-organization advisory-lock key (derived from the org UUID alone). Journal '
  'posting/reversal/reinstatement take it SHARED; accounting-period close/reopen take it EXCLUSIVE.';

-- 20260701550000 §3 re-emitted VERBATIM — same signature, same SECURITY DEFINER + empty search_path,
-- same argument validation, the same owner/accountant role check, the same overlap rule and SQLSTATEs,
-- the same grants below. The ONLY change is the marked ▼▼/▲▲ mutex acquisition, placed AFTER the role
-- check (an unauthorized caller must not be able to take a tenant's lock) and BEFORE the overlap
-- decision and the insert, so no posting can slip in between the overlap read and the commit.
create or replace function public.fn_close_accounting_period(
  p_org uuid,
  p_period_start date,
  p_period_end date,
  p_note text default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_org is null then raise exception 'org required' using errcode = '23502'; end if;
  if p_period_start is null or p_period_end is null then
    raise exception 'period bounds required' using errcode = '23502'; end if;
  if p_period_end < p_period_start then
    raise exception 'period end before start' using errcode = '22023'; end if;

  -- owner or accountant of THIS org (definer bypasses RLS, so the org+role scope is checked explicitly)
  if not exists (
    select 1 from public.organization_member
     where user_id = (select auth.uid()) and org_id = p_org and role in ('owner', 'accountant')
  ) then
    raise exception 'forbidden: only the owner or accountant may close a period' using errcode = '42501';
  end if;

  -- ▼▼ per-org period mutex, EXCLUSIVE (see §0). Taken before the overlap decision and the insert, so
  --    every in-flight posting for this org has committed or aborted before this close is decided. ▼▼
  perform pg_catalog.pg_advisory_xact_lock(private.fn_accounting_period_mutex_key(p_org));
  -- ▲▲ end period mutex ▲▲

  -- a date can belong to at most one locked period: reject an overlap with an existing locked range
  if exists (
    select 1 from public.accounting_periods
     where org_id = p_org and status = 'locked'
       and daterange(period_start, period_end, '[]') && daterange(p_period_start, p_period_end, '[]')
  ) then
    raise exception 'period overlaps an existing locked period' using errcode = '23505';
  end if;

  insert into public.accounting_periods(org_id, period_start, period_end, status, note)
  values (p_org, p_period_start, p_period_end, 'locked', p_note)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.fn_close_accounting_period(uuid, date, date, text) from public, anon;
grant execute on function public.fn_close_accounting_period(uuid, date, date, text) to authenticated;

-- 20260701550000 §4 re-emitted VERBATIM — owner-only, same SQLSTATEs, same grants. The ONLY change is
-- the marked mutex acquisition, before the status decision the UPDATE makes.
create or replace function public.fn_reopen_accounting_period(p_org uuid, p_period_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_org is null or p_period_id is null then
    raise exception 'org and period id required' using errcode = '23502'; end if;

  if not exists (
    select 1 from public.organization_member
     where user_id = (select auth.uid()) and org_id = p_org and role = 'owner'
  ) then
    raise exception 'forbidden: only the owner may reopen a period' using errcode = '42501';
  end if;

  -- ▼▼ per-org period mutex, EXCLUSIVE (see §0) — before the status decision below. ▼▼
  perform pg_catalog.pg_advisory_xact_lock(private.fn_accounting_period_mutex_key(p_org));
  -- ▲▲ end period mutex ▲▲

  update public.accounting_periods
     set status = 'open', reopened_by = (select auth.uid()), reopened_at = now()
   where id = p_period_id and org_id = p_org and status = 'locked';
  if not found then
    raise exception 'no locked period % to reopen in this org', p_period_id using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.fn_reopen_accounting_period(uuid, uuid) from public, anon;
grant execute on function public.fn_reopen_accounting_period(uuid, uuid) to authenticated;

-- 20260706081636 re-emitted VERBATIM — the CURRENT definition, which carries `source_sequence`
-- re-post semantics, the row-lock-then-max+1 sequence rule, the posted-only idempotency return, the
-- cost-center dimension (`v_exp_cost_center`), the account/expense tenant checks, the Arabic 55000
-- period message, and the same revoke (no client EXECUTE — it is an internal choke point). The ONLY
-- change is the marked mutex acquisition, taken as the FIRST thing the body does after argument
-- validation: before the journal row locks, before the lock-state check, before any write.
create or replace function public.fn_post_two_line_journal(
  p_org uuid,
  p_entry_date date,
  p_source_type text,
  p_source_id uuid,
  p_description text,
  p_debit_account uuid,
  p_credit_account uuid,
  p_amount numeric,
  p_debit_description text default null,
  p_credit_description text default null,
  p_custody_account uuid default null,
  p_custody_movement uuid default null,
  p_expense uuid default null,
  p_payment_request uuid default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_source_type text;
  v_source_sequence integer;
  v_existing uuid;
  v_entry uuid;
  v_debit_org uuid;
  v_credit_org uuid;
  v_exp_org uuid;
  v_exp_cost_center uuid;
begin
  if p_org is null then raise exception 'org required' using errcode = '23502'; end if;
  v_source_type := trim(coalesce(p_source_type, ''));
  if v_source_type = '' then raise exception 'source_type required' using errcode = '23502'; end if;
  if p_source_id is null then raise exception 'source_id required' using errcode = '23502'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'journal amount must be positive' using errcode = '22023'; end if;

  -- ▼▼ per-org period mutex, SHARE (see §0). Taken before the journal row locks so a transaction that
  --    holds journal rows always already holds this lock, and before the period check below so the
  --    lock state cannot change between the check and the insert. ▲ Share does not conflict with
  --    share, so concurrent postings are unaffected. ▼▼
  perform pg_catalog.pg_advisory_xact_lock_shared(private.fn_accounting_period_mutex_key(p_org));
  -- ▲▲ end period mutex ▲▲

  perform 1
    from public.journal_entries
   where org_id = p_org
     and source_type = v_source_type
     and source_id = p_source_id
   order by source_sequence
   for update;

  select id into v_existing
    from public.journal_entries
   where org_id = p_org
     and source_type = v_source_type
     and source_id = p_source_id
     and status = 'posted'
   order by source_sequence desc
   limit 1;
  if v_existing is not null then
    return v_existing;
  end if;

  select coalesce(max(source_sequence), 0) + 1 into v_source_sequence
    from public.journal_entries
   where org_id = p_org
     and source_type = v_source_type
     and source_id = p_source_id;

  -- Keep the period-lock guard after the idempotency return: repeat submissions of the current posted
  -- entry stay harmless no-ops, while corrected re-posts after a reversal count as genuinely new postings.
  if public.fn_period_locked(p_org, coalesce(p_entry_date, current_date)) then
    raise exception 'الفترة المحاسبية مقفلة — لا يمكن ترحيل قيد بتاريخ %', coalesce(p_entry_date, current_date)
      using errcode = '55000';
  end if;

  select org_id into v_debit_org from public.accounts where id = p_debit_account;
  select org_id into v_credit_org from public.accounts where id = p_credit_account;
  if v_debit_org is distinct from p_org or v_credit_org is distinct from p_org then
    raise exception 'journal accounts must belong to the entry org' using errcode = '42501';
  end if;

  if p_expense is not null then
    select org_id, cost_center_id into v_exp_org, v_exp_cost_center
      from public.expenses
     where id = p_expense;
    if v_exp_org is null then
      raise exception 'expense % not found', p_expense using errcode = 'P0002';
    end if;
    if v_exp_org is distinct from p_org then
      raise exception 'journal expense must belong to the entry org' using errcode = '42501';
    end if;
  end if;

  insert into public.journal_entries(org_id, entry_date, source_type, source_id, source_sequence, description)
  values (p_org, coalesce(p_entry_date, current_date), v_source_type, p_source_id, v_source_sequence, p_description)
  returning id into v_entry;

  insert into public.journal_lines(
    org_id, journal_entry_id, account_id, debit, credit, description,
    custody_account_id, custody_movement_id, expense_id, payment_request_id, cost_center_id)
  values
    (p_org, v_entry, p_debit_account, p_amount, 0, p_debit_description,
     p_custody_account, p_custody_movement, p_expense, p_payment_request, v_exp_cost_center),
    (p_org, v_entry, p_credit_account, 0, p_amount, p_credit_description,
     p_custody_account, p_custody_movement, p_expense, p_payment_request, null);

  return v_entry;
end;
$$;
revoke execute on function public.fn_post_two_line_journal(uuid, date, text, uuid, text, uuid, uuid, numeric, text, text, uuid, uuid, uuid, uuid) from public, anon, authenticated;

-- 20260726160000 §7 re-emitted VERBATIM — the CURRENT definition, which carries the historical-
-- reconciliation direct-reversal block for BOTH domains, the `p_reconciliation_context` privilege
-- boundary, the org-membership + budget.write checks in their original order (the block deliberately
-- sits AFTER them, so it is not a cross-tenant existence oracle), the reversal-of-a-reversal refusal,
-- the idempotent already-reversed return, both period-lock checks, the source_sequence rule, the
-- Arabic reversal descriptions and the cost-center dimension on every copied line. The ONLY changes
-- are to the LOCK ORDER: which locks this function takes, and when. No verdict, no message, no
-- SQLSTATE, no guard and no written row moves.
--
-- NOTHING IS LOCKED BEFORE THE CALLER IS AUTHORIZED — NOT THE MUTEX, AND NOT THE JOURNAL ROW. This
-- function is reachable from an AUTHENTICATED public wrapper (`public.fn_reverse_journal_entry`, §7
-- of 20260726160000) that passes any uuid the caller cares to type. Because the function receives an
-- ENTRY, not an org, the org is resolved by one non-locking, MEMBERSHIP-FILTERED read first, and that
-- read IS the authorization decision. Two distinct defects are closed by placing it first — one for
-- each lock this function used to take ahead of the membership check:
--
--   * THE MUTEX. An unfiltered `select org_id ... where id = p_entry` would resolve ANOTHER TENANT'S
--     org from a foreign journal uuid and take that tenant's period mutex. It is only a share lock,
--     but it conflicts with that tenant's period close, so any member of any organization could hold
--     an unrelated tenant's accounting close open for the length of their transaction. It is also a
--     TIMING ORACLE: feed the wrapper a foreign uuid while that tenant has a close in flight and the
--     call blocks; feed it a uuid that exists nowhere and it returns at once.
--   * THE JOURNAL ROW ITSELF. An unfiltered `select * ... where id = p_entry for update` is the same
--     pair of defects one level down, and it is NOT fixed by filtering the mutex read: the caller
--     still queues on a FOREIGN tenant's journal row — contending for a row they have no relationship
--     with — and still blocks for exactly as long as that tenant's own writer holds it, before
--     receiving 42501. That wait is a cross-tenant ACTIVITY oracle: it reports not merely that a
--     foreign journal exists, but that someone is writing it right now.
--
-- The redacted P0002/42501 verdicts stop distinguishing those cases, but a WAIT does not — which is
-- why the fix is ordering, not wording. The predicate used is exactly
-- `org_id in (select public.user_org_ids())` — byte-identical to the membership check further down —
-- so a lock is taken IF AND ONLY IF that check is about to pass. A foreign or non-existent entry
-- resolves to null and is refused immediately by a NON-LOCKING existence probe (a plain MVCC read
-- never queues behind a row lock), which still raises the SAME P0002 for a missing entry and the
-- SAME 42501 for a foreign one. The `for update` that follows is scoped to `org_id = v_lock_org`, so
-- the only row this function can ever lock is the membership-approved one it just read. Nothing about
-- the verdict contract moves; only the locks do.
--
-- THE PRIVATE RECONCILIATION PATH IS UNAFFECTED, and needs no exemption. Every caller that passes
-- `p_reconciliation_context => true` (`public.fn_execute_reconciliation_batch`,
-- `public.fn_rollback_reconciliation_batch`) has ALREADY resolved its batch through
-- `org_id in (select public.user_org_ids())` and already required owner + `reconciliation.write` on
-- that org, and only ever hands this function a journal of that same org — so the filter admits it,
-- the SHARED mutex is taken exactly as before, and the org-scoped `for update` locks exactly the row
-- the unscoped one did. `user_org_ids()` is the active-org-narrowed set, which is the right set
-- precisely because the membership check below uses that same narrowed set: an entry the caller is
-- about to be refused for is an entry whose mutex — and whose ROW — the caller must not take either.
create or replace function private.fn_reverse_journal_entry_internal(
  p_entry uuid,
  p_reason text,
  p_reversal_date date default current_date,
  p_reconciliation_context boolean default false)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_original public.journal_entries%rowtype;
  v_reason text;
  v_reversal_date date;
  v_reversal uuid;
  v_source_sequence integer;
  v_lock_org uuid;
begin
  if p_entry is null then
    raise exception 'journal entry required' using errcode = '23502';
  end if;
  v_reason := nullif(trim(coalesce(p_reason, '')), '');
  if v_reason is null then
    raise exception 'reversal reason required' using errcode = '23502';
  end if;
  v_reversal_date := coalesce(p_reversal_date, current_date);

  -- ▼▼ AUTHORIZATION BEFORE ANY LOCK — mutex AND journal row alike (see §0). ▼▼
  --
  -- The membership-filtered resolving read below does double duty: it yields the org whose period
  -- mutex may be taken, and it is the authorization decision itself. Everything that follows —
  -- the mutex, the `for update`, the mutation — happens only for an entry this caller has already
  -- been admitted to.
  --
  -- The read is NON-LOCKING, so a foreign or non-existent uuid costs no lock of any kind. MVCC
  -- readers never queue behind a row lock, so this read returns at once even while another tenant
  -- holds that journal row `for update`.
  select je.org_id
    into v_lock_org
    from public.journal_entries je
   where je.id = p_entry
     and je.org_id in (select public.user_org_ids());

  if v_lock_org is null then
    -- Not admitted. The verdict is resolved WITHOUT LOCKING ANYTHING: an existence probe is a plain
    -- MVCC read, so neither branch can queue on a foreign tenant's row or mutex. The two SQLSTATEs
    -- are exactly the ones the pre-existing `for update` + `if not found` + membership ladder raised
    -- — a missing entry is still P0002, a foreign one is still 42501, with the identical messages —
    -- only now they are reached before any lock rather than after two.
    if not exists (select 1 from public.journal_entries je where je.id = p_entry) then
      raise exception 'journal entry % not found', p_entry using errcode = 'P0002';
    end if;
    raise exception 'forbidden: cross-org journal reversal' using errcode = '42501';
  end if;

  -- Admitted, so the SHARED period mutex is taken for THIS caller's own org, and taken BEFORE the
  -- row lock below so this transaction never holds a journal row while queueing for the mutex.
  perform pg_catalog.pg_advisory_xact_lock_shared(private.fn_accounting_period_mutex_key(v_lock_org));
  -- ▲▲ end period mutex ▲▲

  -- The row lock is now scoped to the membership-approved org. `org_id = v_lock_org` is what keeps a
  -- foreign row out of this `for update` entirely: without it, an authenticated caller who passed any
  -- uuid would queue on that tenant's journal row before the membership check ever ran — a foreign
  -- row-lock contention AND a cross-tenant activity timing oracle (a foreign row under a concurrent
  -- write would BLOCK; a nonexistent uuid would return at once), which is precisely what the redacted
  -- P0002/42501 pair exists to prevent. The predicate cannot narrow an authorized call: `v_lock_org`
  -- was read from this very row. The `if not found` below therefore only fires on the genuine race in
  -- which the entry is deleted between the resolving read and the lock, and it raises the same P0002.
  select *
    into v_original
    from public.journal_entries
   where id = p_entry
     and org_id = v_lock_org
   for update;
  if not found then
    raise exception 'journal entry % not found', p_entry using errcode = 'P0002';
  end if;

  -- Kept verbatim from the predecessor. It is now redundant with the filtered lock above — which is
  -- the point: the cross-org refusal survives in place, so no future edit to the locking read can
  -- silently remove the only membership check on this path.
  if v_original.org_id not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org journal reversal' using errcode = '42501';
  end if;
  if not public.authorize('budget.write', v_original.org_id) then
    raise exception 'forbidden: budget.write is required' using errcode = '42501';
  end if;

  -- a historical reconciliation journal — SALE or EXPENSE — is reversed ONLY by the reconciliation
  -- executor, which reaches this function through the private privilege boundary (20260726160000 §7,
  -- reproduced verbatim).
  if not coalesce(p_reconciliation_context, false)
     and (
       (
         v_original.source_type = 'sale'
         and exists (
           select 1
             from public.sales s
            where s.id = v_original.source_id
              and s.org_id = v_original.org_id
              and s.payment_status in ('historical_treasury', 'historical_reversed')
         )
       ) or (
         v_original.source_type = 'expense'
         and exists (
           select 1
             from public.expenses e
            where e.id = v_original.source_id
              and e.org_id = v_original.org_id
              and e.payment_status in ('historical_treasury', 'historical_reversed')
         )
       )
     ) then
    raise exception
      'forbidden: a historical reconciliation % journal is reversed only through reconciliation',
      v_original.source_type
      using errcode = '42501';
  end if;

  if v_original.reversal_of is not null then
    raise exception 'cannot reverse a reversal journal entry' using errcode = '22023';
  end if;

  if v_original.status = 'reversed' then
    select id into v_reversal
      from public.journal_entries
     where reversal_of = v_original.id
     order by created_at desc, id desc
     limit 1;
    return coalesce(v_reversal, v_original.id);
  end if;

  if public.fn_period_locked(v_original.org_id, v_original.entry_date) then
    raise exception 'cannot reverse a journal entry from a locked accounting period' using errcode = '55000';
  end if;
  if public.fn_period_locked(v_original.org_id, v_reversal_date) then
    raise exception 'cannot post a reversal into a locked accounting period' using errcode = '55000';
  end if;

  perform 1
    from public.journal_entries
   where org_id = v_original.org_id
     and source_type = v_original.source_type
     and source_id = v_original.source_id
   order by source_sequence
   for update;

  select coalesce(max(source_sequence), 0) + 1 into v_source_sequence
    from public.journal_entries
   where org_id = v_original.org_id
     and source_type = v_original.source_type
     and source_id = v_original.source_id;

  update public.journal_entries
     set status = 'reversed'
   where id = v_original.id;

  insert into public.journal_entries(
    org_id, entry_date, source_type, source_id, source_sequence, description, status, reversal_of)
  values (
    v_original.org_id,
    v_reversal_date,
    v_original.source_type,
    v_original.source_id,
    v_source_sequence,
    concat('عكس القيد: ', coalesce(v_original.description, v_original.source_type), ' — السبب: ', v_reason),
    'reversed',
    v_original.id)
  returning id into v_reversal;

  insert into public.journal_lines(
    org_id, journal_entry_id, account_id, debit, credit, description,
    custody_account_id, custody_movement_id, expense_id, payment_request_id, cost_center_id)
  select
    org_id,
    v_reversal,
    account_id,
    credit,
    debit,
    concat('عكس: ', coalesce(description, v_original.description, v_original.source_type)),
    custody_account_id,
    custody_movement_id,
    expense_id,
    payment_request_id,
    cost_center_id
  from public.journal_lines
  where journal_entry_id = v_original.id
  order by id;

  return v_reversal;
end;
$$;
revoke execute on function private.fn_reverse_journal_entry_internal(uuid, text, date, boolean)
  from public, anon, authenticated;

-- ── 0a) THE EXECUTOR IS BROUGHT INTO THE MUTEX-FIRST ORDER TOO ────────────────────────────────────
--
-- §0 states the contract as "the money writers take the mutex as EARLY as they can — before their own
-- row locks". Three of the four already did after §0's re-emits. The fourth did NOT:
-- `public.fn_execute_reconciliation_batch`, inherited unchanged from 20260726160000 §8, locks its
-- batch row, its batch rows, cash 1010, its correction-target domain rows, their journals and their
-- lines FIRST, and only reaches the mutex much later and indirectly — inside
-- `public.fn_post_two_line_journal` / `private.fn_reverse_journal_entry_internal` / the reinstatement
-- helper, once it is already deep in the ladder holding every one of those locks.
--
-- That is the rows-first-mutex-second ordering §0 itself names as the one that can close a cycle, and
-- with the executor left on it the cycle is not hypothetical. Postgres queues a SHARE request behind an
-- already-pending EXCLUSIVE one (writer anti-starvation), so three real transactions on one org suffice:
--
--   1. a ROLLBACK holds the SHARED mutex (it takes it first) and holds/needs a domain or cash row;
--   2. a PERIOD CLOSE asks for the EXCLUSIVE mutex and queues behind that share;
--   3. an EXECUTOR already holds the row the rollback needs, then asks for the SHARED mutex — and is
--      queued behind the close's pending exclusive request.
--
-- Executor waits on close, close waits on rollback, rollback waits on executor. Whether that surfaces
-- as a detected 40P01 or as a stalled queue, it is a three-party cycle that the documented lock order
-- promised was unreachable, and it is reachable ONLY because the executor took its rows first.
--
-- So the executor is re-emitted here from its CURRENT definition (20260726160000 §8) with EXACTLY ONE
-- change: a membership-filtered per-org SHARED mutex acquisition placed before its first `for update`.
-- Everything else is byte-preserved — the owner-only + org-scoped authorization and the redacted
-- membership-first resolution, the idempotent terminal-status returns, the approved/frozen
-- revalidation, the payload-hash drift detection, the single inner subtransaction with its
-- transient-SQLSTATE re-raise and its non-transient `failed` verdict, the redacted failure metadata
-- (`failure_code` + `safe_locator`), the execution ledger's cross-batch double-execution guard, the
-- expense, sale, mixed, orphan-reversal and zero-value branches, the baseline serialization, every
-- postflight aggregate/journal/snapshot/hash invariant, the exact-inverse reversal proof, the
-- `source_type`/`source_id`/`source_sequence` semantics, and the grants below.
--
-- WHY THE ACQUISITION IS NOT SIMPLY `perform ... (v_org)` AFTER THE LOCKING READ. The org is not known
-- until that read runs, and that read is the first `for update`. Resolving the org needs its own
-- non-locking read — and that read is membership-filtered with the identical
-- `org_id in (select public.user_org_ids())` predicate, so this function still takes NO lock of any
-- kind for an organization the caller is not a member of. A missing batch and another tenant's batch
-- both resolve to null, skip the acquisition, and reach the same redacted 'reconciliation batch not
-- found' P0002 — the cross-tenant existence oracle stays closed, and it stays closed against timing
-- too, because there is no foreign wait to time.
--
-- LOCK ORDER after this re-emit (deterministic, and identical for an expense-only, sale-only or mixed
-- batch — 20260726160000 §8's order with the mutex prepended, nothing else moved):
--   per-org period mutex (SHARED) -> batch -> batch rows (by evidence_item_id) -> cash 1010
--   -> revenue leaves (by id) -> correction target expenses (by id) -> their journals (by id)
--   -> their lines (by id) -> correction target sales (by id) -> their journals (by id)
--   -> their lines (by id)
-- That prefix is now byte-identical to `public.fn_rollback_reconciliation_batch`'s, which is the whole
-- point: the two functions share a mutex-first prefix and a single cash-1010 serialization point, so
-- executor/rollback/period-close have no cycle to form. `tests/202 §26` proves it on three real
-- backends rather than asserting it from this comment.
create or replace function public.fn_execute_reconciliation_batch(p_batch_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_status text;
  v_failure boolean := false;
  v_failure_code text;
  v_sqlstate text;
  v_last_safe_row_locator uuid;
  v_cash_account uuid;
  v_expenses_count integer;
  v_expenses_total numeric;
  v_sales_count integer;
  v_sales_total numeric;
  v_journal_count integer;
  v_row_hash_set jsonb;
  v_journal_hash_set jsonb;
  v_new_expense_id uuid;
  v_new_sale_id uuid;
  v_new_journal_id uuid;
  v_original_journal_id uuid;
  v_reversal_journal_id uuid;
  v_ledger_id uuid;
  v_executed_count integer := 0;
  v_skipped_count integer := 0;
  v_expected_expenses_total numeric := 0;
  v_expected_expenses_count integer := 0;
  v_expected_sales_total numeric := 0;
  v_expected_sales_count integer := 0;
  v_actual_expenses_total numeric := 0;
  v_actual_expenses_count integer := 0;
  v_actual_sales_total numeric := 0;
  v_actual_sales_count integer := 0;
  v_expected_posted_journal_delta integer := 0;
  v_dimension_id uuid;
  v_revenue_account uuid;
  v_effective_date date;
  v_matched_production_date date;
  v_result jsonb;
  v_zero_value_skip boolean;
  r record;
  v_evidence record;
  v_batch_row public.reconciliation_batch_rows%rowtype;
  v_lock_org uuid;
begin
  if p_batch_id is null then
    raise exception 'batch id required' using errcode = '23502';
  end if;

  -- Resolved THROUGH the caller's org membership, not looked up first and rejected afterwards.
  -- Reading the row unconditionally and then raising a distinct 'cross-org' 42501 made this function
  -- a CROSS-TENANT EXISTENCE ORACLE: an authenticated member of any organization could probe batch
  -- uuids and tell "exists, belongs to someone else" (42501) apart from "does not exist" (P0002),
  -- because SECURITY DEFINER bypasses the table's RLS. Both cases now fall out of the same empty
  -- result and raise the SAME message and the SAME SQLSTATE, so an outside caller learns nothing at
  -- all about another tenant's batches.
  --
  -- Membership is resolved BEFORE the owner/permission checks below for the same reason: a role
  -- verdict ('only an owner may execute') implicitly confirms the row exists, so it must be
  -- unreachable for a non-member. A non-owner MEMBER still gets the owner error, which tells them
  -- only about their own organization's batch.
  -- ▼▼ per-org period mutex, SHARE (see §0), taken BEFORE the FIRST `for update` this function
  --    reaches — and therefore before any row lock at all. This is the ONLY change to the 20260726160000
  --    §8 definition; everything else below is that definition verbatim.
  --
  --    WHY IT HAS TO BE FIRST. Postgres queues a later SHARE request behind an already-pending EXCLUSIVE
  --    request so that writers cannot be starved. If this function locked its batch, cash, domain and
  --    journal rows first and only reached the mutex later (through `fn_post_two_line_journal` /
  --    `fn_reverse_journal_entry_internal` / the reinstatement helper), it would sit in that share queue
  --    WHILE HOLDING ROW LOCKS — and a three-party cycle becomes reachable:
  --
  --      rollback  holds SHARE, wants a row this executor holds
  --      close     wants EXCLUSIVE, queued behind the rollback's SHARE
  --      executor  holds that row, wants SHARE, queued behind the close's EXCLUSIVE
  --
  --    Taking the mutex first makes that state unrepresentable: while this transaction is queued for the
  --    mutex it holds no row lock for anything to wait on, and once it holds the mutex it never asks for
  --    it again (a lock already held by this transaction is re-granted immediately), so it can never be
  --    pushed back into the queue behind a close. Rollback already took it first; now every money writer
  --    genuinely obeys the mutex-first order §0 documents.
  --
  --    THE RESOLVING READ IS MEMBERSHIP-FILTERED with exactly the predicate the locking read below uses,
  --    so a missing batch AND another tenant's batch both resolve to null and NO foreign-org lock is
  --    ever taken — an unauthenticated-for-this-org caller can neither hold another tenant's close open
  --    nor time the wait to learn that their batch uuid exists. Both cases then fall through to the
  --    unchanged locking read and raise the SAME redacted P0002. ▼▼
  select b.org_id
    into v_lock_org
    from public.reconciliation_batches b
   where b.id = p_batch_id
     and b.org_id in (select public.user_org_ids());
  if v_lock_org is not null then
    perform pg_catalog.pg_advisory_xact_lock_shared(private.fn_accounting_period_mutex_key(v_lock_org));
  end if;
  -- ▲▲ end period mutex ▲▲

  select b.org_id, b.status
    into v_org, v_status
    from public.reconciliation_batches b
   where b.id = p_batch_id
     and b.org_id in (select public.user_org_ids())
   for update;

  if v_org is null then
    raise exception 'reconciliation batch not found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1
      from public.organization_member m
     where m.org_id = v_org
       and m.user_id = v_uid
       and m.role = 'owner'
  ) or not public.authorize('reconciliation.write', v_org) then
    raise exception 'forbidden: only an owner may execute reconciliation' using errcode = '42501';
  end if;

  if v_status in ('executed', 'failed', 'rolled_back') then
    return jsonb_build_object(
      'batch_id', p_batch_id,
      'status', v_status,
      'idempotent', true
    );
  end if;
  if v_status <> 'approved' then
    raise exception 'only an approved reconciliation batch may execute' using errcode = '22023';
  end if;

  update public.reconciliation_batches
     set status = 'executing',
         result_summary = null
   where id = p_batch_id;

  begin
    if exists (
      select 1
        from public.reconciliation_batch_rows br
       where br.batch_id = p_batch_id
         and br.disposition = 'include'
         and (
           br.review_state <> 'frozen'
           or br.frozen is distinct from true
           or br.payload_hash is null
         )
    ) then
      raise exception 'included rows must be frozen' using errcode = '22023';
    end if;

    -- Expense-only, sale-only, and MIXED approved batches all execute inside this one
    -- subtransaction. Any other target domain still fails closed.
    if exists (
      select 1
        from public.reconciliation_batch_rows br
       where br.batch_id = p_batch_id
         and br.disposition = 'include'
         and (
           br.target_table is null
           or br.target_table not in ('expenses', 'sales')
         )
    ) then
      raise exception 'reconciliation execution supports only expense and sale rows'
        using errcode = '22023';
    end if;

    for v_batch_row in
      select br.*
        from public.reconciliation_batch_rows br
       where br.batch_id = p_batch_id
         and br.disposition = 'include'
       order by br.evidence_item_id
       for update
    loop
      if private.fn_reconciliation_execution_payload_hash(v_batch_row)
           is distinct from v_batch_row.payload_hash then
        v_last_safe_row_locator := v_batch_row.id;
        raise exception 'frozen payload drift' using errcode = '23514';
      end if;
    end loop;

    select a.id
      into v_cash_account
      from public.accounts a
     where a.org_id = v_org
       and a.code = '1010'
       and a.active
     for update;
    if v_cash_account is null then
      raise exception 'cash posting account is unavailable' using errcode = '23514';
    end if;

    -- Take the typed revenue leaves in id order, and ONLY when the batch actually contains a sales
    -- row. Taking them unconditionally would widen an expense-only batch's lock footprint for no
    -- expense-side benefit, and every extra account row held for a whole transaction is another edge
    -- against any path that locks accounts in a different order (e.g. fn_merge_accounts, which locks
    -- source-then-target by ARGUMENT order, not id order). Determinism is preserved: two concurrent
    -- SALE batches still take the same set in the same id order, and cash 1010 above is still taken
    -- first by every batch of every shape, so it remains the single serialization point.
    if exists (
      select 1
        from public.reconciliation_batch_rows br
       where br.batch_id = p_batch_id
         and br.disposition = 'include'
         and br.target_table = 'sales'
    ) then
      perform 1
        from public.accounts a
       where a.org_id = v_org
         and a.account_type = 'revenue'
         and a.code = any (private.fn_reconciliation_historical_revenue_codes())
       order by a.id
       for update;
    end if;

    perform 1
      from public.reconciliation_batch_rows br
      join public.expenses e
        on e.id = br.corrects_expense_id
       and e.org_id = br.org_id
     where br.batch_id = p_batch_id
       and br.disposition = 'include'
       and br.corrects_expense_id is not null
     order by e.id
     for update of e;

    perform 1
      from public.reconciliation_batch_rows br
      join public.journal_entries je
        on je.org_id = br.org_id
       and je.source_type = 'expense'
       and je.source_id = br.corrects_expense_id
       and je.status = 'posted'
     where br.batch_id = p_batch_id
       and br.disposition = 'include'
       and br.corrects_expense_id is not null
     order by je.id
     for update of je;

    perform 1
      from public.reconciliation_batch_rows br
      join public.journal_entries je
        on je.org_id = br.org_id
       and je.source_type = 'expense'
       and je.source_id = br.corrects_expense_id
       and je.status = 'posted'
      join public.journal_lines jl on jl.journal_entry_id = je.id
     where br.batch_id = p_batch_id
       and br.disposition = 'include'
       and br.corrects_expense_id is not null
     order by jl.id
     for update of jl;

    perform 1
      from public.reconciliation_batch_rows br
      join public.sales s
        on s.id = br.corrects_sale_id
       and s.org_id = br.org_id
     where br.batch_id = p_batch_id
       and br.disposition = 'include'
       and br.corrects_sale_id is not null
     order by s.id
     for update of s;

    perform 1
      from public.reconciliation_batch_rows br
      join public.journal_entries je
        on je.org_id = br.org_id
       and je.source_type = 'sale'
       and je.source_id = br.corrects_sale_id
       and je.status = 'posted'
     where br.batch_id = p_batch_id
       and br.disposition = 'include'
       and br.corrects_sale_id is not null
     order by je.id
     for update of je;

    perform 1
      from public.reconciliation_batch_rows br
      join public.journal_entries je
        on je.org_id = br.org_id
       and je.source_type = 'sale'
       and je.source_id = br.corrects_sale_id
       and je.status = 'posted'
      join public.journal_lines jl on jl.journal_entry_id = je.id
     where br.batch_id = p_batch_id
       and br.disposition = 'include'
       and br.corrects_sale_id is not null
     order by jl.id
     for update of jl;

    select count(*)::integer, coalesce(sum(e.total), 0)
      into v_expenses_count, v_expenses_total
      from public.expenses e
     where e.org_id = v_org;

    select count(*)::integer, coalesce(sum(coalesce(s.total, 0)), 0)
      into v_sales_count, v_sales_total
      from public.sales s
     where s.org_id = v_org;

    select count(*)::integer
      into v_journal_count
      from public.journal_entries je
     where je.org_id = v_org
       and je.status = 'posted';

    -- Every baseline row carries its own `target_table` tag, so the sales and expenses halves of the
    -- postflight drift check can never be compared against the wrong domain.
    select coalesce(jsonb_agg(entry order by (entry->>'id')::uuid), '[]'::jsonb)
      into v_row_hash_set
      from (
        select jsonb_build_object(
          'id', e.id,
          'target_table', 'expenses',
          'original_payment_status', e.payment_status,
          'hash', encode(sha256(convert_to(jsonb_build_object(
            'id', e.id,
            'org_id', e.org_id,
            'date', e.date,
            'farm_id', e.farm_id,
            'sector_id', e.sector_id,
            'hawsha_id', e.hawsha_id,
            'event_id', e.event_id,
            'plan_id', e.plan_id,
            'category', e.category,
            'description', e.description,
            'supplier_id', e.supplier_id,
            'qty', e.qty,
            'unit', e.unit,
            'unit_price', e.unit_price,
            'total', e.total,
            'payment_method', e.payment_method,
            'recorded_by', e.recorded_by,
            'approved_by', e.approved_by,
            'status', e.status,
            'payment_status', 'historical_reversed',
            'paid_by', e.paid_by,
            'kind', e.kind,
            'account_id', e.account_id,
            'cost_center_id', e.cost_center_id,
            'corrects_expense_id', e.corrects_expense_id,
            'reversed_by_rollback_at', e.reversed_by_rollback_at
          )::text, 'UTF8')), 'hex')
        ) as entry
          from public.reconciliation_batch_rows br
          join public.expenses e
            on e.id = br.corrects_expense_id
           and e.org_id = br.org_id
         where br.batch_id = p_batch_id
           and br.disposition = 'include'
           and br.corrects_expense_id is not null
        union all
        select jsonb_build_object(
          'id', s.id,
          'target_table', 'sales',
          'original_payment_status', s.payment_status,
          -- Hashed over the WHOLE row with only `payment_status` overridden to its expected
          -- post-execution value, rather than a hand-listed column subset: a subset silently stops
          -- covering any column added to public.sales later, and this hash IS the tamper detector.
          -- jsonb key order is canonical, so the digest is stable.
          'hash', encode(sha256(convert_to((
            to_jsonb(s) || jsonb_build_object('payment_status', 'historical_reversed')
          )::text, 'UTF8')), 'hex')
        ) as entry
          from public.reconciliation_batch_rows br
          join public.sales s
            on s.id = br.corrects_sale_id
           and s.org_id = br.org_id
         where br.batch_id = p_batch_id
           and br.disposition = 'include'
           and br.corrects_sale_id is not null
      ) baseline_rows;

    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', je.id,
        'hash', encode(sha256(convert_to(jsonb_build_object(
          'id', je.id,
          'entry_date', je.entry_date,
          'source_type', je.source_type,
          'source_id', je.source_id,
          'source_sequence', je.source_sequence,
          'status', je.status,
          'lines', (
            select coalesce(jsonb_agg(jsonb_build_object(
              'id', line.id,
              'line_ordinal', line.line_ordinal,
              'account_id', line.account_id,
              'debit', line.debit,
              'credit', line.credit,
              'cost_center_id', line.cost_center_id,
              'expense_id', line.expense_id
            ) order by line.line_ordinal), '[]'::jsonb)
              from (
                select jl.*, row_number() over (order by jl.id)::integer as line_ordinal
                  from public.journal_lines jl
                 where jl.journal_entry_id = je.id
              ) line
          )
        )::text, 'UTF8')), 'hex')
      ) order by je.id
    ), '[]'::jsonb)
      into v_journal_hash_set
      from public.journal_entries je
     where je.org_id = v_org
       and je.status = 'posted'
       and (
         (
           je.source_type = 'expense'
           and exists (
             select 1 from public.reconciliation_batch_rows br
              where br.batch_id = p_batch_id
                and br.disposition = 'include'
                and br.corrects_expense_id = je.source_id
           )
         )
         or (
           je.source_type = 'sale'
           and exists (
             select 1 from public.reconciliation_batch_rows br
              where br.batch_id = p_batch_id
                and br.disposition = 'include'
                and br.corrects_sale_id = je.source_id
           )
         )
       );

    insert into public.reconciliation_baselines(
      org_id, batch_id, expenses_count, expenses_total, sales_count, sales_total,
      journal_entries_count, row_hash_set, journal_hash_set
    )
    values (
      v_org, p_batch_id, v_expenses_count, v_expenses_total, v_sales_count, v_sales_total,
      v_journal_count, v_row_hash_set, v_journal_hash_set
    );

    for r in
      select je.*
        from public.journal_entries je
       where je.org_id = v_org
         and je.status = 'posted'
         and (
           (
             je.source_type = 'expense'
             and exists (
               select 1 from public.reconciliation_batch_rows br
                where br.batch_id = p_batch_id
                  and br.disposition = 'include'
                  and br.corrects_expense_id = je.source_id
             )
           )
           or (
             je.source_type = 'sale'
             and exists (
               select 1 from public.reconciliation_batch_rows br
                where br.batch_id = p_batch_id
                  and br.disposition = 'include'
                  and br.corrects_sale_id = je.source_id
             )
           )
         )
       order by je.id
       for update of je
    loop
      insert into public.reconciliation_baseline_journal_headers(
        org_id, batch_id, original_journal_entry_id, entry_date, source_type,
        source_id, source_sequence, description, status, posted_at, posted_by,
        reversal_of, canonical_hash
      )
      values (
        r.org_id, p_batch_id, r.id, r.entry_date, r.source_type,
        r.source_id, r.source_sequence, r.description, r.status, r.posted_at,
        r.posted_by, r.reversal_of,
        encode(sha256(convert_to(jsonb_build_object(
          'original_journal_entry_id', r.id,
          'entry_date', r.entry_date,
          'source_type', r.source_type,
          'source_id', r.source_id,
          'source_sequence', r.source_sequence,
          'description', r.description,
          'status', r.status,
          'posted_at', r.posted_at,
          'posted_by', r.posted_by,
          'reversal_of', r.reversal_of
        )::text, 'UTF8')), 'hex')
      )
      returning id into v_ledger_id;

      insert into public.reconciliation_baseline_journal_lines(
        org_id, baseline_journal_header_id, original_journal_line_id,
        line_ordinal, account_id, debit, credit, description, cost_center_id,
        custody_account_id, custody_movement_id, expense_id,
        payment_request_id, canonical_hash
      )
      select
        line.org_id, v_ledger_id, line.id, line.line_ordinal, line.account_id,
        line.debit, line.credit, line.description, line.cost_center_id,
        line.custody_account_id, line.custody_movement_id, line.expense_id,
        line.payment_request_id,
        encode(sha256(convert_to(jsonb_build_object(
          'original_journal_line_id', line.id,
          'line_ordinal', line.line_ordinal,
          'account_id', line.account_id,
          'debit', line.debit,
          'credit', line.credit,
          'description', line.description,
          'cost_center_id', line.cost_center_id,
          'custody_account_id', line.custody_account_id,
          'custody_movement_id', line.custody_movement_id,
          'expense_id', line.expense_id,
          'payment_request_id', line.payment_request_id
        )::text, 'UTF8')), 'hex')
        from (
          select jl.*, row_number() over (order by jl.id)::integer as line_ordinal
            from public.journal_lines jl
           where jl.journal_entry_id = r.id
        ) line
       order by line.line_ordinal;
    end loop;

    for v_batch_row in
      select br.*
        from public.reconciliation_batch_rows br
       where br.batch_id = p_batch_id
         and br.disposition = 'include'
       order by br.evidence_item_id
       for update
    loop
      v_last_safe_row_locator := v_batch_row.id;
      v_zero_value_skip := false;

      select l.id
        into v_ledger_id
        from public.reconciliation_execution_ledger l
       where l.evidence_item_id = v_batch_row.evidence_item_id
         and l.status = 'executed'
       for update;

      if v_ledger_id is not null then
        update public.reconciliation_batch_rows
           set execution_result = 'skipped',
               execution_error = null
         where id = v_batch_row.id;
        v_skipped_count := v_skipped_count + 1;
        continue;
      end if;

      select ei.source_amount, ei.source_date_parsed, ei.classification,
             ei.invalid_calendar_quality_flag
        into v_evidence
        from public.reconciliation_evidence_items ei
       where ei.id = v_batch_row.evidence_item_id
         and ei.org_id = v_org;

      -- Amount is validated identically for both domains: present, non-negative, exact to 2 dp.
      if v_evidence.source_amount is null
        or v_evidence.source_amount < 0
        or round(v_evidence.source_amount, 2)
             is distinct from v_evidence.source_amount
      then
        raise exception 'source amount or date is not executable' using errcode = '23514';
      end if;

      if v_batch_row.target_table = 'expenses' then
        -- ── expense domain (20260726150000 semantics, unchanged) ────────────────────────────────
        if v_evidence.source_date_parsed is null
          or coalesce(v_evidence.invalid_calendar_quality_flag, false)
        then
          raise exception 'source amount or date is not executable' using errcode = '23514';
        end if;
        v_effective_date := v_evidence.source_date_parsed;

        select a.id
          into v_dimension_id
          from public.accounts a
         where a.id = v_batch_row.expense_account_id
           and a.org_id = v_org
           and a.active
           and a.kind = v_batch_row.expense_kind
           and not exists (
             select 1
               from public.accounts child
              where child.parent_id = a.id
                and child.org_id = v_org
                and child.active
           )
         for update;
        if v_dimension_id is null then
          raise exception 'reviewed expense account is not executable' using errcode = '23514';
        end if;
        if v_batch_row.expense_cost_center_id is not null and not exists (
          select 1 from public.cost_centers c
           where c.id = v_batch_row.expense_cost_center_id and c.org_id = v_org
        ) then
          raise exception 'reviewed cost center is not executable' using errcode = '23514';
        end if;
        if v_batch_row.expense_supplier_id is not null and not exists (
          select 1 from public.suppliers s
           where s.id = v_batch_row.expense_supplier_id and s.org_id = v_org
        ) then
          raise exception 'reviewed supplier is not executable' using errcode = '23514';
        end if;
      else
        -- ── sale domain ─────────────────────────────────────────────────────────────────────────
        -- The reviewed effective date governs (that is precisely why sale_effective_date and
        -- sale_historical_date_decision exist on the batch row), so — unlike the expense path — an
        -- unparseable source date is not automatically fatal: it is fatal unless the reviewer
        -- explicitly took the manual-override decision.
        if v_batch_row.sale_historical_date_decision is null
          or v_batch_row.sale_effective_date is null
        then
          raise exception 'reviewed sale effective date decision is required' using errcode = '23514';
        end if;
        if (
          v_evidence.source_date_parsed is null
          or coalesce(v_evidence.invalid_calendar_quality_flag, false)
        ) and v_batch_row.sale_historical_date_decision is distinct from 'manual_override' then
          raise exception 'source amount or date is not executable' using errcode = '23514';
        end if;
        if v_batch_row.sale_historical_date_decision = 'use_source_text_date'
          and v_batch_row.sale_effective_date is distinct from v_evidence.source_date_parsed
        then
          raise exception 'reviewed sale effective date does not match the source date'
            using errcode = '23514';
        end if;
        if v_batch_row.sale_historical_date_decision = 'use_matched_production_date' then
          if v_batch_row.corrects_sale_id is null then
            raise exception 'a matched production date requires a correction target'
              using errcode = '23514';
          end if;
          -- The SAME pinned-UTC economic-date expression the proof helper uses. A bare
          -- `created_at::date` here would make the accepted effective date depend on the executing
          -- session's timezone, so the same reviewed row could pass for one owner and fail for
          -- another — and could post a replacement into a different period than the reversal.
          select coalesce(t.sale_date, (t.created_at at time zone 'UTC')::date)
            into v_matched_production_date
            from public.sales t
           where t.id = v_batch_row.corrects_sale_id
             and t.org_id = v_org;
          if v_matched_production_date is null
            or v_batch_row.sale_effective_date is distinct from v_matched_production_date
          then
            raise exception 'reviewed sale effective date does not match the matched production date'
              using errcode = '23514';
          end if;
        end if;
        if v_batch_row.sale_historical_date_decision = 'manual_override'
          and nullif(trim(coalesce(v_batch_row.review_reason, '')), '') is null
        then
          raise exception 'a manual sale date override requires a review reason'
            using errcode = '23514';
        end if;
        v_effective_date := v_batch_row.sale_effective_date;

        -- The reviewed money must reconcile to the evidence exactly — the reviewed total IS the
        -- source amount, and quantity x unit price must reproduce it to the cent.
        if v_batch_row.sale_recorded_total is distinct from v_evidence.source_amount then
          raise exception 'reviewed sale total does not match the source amount'
            using errcode = '23514';
        end if;
        -- Both figures must be PRESENT, not merely non-negative. reconciliation_batch_rows'
        -- `target_required` CHECK already demands this for an included sales row, but the executor
        -- must not silently depend on a table constraint it does not own: coalescing a NULL to zero
        -- would let a null/null row satisfy the cross-check below for a zero-amount source and post
        -- a priced sale with no reviewed price at all.
        if v_batch_row.sale_quantity is null or v_batch_row.sale_unit_price is null then
          raise exception 'reviewed sale quantity and unit price are required'
            using errcode = '23514';
        end if;
        -- Quantity x unit price must reproduce the amount, but only to within one cent: a legitimate
        -- 2-dp sheet row can be a cent off its own product (7.5 x 1333.33 = 9,999.98 against a
        -- recorded 10,000.00). The authoritative posted figure is always `source_amount`; this is a
        -- sanity cross-check on the reviewed decomposition, not a second source of truth.
        if abs(
             round(v_batch_row.sale_quantity * v_batch_row.sale_unit_price, 2)
             - v_evidence.source_amount
           ) > 0.01 then
          raise exception 'reviewed sale quantity and unit price do not reconcile to the source amount'
            using errcode = '23514';
        end if;
        if nullif(trim(coalesce(v_batch_row.sale_crop, '')), '') is null then
          raise exception 'reviewed sale crop is required' using errcode = '23514';
        end if;

        -- Revenue leaf resolution differs by intent, and the difference is load-bearing.
        --
        -- A CORRECTION restates the AMOUNT of an existing sale; it is not a reclassification. So it
        -- INHERITS the typed revenue leaf the original was actually posted to, read from that
        -- original's own posted credit line. Re-deriving the leaf from the crop here would silently
        -- undo an accountant's manual reclassification: 20260708090000 moved three palm-TREE
        -- disposals from 4010 to 4090 by pinned sale_id, and their crop text still matches the 4010
        -- keywords. Re-deriving would reverse 4090 and replace into 4010 — quietly reversing a
        -- decision this slice's own header promises not to touch. The reviewed crop is therefore
        -- also required to still equal the target's crop: changing it is a reclassification, which
        -- is a separate, explicit, future action, not a side effect of an amount correction.
        --
        -- An ADDITION has no original to inherit from, so it uses the established crop mapping.
        if v_batch_row.corrects_sale_id is not null then
          if nullif(trim(v_batch_row.sale_crop), '') is distinct from (
               select nullif(trim(t.crop), '') from public.sales t
                where t.id = v_batch_row.corrects_sale_id and t.org_id = v_org
             ) then
            raise exception 'a sale correction cannot change the crop; reclassification is a separate action'
              using errcode = '23514';
          end if;

          select revenue_account.id
            into v_revenue_account
            from public.journal_entries original_entry
            join public.journal_lines revenue_line
              on revenue_line.journal_entry_id = original_entry.id
             and revenue_line.credit > 0
            join public.accounts revenue_account
              on revenue_account.id = revenue_line.account_id
             and revenue_account.org_id = v_org
           where original_entry.org_id = v_org
             and original_entry.source_type = 'sale'
             and original_entry.source_id = v_batch_row.corrects_sale_id
             and original_entry.status = 'posted'
             and revenue_account.account_type = 'revenue'
             and revenue_account.code = any (
               private.fn_reconciliation_historical_revenue_codes()
             )
             and revenue_account.active
             -- THE INHERITED LEAF MUST STILL BE AN EXECUTABLE LEAF. Inheriting the original's account
             -- answers "which revenue line does this money belong to"; it does not answer "may I post
             -- there NOW". The replacement is a brand-new posting, so it faces the same standard the
             -- ADDITION path applies: active AND childless. Without this, an account that was a leaf
             -- when the original posted but has since been given active children would take a fresh
             -- posting onto a parent — double-counting it against its own children in every rollup,
             -- and doing so silently, on the one path that skips the crop mapping's leaf check. If the
             -- account has since gained a child, `v_revenue_account` comes back null and the whole
             -- batch fails atomically below rather than posting to a parent.
             and not exists (
               select 1
                 from public.accounts child
                where child.parent_id = revenue_account.id
                  and child.org_id = v_org
                  and child.active
             )
           for update of revenue_account;
          if v_revenue_account is null then
            raise exception 'correction target revenue account is not executable' using errcode = '23514';
          end if;
        else
          -- Deterministic crop -> typed revenue leaf, re-resolved and re-validated at EXECUTION time
          -- so a leaf archived after review fails the batch instead of silently posting.
          select a.id
            into v_revenue_account
            from public.accounts a
           where a.org_id = v_org
             and a.code = private.fn_reconciliation_historical_sale_revenue_code(v_batch_row.sale_crop)
             and a.account_type = 'revenue'
             and a.active
             and not exists (
               select 1
                 from public.accounts child
                where child.parent_id = a.id
                  and child.org_id = v_org
                  and child.active
             )
           for update;
          if v_revenue_account is null then
            raise exception 'reviewed sale revenue account is not executable' using errcode = '23514';
          end if;
        end if;

        if v_batch_row.sale_buyer_id is not null and not exists (
          select 1 from public.buyers b
           where b.id = v_batch_row.sale_buyer_id and b.org_id = v_org and b.active
        ) then
          raise exception 'reviewed buyer is not executable' using errcode = '23514';
        end if;
        if v_batch_row.sale_cost_center_id is not null and not exists (
          select 1 from public.cost_centers c
           where c.id = v_batch_row.sale_cost_center_id
             and c.org_id = v_org
             and c.active
             and not exists (
               select 1 from public.cost_centers child
                where child.parent_id = c.id and child.active
             )
        ) then
          raise exception 'reviewed sale cost center is not executable' using errcode = '23514';
        end if;
        if v_batch_row.sale_farm_id is not null and not exists (
          select 1 from public.farms f
           where f.id = v_batch_row.sale_farm_id and f.org_id = v_org
        ) then
          raise exception 'reviewed sale farm is not executable' using errcode = '23514';
        end if;
        if v_batch_row.sale_sector_id is not null and not exists (
          select 1 from public.sectors sec
           where sec.id = v_batch_row.sale_sector_id
             and sec.org_id = v_org
             and sec.farm_id = v_batch_row.sale_farm_id
        ) then
          raise exception 'reviewed sale sector is not executable' using errcode = '23514';
        end if;
        if v_batch_row.sale_hawsha_id is not null and not exists (
          select 1 from public.hawshat h
           where h.id = v_batch_row.sale_hawsha_id
             and h.org_id = v_org
             and h.sector_id = v_batch_row.sale_sector_id
        ) then
          raise exception 'reviewed sale hawsha is not executable' using errcode = '23514';
        end if;
      end if;

      if v_batch_row.corrects_expense_id is not null then
        if exists (
          select 1
            from public.expenses target
           where target.id = v_batch_row.corrects_expense_id
             and (
               target.payment_status is not null
               and target.payment_status <> 'historical_treasury'
             )
        ) or exists (
          select 1
            from public.custody_movements movement
           where movement.expense_id = v_batch_row.corrects_expense_id
        ) or exists (
          select 1
            from public.payment_request_lines request_line
           where request_line.expense_id = v_batch_row.corrects_expense_id
        ) or exists (
          select 1
            from public.journal_entries payment_journal
           where payment_journal.org_id = v_org
             and payment_journal.source_type = 'expense_payment'
             and payment_journal.source_id = v_batch_row.corrects_expense_id
        ) then
          raise exception 'correction target has another payment path'
            using errcode = '23514';
        end if;

        select je.id
          into v_original_journal_id
          from public.journal_entries je
         where je.org_id = v_org
           and je.source_type = 'expense'
           and je.source_id = v_batch_row.corrects_expense_id
           and je.status = 'posted'
         order by je.source_sequence desc
         limit 1
         for update;
        if v_original_journal_id is null then
          raise exception 'correction target has no posted journal' using errcode = '23514';
        end if;
        if not exists (
          select 1
            from public.expenses target
           where target.id = v_batch_row.corrects_expense_id
             and target.org_id = v_org
             and target.total > 0
             and target.account_id is not null
             and (
               select count(*)
                 from public.journal_lines line
                where line.journal_entry_id = v_original_journal_id
             ) = 2
             and exists (
               select 1
                 from public.journal_lines debit_line
                where debit_line.journal_entry_id = v_original_journal_id
                  and debit_line.account_id = target.account_id
                  and debit_line.expense_id = target.id
                  and debit_line.debit = target.total
                  and debit_line.credit = 0
             )
             and exists (
               select 1
                 from public.journal_lines cash_line
                 join public.accounts cash_account
                   on cash_account.id = cash_line.account_id
                  and cash_account.org_id = target.org_id
                  and cash_account.code = '1010'
                where cash_line.journal_entry_id = v_original_journal_id
                  and cash_line.expense_id = target.id
                  and cash_line.debit = 0
                  and cash_line.credit = target.total
             )
        ) then
          raise exception 'correction target expense and journal do not match'
            using errcode = '23514';
        end if;

        -- The PRIVATE helper, not public.fn_reverse_journal_entry — the same route the sale branch
        -- below takes, and for the same reason. §7 now makes the public path fail closed on exactly
        -- this journal (its expense is `historical_treasury` right now, enforced by the eligibility
        -- check above), so the expense slice's original `public.fn_reverse_journal_entry(...)` call
        -- would deny the executor its own correction. The reversal produced is byte-identical — same
        -- function body, same swapped-line inverse — and the postflight exact-inverse proof below
        -- still verifies it against the snapshot.
        v_reversal_journal_id := private.fn_reverse_journal_entry_internal(
          p_entry => v_original_journal_id,
          p_reason => coalesce(
            nullif(v_batch_row.review_reason, ''),
            'approved reconciliation correction'
          ),
          p_reversal_date => v_effective_date,
          p_reconciliation_context => true
        );
        insert into public.reconciliation_action_links(
          org_id, batch_id, batch_row_id, action_kind, target_table,
          target_id, journal_entry_id
        )
        values (
          v_org, p_batch_id, v_batch_row.id, 'correction_reversal',
          'expenses', v_batch_row.corrects_expense_id, v_reversal_journal_id
        );
        update public.expenses
           set payment_status = 'historical_reversed'
         where id = v_batch_row.corrects_expense_id
           and org_id = v_org;
        v_expected_posted_journal_delta :=
          v_expected_posted_journal_delta - 1;
      end if;

      if v_batch_row.corrects_sale_id is not null then
        -- Eligibility is the PROVEN historical shape and nothing else. Requiring
        -- payment_status = 'historical_treasury' rejects an operational A/R sale, a
        -- collected/partially-collected sale, and an already-reversed target in one clause; the
        -- helper independently re-proves the Dr 1010 / Cr typed-revenue-leaf journal, the exact
        -- total and economic date, the single-journal/two-line shape, and the absence of any
        -- collection row. Nothing here is heuristic.
        if not exists (
          select 1
            from public.sales target
           where target.id = v_batch_row.corrects_sale_id
             and target.org_id = v_org
             and target.payment_status = 'historical_treasury'
        ) then
          raise exception 'correction target sale is not an eligible historical treasury sale'
            using errcode = '23514';
        end if;
        -- Matched on `sale_id` alone, for the same reason the proof helper is (§3): an org_id filter
        -- here would hide a collection row that claims a different tenant, and this check exists
        -- precisely to prove no second money path touches the target.
        if exists (
          select 1
            from public.sale_collections collection
           where collection.sale_id = v_batch_row.corrects_sale_id
        ) then
          raise exception 'correction target has another collection path'
            using errcode = '23514';
        end if;

        select je.id
          into v_original_journal_id
          from public.journal_entries je
         where je.org_id = v_org
           and je.source_type = 'sale'
           and je.source_id = v_batch_row.corrects_sale_id
           and je.status = 'posted'
         order by je.source_sequence desc
         limit 1
         for update;
        if v_original_journal_id is null then
          raise exception 'correction target has no posted journal' using errcode = '23514';
        end if;
        if not private.fn_reconciliation_sale_has_exact_historical_journal(
             v_batch_row.corrects_sale_id
           ) then
          raise exception 'correction target sale and journal do not match'
            using errcode = '23514';
        end if;

        -- The PRIVATE helper, not public.fn_reverse_journal_entry: §7 makes the public path fail
        -- closed on exactly this journal (its sale is `historical_treasury` right now), and this is
        -- the single authorised route past that. The reversal produced is byte-identical — same
        -- function body, same swapped-line inverse — and the postflight exact-inverse proof below
        -- still verifies it against the snapshot, so the boundary adds a privilege check without
        -- changing one column of the entry it writes.
        v_reversal_journal_id := private.fn_reverse_journal_entry_internal(
          p_entry => v_original_journal_id,
          p_reason => coalesce(
            nullif(v_batch_row.review_reason, ''),
            'approved reconciliation correction'
          ),
          p_reversal_date => v_effective_date,
          p_reconciliation_context => true
        );
        insert into public.reconciliation_action_links(
          org_id, batch_id, batch_row_id, action_kind, target_table,
          target_id, journal_entry_id
        )
        values (
          v_org, p_batch_id, v_batch_row.id, 'correction_reversal',
          'sales', v_batch_row.corrects_sale_id, v_reversal_journal_id
        );
        update public.sales
           set payment_status = 'historical_reversed'
         where id = v_batch_row.corrects_sale_id
           and org_id = v_org;
        v_expected_posted_journal_delta :=
          v_expected_posted_journal_delta - 1;
      end if;

      if v_evidence.source_amount = 0 then
        -- A zero-value addition posts nothing: it is an acknowledged no-op, so it is
        -- reported as skipped (and claimed in the ledger so it cannot be replayed).
        -- A zero-value correction still reverses a real journal, so it stays executed.
        v_zero_value_skip := v_batch_row.corrects_expense_id is null
                         and v_batch_row.corrects_sale_id is null;
        if v_zero_value_skip then
          insert into public.reconciliation_action_links(
            org_id, batch_id, batch_row_id, action_kind
          )
          values (v_org, p_batch_id, v_batch_row.id, 'zero_value_noop');
        end if;
        update public.reconciliation_batch_rows
           set execution_result = case
                 when v_zero_value_skip then 'skipped' else 'reversed'
               end,
               execution_error = null
         where id = v_batch_row.id;
      elsif v_batch_row.target_table = 'expenses' then
        if v_batch_row.expense_payment_decision is distinct from 'routed_now' then
          raise exception 'positive historical expense must be routed to treasury'
            using errcode = '23514';
        end if;

        v_result := public.fn_save_expense(
          p_id => null,
          p_org => v_org,
          p_date => v_effective_date,
          p_category => v_batch_row.expense_category,
          p_total => v_evidence.source_amount,
          p_description => v_batch_row.expense_description,
          p_supplier_id => v_batch_row.expense_supplier_id,
          p_kind => v_batch_row.expense_kind,
          p_account_id => v_batch_row.expense_account_id,
          p_cost_center_id => v_batch_row.expense_cost_center_id
        );
        v_new_expense_id := (v_result->>'id')::uuid;
        if v_new_expense_id is null then
          raise exception 'expense save returned no id' using errcode = '23514';
        end if;

        if v_batch_row.corrects_expense_id is not null then
          update public.expenses
             set corrects_expense_id = v_batch_row.corrects_expense_id
           where id = v_new_expense_id
             and org_id = v_org;
        end if;

        v_new_journal_id := public.fn_post_two_line_journal(
          p_org => v_org,
          p_entry_date => v_effective_date,
          p_source_type => 'expense',
          p_source_id => v_new_expense_id,
          p_description => left(coalesce(v_batch_row.expense_description, ''), 500),
          p_debit_account => v_batch_row.expense_account_id,
          p_credit_account => v_cash_account,
          p_amount => v_evidence.source_amount,
          p_expense => v_new_expense_id
        );

        update public.expenses
           set payment_status = 'historical_treasury'
         where id = v_new_expense_id
           and org_id = v_org;

        insert into public.reconciliation_action_links(
          org_id, batch_id, batch_row_id, action_kind, target_table,
          target_id, journal_entry_id
        )
        values (
          v_org, p_batch_id, v_batch_row.id,
          case when v_batch_row.corrects_expense_id is null
            then 'addition' else 'correction_replacement' end,
          'expenses', v_new_expense_id, v_new_journal_id
        );

        update public.reconciliation_batch_rows
           set execution_result = case
                 when v_batch_row.corrects_expense_id is null then 'posted'
                 else 'reversed'
               end,
               execution_error = null
         where id = v_batch_row.id;

        v_expected_expenses_total :=
          v_expected_expenses_total + v_evidence.source_amount;
        v_expected_expenses_count := v_expected_expenses_count + 1;
        v_expected_posted_journal_delta :=
          v_expected_posted_journal_delta + 1;
      else
        -- Positive historical SALE addition/replacement. The economic row is created through the
        -- existing fn_save_sale contract (so every crop/dimension rule it owns still applies), then
        -- priced and posted as the PROVEN historical cash-in entry. fn_finalize_sale_price is
        -- deliberately NOT used: it posts the OPERATIONAL Dr 1200 / Cr 4000 receivable entry, which
        -- would fabricate a receivable that this evidence proves was never opened.
        v_result := public.fn_save_sale(
          p_id => null,
          p_org => v_org,
          p_sale_date => v_effective_date,
          p_crop => v_batch_row.sale_crop,
          p_buyer_id => v_batch_row.sale_buyer_id,
          p_cost_center_id => v_batch_row.sale_cost_center_id,
          p_farm_id => v_batch_row.sale_farm_id,
          p_sector_id => v_batch_row.sale_sector_id,
          p_hawsha_id => v_batch_row.sale_hawsha_id,
          p_season => v_batch_row.sale_season,
          p_qty => v_batch_row.sale_quantity,
          p_unit => v_batch_row.sale_unit,
          p_delivery_date => v_batch_row.sale_delivery_date,
          p_notes => v_batch_row.sale_notes
        );
        v_new_sale_id := (v_result->>'id')::uuid;
        if v_new_sale_id is null then
          raise exception 'sale save returned no id' using errcode = '23514';
        end if;

        update public.sales
           set unit_price = v_batch_row.sale_unit_price,
               total = v_evidence.source_amount,
               price_status = 'finalized',
               price_finalized_at = now(),
               corrects_sale_id = v_batch_row.corrects_sale_id
         where id = v_new_sale_id
           and org_id = v_org;

        v_new_journal_id := public.fn_post_two_line_journal(
          p_org => v_org,
          p_entry_date => v_effective_date,
          p_source_type => 'sale',
          p_source_id => v_new_sale_id,
          p_description => left(coalesce(v_batch_row.sale_crop, ''), 500),
          p_debit_account => v_cash_account,
          p_credit_account => v_revenue_account,
          p_amount => v_evidence.source_amount
        );

        update public.sales
           set payment_status = 'historical_treasury'
         where id = v_new_sale_id
           and org_id = v_org;

        insert into public.reconciliation_action_links(
          org_id, batch_id, batch_row_id, action_kind, target_table,
          target_id, journal_entry_id
        )
        values (
          v_org, p_batch_id, v_batch_row.id,
          case when v_batch_row.corrects_sale_id is null
            then 'addition' else 'correction_replacement' end,
          'sales', v_new_sale_id, v_new_journal_id
        );

        update public.reconciliation_batch_rows
           set execution_result = case
                 when v_batch_row.corrects_sale_id is null then 'posted'
                 else 'reversed'
               end,
               execution_error = null
         where id = v_batch_row.id;

        v_expected_sales_total :=
          v_expected_sales_total + v_evidence.source_amount;
        v_expected_sales_count := v_expected_sales_count + 1;
        v_expected_posted_journal_delta :=
          v_expected_posted_journal_delta + 1;
      end if;

      select l.id
        into v_ledger_id
        from public.reconciliation_execution_ledger l
       where l.evidence_item_id = v_batch_row.evidence_item_id
         and l.status = 'unexecuted'
       order by l.id
       limit 1
       for update;

      if v_ledger_id is null then
        insert into public.reconciliation_execution_ledger(
          org_id, evidence_item_id, status, executed_by_batch_row_id, executed_at
        )
        values (
          v_org, v_batch_row.evidence_item_id, 'executed',
          v_batch_row.id, now()
        );
      else
        update public.reconciliation_execution_ledger
           set status = 'executed',
               executed_by_batch_row_id = v_batch_row.id,
               executed_at = now(),
               reversed_at = null
         where id = v_ledger_id;
      end if;

      if v_zero_value_skip then
        v_skipped_count := v_skipped_count + 1;
      else
        v_executed_count := v_executed_count + 1;
      end if;
    end loop;

    select count(*)::integer, coalesce(sum(e.total), 0)
      into v_actual_expenses_count, v_actual_expenses_total
      from public.reconciliation_action_links al
      join public.expenses e
        on al.target_table = 'expenses'
       and al.target_id = e.id
       and e.org_id = al.org_id
     where al.batch_id = p_batch_id
       and al.action_kind in ('addition', 'correction_replacement');

    select count(*)::integer, coalesce(sum(coalesce(s.total, 0)), 0)
      into v_actual_sales_count, v_actual_sales_total
      from public.reconciliation_action_links al
      join public.sales s
        on al.target_table = 'sales'
       and al.target_id = s.id
       and s.org_id = al.org_id
     where al.batch_id = p_batch_id
       and al.action_kind in ('addition', 'correction_replacement');

    if v_actual_expenses_count is distinct from v_expected_expenses_count
      or round(v_actual_expenses_total, 2)
           is distinct from round(v_expected_expenses_total, 2)
      or v_actual_sales_count is distinct from v_expected_sales_count
      or round(v_actual_sales_total, 2)
           is distinct from round(v_expected_sales_total, 2)
    then
      raise exception 'domain postflight mismatch' using errcode = '23514';
    end if;

    if (
      select count(*) from public.expenses e where e.org_id = v_org
    ) is distinct from v_expenses_count + v_expected_expenses_count
      or round((
        select coalesce(sum(e.total), 0)
          from public.expenses e
         where e.org_id = v_org
      ), 2) is distinct from round(
        v_expenses_total + v_expected_expenses_total, 2
      )
      or (
        select count(*) from public.sales s where s.org_id = v_org
      ) is distinct from v_sales_count + v_expected_sales_count
      or round((
        select coalesce(sum(coalesce(s.total, 0)), 0)
          from public.sales s
         where s.org_id = v_org
      ), 2) is distinct from round(
        v_sales_total + v_expected_sales_total, 2
      )
      or (
        select count(*)
          from public.journal_entries je
         where je.org_id = v_org
           and je.status = 'posted'
      ) is distinct from v_journal_count + v_expected_posted_journal_delta
    then
      raise exception 'organization accounting baseline delta mismatch'
        using errcode = '23514';
    end if;

    if exists (
      select 1
        from public.reconciliation_action_links al
        join public.journal_lines jl on jl.journal_entry_id = al.journal_entry_id
       where al.batch_id = p_batch_id
       group by al.journal_entry_id
      having round(sum(jl.debit), 2) is distinct from round(sum(jl.credit), 2)
    ) then
      raise exception 'journal postflight mismatch' using errcode = '23514';
    end if;

    if exists (
      select 1
        from jsonb_array_elements(v_row_hash_set) baseline_row
        join public.expenses e on e.id = (baseline_row->>'id')::uuid
       where baseline_row->>'target_table' = 'expenses'
         and (
           baseline_row->>'hash' is distinct from encode(sha256(convert_to(jsonb_build_object(
             'id', e.id,
             'org_id', e.org_id,
             'date', e.date,
             'farm_id', e.farm_id,
             'sector_id', e.sector_id,
             'hawsha_id', e.hawsha_id,
             'event_id', e.event_id,
             'plan_id', e.plan_id,
             'category', e.category,
             'description', e.description,
             'supplier_id', e.supplier_id,
             'qty', e.qty,
             'unit', e.unit,
             'unit_price', e.unit_price,
             'total', e.total,
             'payment_method', e.payment_method,
             'recorded_by', e.recorded_by,
             'approved_by', e.approved_by,
             'status', e.status,
             'payment_status', e.payment_status,
             'paid_by', e.paid_by,
             'kind', e.kind,
             'account_id', e.account_id,
             'cost_center_id', e.cost_center_id,
             'corrects_expense_id', e.corrects_expense_id,
             'reversed_by_rollback_at', e.reversed_by_rollback_at
           )::text, 'UTF8')), 'hex')
           or e.payment_status is distinct from 'historical_reversed'
         )
    ) or exists (
      select 1
        from jsonb_array_elements(v_row_hash_set) baseline_row
        join public.sales s on s.id = (baseline_row->>'id')::uuid
       where baseline_row->>'target_table' = 'sales'
         and (
           baseline_row->>'hash' is distinct from encode(sha256(convert_to(
             to_jsonb(s)::text, 'UTF8')), 'hex')
           or s.payment_status is distinct from 'historical_reversed'
         )
    ) then
      raise exception 'correction target changed during execution' using errcode = '23514';
    end if;

    if exists (
      select 1
        from public.reconciliation_action_links reversal
        join public.journal_entries reversal_entry
          on reversal_entry.id = reversal.journal_entry_id
        join public.reconciliation_baseline_journal_headers original
          on original.batch_id = reversal.batch_id
         and original.source_id = reversal.target_id
         -- expenses.id and sales.id are independent UUID spaces and may legally collide; without
         -- this the snapshot of an expense could verify a sale's reversal (and vice versa).
         and original.source_type = case reversal.target_table
               when 'expenses' then 'expense' else 'sale' end
       where reversal.batch_id = p_batch_id
         and reversal.action_kind = 'correction_reversal'
         and (
           reversal_entry.reversal_of is distinct from original.original_journal_entry_id
           or not exists (
             select 1
               from public.journal_entries original_entry
              where original_entry.id = original.original_journal_entry_id
                and original_entry.status = 'reversed'
           )
         )
    ) then
      raise exception 'correction reversal linkage mismatch' using errcode = '23514';
    end if;

    if exists (
      select 1
        from public.reconciliation_baseline_journal_headers baseline
        left join public.journal_entries original
          on original.id = baseline.original_journal_entry_id
       where baseline.batch_id = p_batch_id
         and (
           original.id is null
           or original.org_id is distinct from baseline.org_id
           or original.entry_date is distinct from baseline.entry_date
           or original.source_type is distinct from baseline.source_type
           or original.source_id is distinct from baseline.source_id
           or original.source_sequence is distinct from baseline.source_sequence
           or original.description is distinct from baseline.description
           or original.status is distinct from 'reversed'
           or original.posted_at is distinct from baseline.posted_at
           or original.posted_by is distinct from baseline.posted_by
           or original.reversal_of is distinct from baseline.reversal_of
         )
    ) then
      raise exception 'original journal header changed during correction'
        using errcode = '23514';
    end if;

    if exists (
      select 1
        from public.reconciliation_baseline_journal_lines baseline_line
        join public.reconciliation_baseline_journal_headers baseline_header
          on baseline_header.id = baseline_line.baseline_journal_header_id
        left join public.journal_lines original_line
          on original_line.id = baseline_line.original_journal_line_id
       where baseline_header.batch_id = p_batch_id
         and (
           original_line.id is null
           or original_line.org_id is distinct from baseline_line.org_id
           or original_line.journal_entry_id
                is distinct from baseline_header.original_journal_entry_id
           or original_line.account_id is distinct from baseline_line.account_id
           or original_line.debit is distinct from baseline_line.debit
           or original_line.credit is distinct from baseline_line.credit
           or original_line.description is distinct from baseline_line.description
           or original_line.cost_center_id is distinct from baseline_line.cost_center_id
           or original_line.custody_account_id is distinct from baseline_line.custody_account_id
           or original_line.custody_movement_id is distinct from baseline_line.custody_movement_id
           or original_line.expense_id is distinct from baseline_line.expense_id
           or original_line.payment_request_id is distinct from baseline_line.payment_request_id
         )
    ) or exists (
      select 1
        from public.reconciliation_baseline_journal_headers baseline_header
       where baseline_header.batch_id = p_batch_id
         and (
           select count(*) from public.journal_lines original_line
            where original_line.journal_entry_id =
                  baseline_header.original_journal_entry_id
         ) is distinct from (
           select count(*) from public.reconciliation_baseline_journal_lines baseline_line
            where baseline_line.baseline_journal_header_id = baseline_header.id
         )
    ) then
      raise exception 'original journal lines changed during correction'
        using errcode = '23514';
    end if;

    if exists (
      select 1
        from public.reconciliation_action_links reversal
        join public.reconciliation_baseline_journal_headers baseline_header
          on baseline_header.batch_id = reversal.batch_id
         and baseline_header.source_id = reversal.target_id
         -- same cross-domain UUID-collision guard as the linkage check above
         and baseline_header.source_type = case reversal.target_table
               when 'expenses' then 'expense' else 'sale' end
       where reversal.batch_id = p_batch_id
         and reversal.action_kind = 'correction_reversal'
         and (
           exists (
             (
               select account_id, credit, debit, cost_center_id,
                      custody_account_id, custody_movement_id, expense_id,
                      payment_request_id
                 from public.reconciliation_baseline_journal_lines
                where baseline_journal_header_id = baseline_header.id
               except all
               select account_id, debit, credit, cost_center_id,
                      custody_account_id, custody_movement_id, expense_id,
                      payment_request_id
                 from public.journal_lines
                where journal_entry_id = reversal.journal_entry_id
             )
             union all
             (
               select account_id, debit, credit, cost_center_id,
                      custody_account_id, custody_movement_id, expense_id,
                      payment_request_id
                 from public.journal_lines
                where journal_entry_id = reversal.journal_entry_id
               except all
               select account_id, credit, debit, cost_center_id,
                      custody_account_id, custody_movement_id, expense_id,
                      payment_request_id
                 from public.reconciliation_baseline_journal_lines
                where baseline_journal_header_id = baseline_header.id
             )
           )
         )
    ) then
      raise exception 'reversal journal is not the exact inverse of its snapshot'
        using errcode = '23514';
    end if;

  exception
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate;
      -- Retryable concurrency failures are NOT a verdict on the batch. Persisting one as terminal
      -- `failed` would strand a perfectly valid approved batch on a transient
      -- serialization/deadlock/lock-timeout error. Re-raise instead: the outer transaction
      -- (including the `executing` status write) rolls back and the batch is left
      -- `approved`, so the owner can simply retry.
      if v_sqlstate in ('40001', '40P01', '55P03') then
        raise;
      end if;
      v_failure := true;
      v_failure_code := case
        when v_sqlstate = '55000' then 'locked_period'
        when v_sqlstate in ('23503', '23505', '23514') then 'integrity_check'
        when v_sqlstate in ('22023', '23502') then 'invalid_state'
        else 'execution_failed'
      end;
  end;

  if v_failure then
    update public.reconciliation_batches
       set status = 'failed',
           result_summary = jsonb_build_object(
             'failure_code', v_failure_code,
             'safe_locator', v_last_safe_row_locator
           )
     where id = p_batch_id;
    return jsonb_build_object(
      'batch_id', p_batch_id,
      'status', 'failed',
      'failure_code', v_failure_code,
      'safe_locator', v_last_safe_row_locator
    );
  end if;

  update public.reconciliation_batches
     set status = 'executed',
         result_summary = jsonb_build_object(
           'executed_rows', v_executed_count,
           'skipped_rows', v_skipped_count
         )
   where id = p_batch_id;

  return jsonb_build_object(
    'batch_id', p_batch_id,
    'status', 'executed',
    'executed_rows', v_executed_count,
    'skipped_rows', v_skipped_count
  );
end;
$$;

revoke execute on function public.fn_execute_reconciliation_batch(uuid)
  from public, anon;
grant execute on function public.fn_execute_reconciliation_batch(uuid)
  to authenticated;

comment on function public.fn_execute_reconciliation_batch(uuid) is
  'Owner-only, whole-batch atomic expense and historical-sale reconciliation execution. Takes the '
  'per-org accounting-period mutex SHARED before its first row lock.';

-- ── 0b) reconciliation_action_links becomes APPEND-ONLY, and one action kind per batch row ────────
--
-- The rollback reads the action links as the authoritative record of what the execution did. If a link
-- can be deleted, relabelled or detached after the fact, the rollback can release a ledger claim and
-- move a domain row to `historical_reversed` while the journal it was supposed to undo stays POSTED —
-- money that was never given back, reported as given back. The table already had a tenant guard on
-- INSERT/UPDATE, but nothing forbade an UPDATE or a DELETE at all.
--
-- Same shape as the baseline-snapshot immutability guards (20260726090000 §6): every column is
-- provenance, so ANY update and ANY delete is refused, from any role INCLUDING the table owner and any
-- SECURITY DEFINER path — the refusal lives in a trigger, not in a withheld grant, so revoking nothing
-- and owning everything still does not get you past it.
create or replace function public.fn_guard_reconciliation_action_link_append_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'reconciliation_action_links: rows are append-only and cannot be deleted'
      using errcode = '22023';
  end if;
  raise exception 'reconciliation_action_links: rows are append-only and cannot be updated'
    using errcode = '22023';
end;
$$;
revoke execute on function public.fn_guard_reconciliation_action_link_append_only()
  from public, anon, authenticated;
drop trigger if exists guard_reconciliation_action_link_append_only
  on public.reconciliation_action_links;
create trigger guard_reconciliation_action_link_append_only
  before update or delete on public.reconciliation_action_links
  for each row execute function public.fn_guard_reconciliation_action_link_append_only();

-- One action of each kind per batch row, enforced by the storage engine rather than by a proof that
-- could be skipped. Compatible with EVERY bundle the accepted model can produce: the executor emits at
-- most one `correction_reversal` and then at most one of `addition` / `correction_replacement` /
-- `zero_value_noop` per row (20260726150000, 20260726160000 §8), and this rollback appends at most one
-- reinstatement per reversal link, on that same row, under a DIFFERENT kind. A `batch_row_id` belongs
-- to exactly one batch, so this is also uniqueness per (batch, row, kind).
create unique index if not exists reconciliation_action_links_row_kind_uq
  on public.reconciliation_action_links(batch_row_id, action_kind);

-- ── 1) the two rollback proofs the lifecycle guards consult ───────────────────────────────────────
-- Both are SECURITY DEFINER with an empty search_path and no client EXECUTE: they are read by trigger
-- functions that already run as the owner role, and nothing else may reach them.

-- A reconciliation-CREATED row whose created journal has been reversed by a rollback. Every clause is
-- required: a link of a creating kind, for this exact row, in a batch that is ALREADY `rolled_back`,
-- whose journal really is this row's own source journal, really is now `reversed`, and really has a
-- reversing entry pointing at it. No clause can be satisfied by a caller — reconciliation_batches,
-- reconciliation_action_links and journal_entries all carry zero client write grants.
create or replace function private.fn_reconciliation_rollback_reversed_proof(
  p_org uuid,
  p_target_table text,
  p_target_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.reconciliation_action_links al
      join public.reconciliation_batches b
        on b.id = al.batch_id
       and b.org_id = al.org_id
       and b.status = 'rolled_back'
      join public.journal_entries created
        on created.id = al.journal_entry_id
       and created.org_id = al.org_id
       and created.source_type = case p_target_table when 'expenses' then 'expense' else 'sale' end
       and created.source_id = p_target_id
       and created.status = 'reversed'
      join public.journal_entries reversal
        on reversal.reversal_of = created.id
       and reversal.org_id = al.org_id
     where al.org_id = p_org
       and al.target_table = p_target_table
       and al.target_id = p_target_id
       and al.action_kind in ('addition', 'correction_replacement')
  );
$$;
revoke execute on function private.fn_reconciliation_rollback_reversed_proof(uuid, text, uuid)
  from public, anon, authenticated;

-- An ORIGINAL production row whose pre-execution journal has been reinstated by a rollback. The
-- reinstatement link must name a POSTED journal for this row AND the REVERSED original it reinstates,
-- so a bare status flip — or a link that reinstates some other row's entry — proves nothing.
create or replace function private.fn_reconciliation_rollback_reinstated_proof(
  p_org uuid,
  p_target_table text,
  p_target_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.reconciliation_action_links al
      join public.reconciliation_batches b
        on b.id = al.batch_id
       and b.org_id = al.org_id
       and b.status = 'rolled_back'
      join public.journal_entries reinstated
        on reinstated.id = al.journal_entry_id
       and reinstated.org_id = al.org_id
       and reinstated.source_type = case p_target_table when 'expenses' then 'expense' else 'sale' end
       and reinstated.source_id = p_target_id
       and reinstated.status = 'posted'
      join public.journal_entries original
        on original.id = al.reinstates_journal_entry_id
       and original.org_id = al.org_id
       and original.source_type = reinstated.source_type
       and original.source_id = p_target_id
       and original.status = 'reversed'
     where al.org_id = p_org
       and al.target_table = p_target_table
       and al.target_id = p_target_id
       and al.action_kind in (
         'correction_reversal_reinstatement', 'orphan_reversal_reinstatement'
       )
  );
$$;
revoke execute on function private.fn_reconciliation_rollback_reinstated_proof(uuid, text, uuid)
  from public, anon, authenticated;

-- ── 1b) the restoration chain, and the sale exact-history proof extended to accept it ─────────────
--
-- Answers ONE question: "apart from the single current posted journal, is every journal this sale
-- carries a spent half of a COMPLETED reversal→reinstatement cycle?" It is the only thing standing
-- between "a rolled-back sale is correctable again" and "a sale with a stray journal is silently
-- certified as pristine history", so every clause is a fail-closed requirement and the function
-- returns false on the first one that cannot be shown.
--
-- It never looks at amounts, dates, accounts or line shape: that is the CALLER's half of the proof
-- (§1b's re-emitted predicate below still applies the full original shape test to the current posted
-- entry). This function proves only that the history around that entry is closed and append-only.
create or replace function private.fn_reconciliation_sale_restoration_chain_is_closed(
  p_sale uuid,
  p_current_entry uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org               uuid;
  v_total             integer;
  v_posted            integer;
  v_reversed_origins  integer;
  v_reversal_entries  integer;
  v_reversal_links    integer;
  v_reinstate_links   integer;
  v_distinct_reversed uuid[];
begin
  select s.org_id into v_org from public.sales s where s.id = p_sale;
  if v_org is null then
    return false;
  end if;

  -- (1) NO OPEN CYCLE. Every chain link naming this sale must sit in a batch that is genuinely
  -- `rolled_back`. A link in an `executed` batch means the sale's money was taken out and never put
  -- back; a link in `executing`/`failed`/anything else is not a completed cycle either. Batch status
  -- is not forgeable — reconciliation_batches carries no client write grant.
  if exists (
    select 1
      from public.reconciliation_action_links al
      join public.reconciliation_batches b
        on b.id = al.batch_id
       and b.org_id = al.org_id
     where al.org_id = v_org
       and al.target_table = 'sales'
       and al.target_id = p_sale
       and al.action_kind in (
         'correction_reversal', 'orphan_reversal',
         'correction_reversal_reinstatement', 'orphan_reversal_reinstatement'
       )
       and b.status is distinct from 'rolled_back'
  ) then
    return false;
  end if;

  -- (2) THE CURRENT ENTRY IS ITSELF A REINSTATEMENT. Not merely "a posted journal that happens to
  -- exist": it must be the `journal_entry_id` of a reinstatement link for THIS sale, in a
  -- `rolled_back` batch, whose `reinstates_journal_entry_id` is a REVERSED journal of this same sale
  -- in this same org. A link pointing at another row's entry, or at a still-posted entry, proves
  -- nothing and is rejected here.
  if not exists (
    select 1
      from public.reconciliation_action_links al
      join public.reconciliation_batches b
        on b.id = al.batch_id
       and b.org_id = al.org_id
       and b.status = 'rolled_back'
      join public.journal_entries original
        on original.id = al.reinstates_journal_entry_id
       and original.org_id = v_org
       and original.source_type = 'sale'
       and original.source_id = p_sale
       and original.status = 'reversed'
     where al.org_id = v_org
       and al.target_table = 'sales'
       and al.target_id = p_sale
       and al.action_kind in (
         'correction_reversal_reinstatement', 'orphan_reversal_reinstatement'
       )
       and al.journal_entry_id = p_current_entry
  ) then
    return false;
  end if;

  -- (3) EVERY OTHER JOURNAL IS A CLOSED-CYCLE HALF. Written as "there exists an entry that is NOT a
  -- valid half" so a single unexplained journal — injected, unlinked, cross-batch, cross-org, wrong
  -- target, or simply left in draft — fails the whole proof.
  if exists (
    select 1
      from public.journal_entries other
     where other.org_id = v_org
       and other.source_type = 'sale'
       and other.source_id = p_sale
       and other.id <> p_current_entry
       and not (
         other.status = 'reversed'
         and (
           -- (i) a reversed ORIGINAL: some entry really reverses it, that reversal is the one this
           --     batch linked, and the SAME batch appended the reinstatement that replaced it.
           exists (
             select 1
               from public.journal_entries rev
               join public.reconciliation_action_links al_rev
                 on al_rev.journal_entry_id = rev.id
                and al_rev.org_id = v_org
                and al_rev.target_table = 'sales'
                and al_rev.target_id = p_sale
                and al_rev.action_kind in ('correction_reversal', 'orphan_reversal')
               join public.reconciliation_batches b
                 on b.id = al_rev.batch_id
                and b.org_id = al_rev.org_id
                and b.status = 'rolled_back'
               join public.reconciliation_action_links al_re
                 on al_re.batch_id = al_rev.batch_id
                and al_re.org_id = al_rev.org_id
                and al_re.target_table = 'sales'
                and al_re.target_id = p_sale
                and al_re.action_kind in (
                  'correction_reversal_reinstatement', 'orphan_reversal_reinstatement'
                )
                and al_re.reinstates_journal_entry_id = other.id
               join public.journal_entries reinstated
                 on reinstated.id = al_re.journal_entry_id
                and reinstated.org_id = v_org
                and reinstated.source_type = 'sale'
                and reinstated.source_id = p_sale
              where rev.reversal_of = other.id
                and rev.org_id = v_org
                and rev.source_type = 'sale'
                and rev.source_id = p_sale
                and rev.status = 'reversed'
           )
           -- (ii) a REVERSAL entry: this batch linked it as its reversal, and the original it
           --      reverses is a reversed journal of this sale that the SAME batch reinstated.
           or exists (
             select 1
               from public.reconciliation_action_links al_rev
               join public.reconciliation_batches b
                 on b.id = al_rev.batch_id
                and b.org_id = al_rev.org_id
                and b.status = 'rolled_back'
               join public.reconciliation_action_links al_re
                 on al_re.batch_id = al_rev.batch_id
                and al_re.org_id = al_rev.org_id
                and al_re.target_table = 'sales'
                and al_re.target_id = p_sale
                and al_re.action_kind in (
                  'correction_reversal_reinstatement', 'orphan_reversal_reinstatement'
                )
                and al_re.reinstates_journal_entry_id = other.reversal_of
               join public.journal_entries origin
                 on origin.id = other.reversal_of
                and origin.org_id = v_org
                and origin.source_type = 'sale'
                and origin.source_id = p_sale
                and origin.status = 'reversed'
              where al_rev.journal_entry_id = other.id
                and al_rev.org_id = v_org
                and al_rev.target_table = 'sales'
                and al_rev.target_id = p_sale
                and al_rev.action_kind in ('correction_reversal', 'orphan_reversal')
           )
         )
       )
  ) then
    return false;
  end if;

  -- (4) THE ARITHMETIC CLOSES. (3) proves each extra journal CAN be explained; this proves the
  -- explanations TILE the history exactly — one reversal entry and one reinstatement link per
  -- reversed original, no double-counting, one posted entry, and nothing left over.
  select count(*) filter (where je.status = 'posted'),
         count(*) filter (where je.status = 'reversed' and je.reversal_of is null),
         count(*) filter (where je.reversal_of is not null),
         count(*)
    into v_posted, v_reversed_origins, v_reversal_entries, v_total
    from public.journal_entries je
   where je.org_id = v_org
     and je.source_type = 'sale'
     and je.source_id = p_sale;

  select count(*) filter (
           where al.action_kind in ('correction_reversal', 'orphan_reversal')),
         count(*) filter (
           where al.action_kind in (
             'correction_reversal_reinstatement', 'orphan_reversal_reinstatement'
           ))
    into v_reversal_links, v_reinstate_links
    from public.reconciliation_action_links al
   where al.org_id = v_org
     and al.target_table = 'sales'
     and al.target_id = p_sale;

  if v_posted <> 1
     or v_reversed_origins < 1
     or v_reversed_origins <> v_reversal_entries
     or v_total <> v_reversed_origins + v_reversal_entries + 1
     or v_reversal_links <> v_reversed_origins
     or v_reinstate_links <> v_reversed_origins then
    return false;
  end if;

  -- No two reinstatements may claim the same reversed original (which would let ONE completed cycle
  -- account for TWO unexplained journals), and no two reversal links the same reversal entry.
  select array_agg(distinct al.reinstates_journal_entry_id)
    into v_distinct_reversed
    from public.reconciliation_action_links al
   where al.org_id = v_org
     and al.target_table = 'sales'
     and al.target_id = p_sale
     and al.action_kind in (
       'correction_reversal_reinstatement', 'orphan_reversal_reinstatement'
     );
  if coalesce(array_length(v_distinct_reversed, 1), 0) <> v_reinstate_links then
    return false;
  end if;

  select array_agg(distinct al.journal_entry_id)
    into v_distinct_reversed
    from public.reconciliation_action_links al
   where al.org_id = v_org
     and al.target_table = 'sales'
     and al.target_id = p_sale
     and al.action_kind in ('correction_reversal', 'orphan_reversal');
  if coalesce(array_length(v_distinct_reversed, 1), 0) <> v_reversal_links then
    return false;
  end if;

  return true;
end;
$$;
revoke execute on function private.fn_reconciliation_sale_restoration_chain_is_closed(uuid, uuid)
  from public, anon, authenticated;

-- 20260726160000 §3 re-emitted. EVERY original clause is reproduced verbatim — finalized price, a
-- positive total, the sale's own economic date under the pinned UTC zone, the zero-collection rule
-- (still matched on `sale_id` ALONE so a mis-orged collection row cannot hide), exactly two lines,
-- Dr 1010 for the exact total, Cr one TYPED revenue leaf for the exact total. The scope note from
-- 20260726160000 §3 still holds: this proves a historical journal WAS POSTED, and deliberately does
-- not require the revenue leaf to be active or childless.
--
-- The ONLY change is marked ▼▼/▲▲: the single `count(*) = 1 in any status` clause becomes "exactly
-- one CURRENT POSTED journal, and either that is the sale's only journal ever (pristine) or the rest
-- form a closed rollback chain". Soundness is preserved because the count is not merely relaxed —
-- shape (b) requires every extra journal to be proven-spent, which shape (a) got for free from the
-- total being 1.
create or replace function private.fn_reconciliation_sale_has_exact_historical_journal(p_sale uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
set "TimeZone" = 'UTC'
as $$
  select exists (
    select 1
      from public.sales s
      join public.journal_entries je
        on je.org_id = s.org_id
       and je.source_type = 'sale'
       and je.source_id = s.id
       and je.status = 'posted'
       and je.reversal_of is null
     where s.id = p_sale
       and s.price_status = 'finalized'
       and s.total is not null
       and s.total > 0
       -- the sale's own economic date, exactly as the backfill computed it (under the pinned UTC zone)
       and je.entry_date = coalesce(s.sale_date, (s.created_at at time zone 'UTC')::date)
       -- cash-in: no receivable was ever opened, so no collection may exist. Matched on `sale_id`
       -- ALONE, deliberately — a collection against this sale disqualifies it whatever org_id it
       -- claims (see 20260726160000 §3 for the full reasoning).
       and not exists (
         select 1 from public.sale_collections c
          where c.sale_id = s.id
       )
       -- ▼▼ EXACTLY ONE CURRENT POSTED journal. Ambiguity is still fatal: two posted `sale` entries
       -- for one sale can never certify, whatever the history around them looks like. ▼▼
       and (
         select count(*) from public.journal_entries posted
          where posted.org_id = s.org_id
            and posted.source_type = 'sale'
            and posted.source_id = s.id
            and posted.status = 'posted'
       ) = 1
       -- ... and the rest of the sale's journal history is either EMPTY (a pristine historical sale,
       -- byte-identical to the original predicate) or a COMPLETE, append-only, internally consistent
       -- rollback chain that accounts for every one of them.
       and (
         (
           select count(*) from public.journal_entries other
            where other.org_id = s.org_id
              and other.source_type = 'sale'
              and other.source_id = s.id
         ) = 1
         or private.fn_reconciliation_sale_restoration_chain_is_closed(s.id, je.id)
       )
       -- ▲▲ end of the only change from 20260726160000 §3 ▲▲
       and (
         select count(*) from public.journal_lines jl
          where jl.journal_entry_id = je.id
       ) = 2
       -- Dr 1010 النقدية بالخزينة for the exact total
       and exists (
         select 1
           from public.journal_lines cash_line
           join public.accounts cash_account
             on cash_account.id = cash_line.account_id
            and cash_account.org_id = s.org_id
            and cash_account.code = '1010'
          where cash_line.journal_entry_id = je.id
            and cash_line.debit = s.total
            and cash_line.credit = 0
       )
       -- Cr one TYPED revenue leaf for the exact total (never the 4000 parent)
       and exists (
         select 1
           from public.journal_lines revenue_line
           join public.accounts revenue_account
             on revenue_account.id = revenue_line.account_id
            and revenue_account.org_id = s.org_id
          where revenue_line.journal_entry_id = je.id
            and revenue_account.account_type = 'revenue'
            and revenue_account.code = any (
              private.fn_reconciliation_historical_revenue_codes()
            )
            and revenue_line.credit = s.total
            and revenue_line.debit = 0
       )
  );
$$;
revoke execute on function private.fn_reconciliation_sale_has_exact_historical_journal(uuid)
  from public, anon, authenticated;

-- ── 2) EXPENSE lifecycle guard — 20260726150000 verbatim plus the two rollback branches ───────────
create or replace function private.fn_guard_historical_treasury_expense()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A reversed historical expense is frozen except for `reversed_by_rollback_at`,
  -- the single column the reconciliation-rollback executor stamps for bookkeeping.
  if old.payment_status = 'historical_reversed' then
    -- ▼▼ rollback reinstatement: the ONE way out of `historical_reversed`. Permitted only after this
    --    rollback has already appended a reinstatement link naming a POSTED journal for this row and
    --    the REVERSED original it reinstates, inside a batch already marked `rolled_back`. Only the
    --    status may move — every other column stays frozen, so this is strictly narrower than the
    --    freeze it replaces, not a relaxation of it. A `historical_treasury` claim that cannot show
    --    the proof falls straight through to the immutability refusal below. ▼▼
    if new.payment_status = 'historical_treasury'
       and private.fn_reconciliation_rollback_reinstated_proof(old.org_id, 'expenses', old.id) then
      if to_jsonb(new) - array['payment_status']::text[]
           is distinct from to_jsonb(old) - array['payment_status']::text[] then
        raise exception 'a reconciliation rollback reinstatement may only restore the expense payment status'
          using errcode = '22023';
      end if;
      return new;
    end if;
    -- ▲▲ end rollback reinstatement branch ▲▲
    if to_jsonb(new) - array['reversed_by_rollback_at']::text[]
         is distinct from to_jsonb(old) - array['reversed_by_rollback_at']::text[] then
      raise exception 'reversed historical expense is immutable'
        using errcode = '22023';
    end if;
    return new;
  end if;

  if new.payment_status in ('historical_treasury', 'historical_reversed')
     and new.payment_status is distinct from old.payment_status
     and to_jsonb(new) - array['payment_status']::text[]
       is distinct from to_jsonb(old) - array['payment_status']::text[] then
    raise exception 'historical reconciliation transition cannot alter expense fields'
      using errcode = '22023';
  end if;

  if new.payment_status = 'historical_treasury'
     and old.payment_status is distinct from 'historical_treasury' then
    if not exists (
      select 1
        from public.journal_entries je
        join public.journal_lines cash_line
          on cash_line.journal_entry_id = je.id
        join public.accounts cash_account
          on cash_account.id = cash_line.account_id
         and cash_account.org_id = old.org_id
         and cash_account.code = '1010'
       where je.org_id = old.org_id
         and je.source_type = 'expense'
         and je.source_id = old.id
         and je.status = 'posted'
         and cash_line.credit = old.total
         and cash_line.debit = 0
    ) then
      raise exception 'historical treasury status requires a matching posted treasury journal'
        using errcode = '22023';
    end if;
  end if;

  if new.payment_status = 'historical_reversed'
     and old.payment_status is distinct from 'historical_reversed' then
    if not exists (
      select 1
        from public.reconciliation_action_links al
        join public.journal_entries reversal
          on reversal.id = al.journal_entry_id
        join public.journal_entries original
          on original.id = reversal.reversal_of
       where al.org_id = old.org_id
         and al.target_table = 'expenses'
         and al.target_id = old.id
         and al.action_kind = 'correction_reversal'
         and original.org_id = old.org_id
         and original.source_type = 'expense'
         and original.source_id = old.id
    )
    -- ▼▼ the rollback of a reconciliation-CREATED expense reverses a journal this batch itself
    --    posted, so there is no `correction_reversal` link behind it — the creating link plus the
    --    now-reversed created journal is the proof instead. Added as an ALTERNATIVE: the original
    --    execution-time proof above is unchanged and still stands on its own. ▼▼
    and not private.fn_reconciliation_rollback_reversed_proof(old.org_id, 'expenses', old.id)
    -- ▲▲ end rollback alternative ▲▲
    then
      raise exception 'historical reversed status requires a verified reconciliation reversal'
        using errcode = '22023';
    end if;
  end if;

  if old.payment_status is distinct from 'historical_treasury' then
    return new;
  end if;

  if to_jsonb(new) - array['payment_status']::text[]
       is distinct from to_jsonb(old) - array['payment_status']::text[] then
    raise exception 'posted historical treasury expense is immutable'
      using errcode = '22023';
  end if;

  if new.payment_status is distinct from old.payment_status
     and new.payment_status <> 'historical_reversed' then
    raise exception 'historical treasury reconciliation must be reversed, not rerouted'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke execute on function private.fn_guard_historical_treasury_expense()
  from public, anon, authenticated;

drop trigger if exists guard_historical_treasury_expense
  on public.expenses;
create trigger guard_historical_treasury_expense
  before update on public.expenses
  for each row execute function private.fn_guard_historical_treasury_expense();

-- ── 3) SALE lifecycle guard — 20260726160000 §4 verbatim plus the same two rollback branches ──────
create or replace function private.fn_guard_historical_treasury_sale()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- INSERT can never claim a historical state (20260726160000 §4, verbatim).
  if tg_op = 'INSERT' then
    if new.payment_status in ('historical_treasury', 'historical_reversed') then
      raise exception 'a historical reconciliation sale state cannot be claimed on insert'
        using errcode = '22023';
    end if;
    return new;
  end if;

  if old.payment_status = 'historical_reversed' then
    -- ▼▼ rollback reinstatement — see the expense guard above; identical contract, sales domain. ▼▼
    if new.payment_status = 'historical_treasury'
       and private.fn_reconciliation_rollback_reinstated_proof(old.org_id, 'sales', old.id) then
      if to_jsonb(new) - array['payment_status']::text[]
           is distinct from to_jsonb(old) - array['payment_status']::text[] then
        raise exception 'a reconciliation rollback reinstatement may only restore the sale payment status'
          using errcode = '22023';
      end if;
      return new;
    end if;
    -- ▲▲ end rollback reinstatement branch ▲▲
    if to_jsonb(new) - array['reversed_by_rollback_at']::text[]
         is distinct from to_jsonb(old) - array['reversed_by_rollback_at']::text[] then
      raise exception 'reversed historical sale is immutable'
        using errcode = '22023';
    end if;
    return new;
  end if;

  if new.payment_status in ('historical_treasury', 'historical_reversed')
     and new.payment_status is distinct from old.payment_status
     and to_jsonb(new) - array['payment_status']::text[]
       is distinct from to_jsonb(old) - array['payment_status']::text[] then
    raise exception 'historical reconciliation transition cannot alter sale fields'
      using errcode = '22023';
  end if;

  if new.payment_status = 'historical_treasury'
     and old.payment_status is distinct from 'historical_treasury' then
    if not private.fn_reconciliation_sale_has_exact_historical_journal(old.id) then
      raise exception 'historical treasury sale status requires a matching posted treasury journal'
        using errcode = '22023';
    end if;
  end if;

  if new.payment_status = 'historical_reversed'
     and old.payment_status is distinct from 'historical_reversed' then
    if not exists (
      select 1
        from public.reconciliation_action_links al
        join public.journal_entries reversal
          on reversal.id = al.journal_entry_id
        join public.journal_entries original
          on original.id = reversal.reversal_of
       where al.org_id = old.org_id
         and al.target_table = 'sales'
         and al.target_id = old.id
         and al.action_kind = 'correction_reversal'
         and original.org_id = old.org_id
         and original.source_type = 'sale'
         and original.source_id = old.id
    )
    -- ▼▼ rollback of a reconciliation-CREATED sale — see the expense guard above. ▼▼
    and not private.fn_reconciliation_rollback_reversed_proof(old.org_id, 'sales', old.id)
    -- ▲▲ end rollback alternative ▲▲
    then
      raise exception 'historical reversed sale status requires a verified reconciliation reversal'
        using errcode = '22023';
    end if;
  end if;

  if old.payment_status is distinct from 'historical_treasury' then
    return new;
  end if;

  if to_jsonb(new) - array['payment_status']::text[]
       is distinct from to_jsonb(old) - array['payment_status']::text[] then
    raise exception 'posted historical treasury sale is immutable'
      using errcode = '22023';
  end if;

  if new.payment_status is distinct from old.payment_status
     and new.payment_status <> 'historical_reversed' then
    raise exception 'historical treasury sale reconciliation must be reversed, not rerouted'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke execute on function private.fn_guard_historical_treasury_sale()
  from public, anon, authenticated;

drop trigger if exists guard_historical_treasury_sale on public.sales;
create trigger guard_historical_treasury_sale
  before insert or update on public.sales
  for each row execute function private.fn_guard_historical_treasury_sale();

-- ── 4) exact reinstatement from the immutable baseline snapshot ───────────────────────────────────
-- Replays one snapshotted journal entry back into the ledger and PROVES the replay before returning.
-- Private: it writes money and trusts its caller to have established owner + org authority already.
create or replace function private.fn_reconciliation_reinstate_baseline_journal(
  p_org uuid,
  p_batch_id uuid,
  p_original_entry uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_header          public.reconciliation_baseline_journal_headers%rowtype;
  v_new_entry       uuid;
  v_sequence        integer;
  v_baseline_lines  integer;
  v_new_lines       integer;
  v_debit           numeric;
  v_credit          numeric;
begin
  -- ▼▼ per-org period mutex, SHARE (§0). `public.fn_rollback_reconciliation_batch` already took it
  --    before its lock ladder, so this is a defence-in-depth re-acquisition by the same transaction
  --    (immediately re-granted, no wait) that also protects any future caller of this helper. ▼▼
  perform pg_catalog.pg_advisory_xact_lock_shared(private.fn_accounting_period_mutex_key(p_org));
  -- ▲▲ end period mutex ▲▲

  select h.* into v_header
    from public.reconciliation_baseline_journal_headers h
   where h.batch_id = p_batch_id
     and h.original_journal_entry_id = p_original_entry
     and h.org_id = p_org;
  if v_header.id is null then
    raise exception 'reconciliation rollback has no baseline snapshot for the reversed journal'
      using errcode = '23514';
  end if;
  -- The snapshot is only reinstatable as a posting if it WAS a posting when captured. A snapshot
  -- captured in any other status would silently re-post something that was never live.
  if v_header.status is distinct from 'posted' then
    raise exception 'reconciliation rollback can only reinstate a snapshot captured while posted'
      using errcode = '23514';
  end if;

  -- The reinstatement lands on the ORIGINAL's own economic date, so it restores the exact period the
  -- execution took the money out of. That period must therefore be open — the same standard
  -- private.fn_reverse_journal_entry_internal applies to both sides of a reversal.
  if public.fn_period_locked(p_org, v_header.entry_date) then
    raise exception 'cannot reinstate a journal entry into a locked accounting period'
      using errcode = '55000';
  end if;

  -- Deterministic sequence: lock the source's whole journal family in sequence order, then take
  -- max + 1 — byte-for-byte the rule 20260706081636 established for re-posting a source.
  perform 1
    from public.journal_entries je
   where je.org_id = p_org
     and je.source_type = v_header.source_type
     and je.source_id = v_header.source_id
   order by je.source_sequence
   for update;

  select coalesce(max(je.source_sequence), 0) + 1
    into v_sequence
    from public.journal_entries je
   where je.org_id = p_org
     and je.source_type = v_header.source_type
     and je.source_id = v_header.source_id;

  insert into public.journal_entries(
    org_id, entry_date, source_type, source_id, source_sequence,
    description, status, reversal_of)
  values (
    p_org, v_header.entry_date, v_header.source_type, v_header.source_id,
    v_sequence, v_header.description, 'posted', v_header.reversal_of)
  returning id into v_new_entry;

  insert into public.journal_lines(
    org_id, journal_entry_id, account_id, debit, credit, description,
    cost_center_id, custody_account_id, custody_movement_id,
    expense_id, payment_request_id)
  select
    line.org_id, v_new_entry, line.account_id, line.debit, line.credit,
    line.description, line.cost_center_id, line.custody_account_id,
    line.custody_movement_id, line.expense_id, line.payment_request_id
    from public.reconciliation_baseline_journal_lines line
   where line.baseline_journal_header_id = v_header.id
   order by line.line_ordinal;

  -- ── the proof. A reinstatement that is not exact is worse than no reinstatement at all. ──────────
  select count(*)::integer into v_baseline_lines
    from public.reconciliation_baseline_journal_lines line
   where line.baseline_journal_header_id = v_header.id;
  select count(*)::integer into v_new_lines
    from public.journal_lines jl
   where jl.journal_entry_id = v_new_entry;
  if v_baseline_lines = 0 or v_new_lines is distinct from v_baseline_lines then
    raise exception 'reinstated journal does not carry the snapshot''s line count'
      using errcode = '23514';
  end if;

  -- Multiset equality in BOTH directions over every typed dimension the snapshot carries, so neither
  -- a missing line nor an extra line nor a swapped dimension can pass.
  if exists (
    (
      select account_id, debit, credit, description, cost_center_id,
             custody_account_id, custody_movement_id, expense_id, payment_request_id
        from public.reconciliation_baseline_journal_lines
       where baseline_journal_header_id = v_header.id
      except all
      select account_id, debit, credit, description, cost_center_id,
             custody_account_id, custody_movement_id, expense_id, payment_request_id
        from public.journal_lines
       where journal_entry_id = v_new_entry
    )
    union all
    (
      select account_id, debit, credit, description, cost_center_id,
             custody_account_id, custody_movement_id, expense_id, payment_request_id
        from public.journal_lines
       where journal_entry_id = v_new_entry
      except all
      select account_id, debit, credit, description, cost_center_id,
             custody_account_id, custody_movement_id, expense_id, payment_request_id
        from public.reconciliation_baseline_journal_lines
       where baseline_journal_header_id = v_header.id
    )
  ) then
    raise exception 'reinstated journal lines are not an exact copy of the immutable snapshot'
      using errcode = '23514';
  end if;

  -- Header exactness over every replay-relevant column. id / source_sequence / posted_at / posted_by
  -- are excluded BY DESIGN (see this migration's header): they must differ for a new row, and
  -- asserting the snapshot's values onto them would fabricate when the ledger was written.
  if not exists (
    select 1
      from public.journal_entries je
     where je.id = v_new_entry
       and je.org_id = v_header.org_id
       and je.entry_date = v_header.entry_date
       and je.source_type = v_header.source_type
       and je.source_id = v_header.source_id
       and je.description is not distinct from v_header.description
       and je.status = 'posted'
       and je.reversal_of is not distinct from v_header.reversal_of
  ) then
    raise exception 'reinstated journal header does not match its immutable snapshot'
      using errcode = '23514';
  end if;

  -- The repository's balance guard is a DEFERRED constraint trigger, so it would only fire at COMMIT
  -- — far too late for this function to report anything useful. Checked eagerly here instead.
  select coalesce(sum(jl.debit), 0), coalesce(sum(jl.credit), 0)
    into v_debit, v_credit
    from public.journal_lines jl
   where jl.journal_entry_id = v_new_entry;
  if round(v_debit, 2) is distinct from round(v_credit, 2) then
    raise exception 'reinstated journal is unbalanced' using errcode = '23514';
  end if;

  return v_new_entry;
end;
$$;
revoke execute on function private.fn_reconciliation_reinstate_baseline_journal(uuid, uuid, uuid)
  from public, anon, authenticated;

-- ── 4b) the execution-evidence preflight: prove the action links ARE the execution ────────────────
--
-- WHY THIS EXISTS. Everything the rollback does downstream is driven by `reconciliation_action_links`:
-- pass 1 reverses the journal each `addition`/`correction_replacement` link names, pass 2 reinstates the
-- baseline behind each `correction_reversal` link, and the ledger transition then releases the evidence
-- claim for EVERY row this batch executed — whether or not a link was ever found for it. So a link that
-- is ABSENT, or names another row, or carries the wrong kind, does not merely skip a step: the ledger
-- claim is still released and the batch is still marked `rolled_back`, while the journal that link was
-- supposed to undo stays POSTED. The books would then report money returned that is still spent.
--
-- WHAT IS PROVED, BEFORE THE BATCH STATUS MOVES AND BEFORE ANY MONEY IS TOUCHED. Two directions, and
-- BOTH must hold — either alone is satisfiable by a forged half:
--
--   FORWARD (no missing action). For every `executed` ledger row this batch owns, the links on its
--   batch row must be EXACTLY the bundle that row's FROZEN review decision and its evidence item
--   require — derived from the data, never read back from the links themselves:
--       positive addition      → exactly {addition}
--       zero addition          → exactly {zero_value_noop}
--       positive correction    → exactly {correction_reversal, correction_replacement}
--       zero correction        → exactly {correction_reversal}
--   The comparison is a sorted multiset, so a missing kind, an extra kind, a relabelled kind and a
--   duplicate kind all fail identically.
--
--   ORPHAN REVERSAL, EXACTLY WHERE THE ACCEPTED MODEL SUPPORTS IT. `orphan_reversal` is a kind the
--   SCHEMA reserves for reversing a production journal that no correction replaces; no executor emits
--   it yet, and the rollback treats it identically to `correction_reversal` (pass 2 reinstates both
--   from the same baseline snapshot, and appends the matching `orphan_reversal_reinstatement`). It is
--   therefore accepted in — and ONLY in — the REVERSAL SLOT of a bundle, i.e. on a batch row whose
--   frozen decision names a correction target, and it must satisfy every shape rule
--   `correction_reversal` must satisfy. On a row with no correction target the derived bundle has no
--   reversal slot at all, so an `orphan_reversal` there fails exactly like any other stray kind.
--
--   REVERSE (no extra or detached action). Every ORIGINAL execution link in this batch must map to
--   exactly ONE `executed` ledger row, owned by this batch, for its own batch row, its own evidence
--   item and this org. A link whose ledger claim was never made, was made by another batch, or has
--   already been reversed, has nothing to undo and aborts the whole rollback.
--
-- Each link is then checked against the thing it claims to have done: a `zero_value_noop` must carry no
-- target and no journal at all; a `correction_reversal` must name the frozen row's OWN correction target
-- and a journal that really reverses that target's posting; an `addition`/`correction_replacement` must
-- name a row that is still `historical_treasury`, whose `corrects_*` pointer agrees with the frozen
-- decision (set for a replacement, null for an addition), and whose journal is that row's own POSTED,
-- non-reversal entry. A link pointing at a real but unrelated row therefore fails as loudly as a link
-- pointing at nothing.
--
-- Reinstatement links are NOT expected here and their presence is itself a failure: this rollback
-- appends them, and it only ever runs against a batch that is still `executed`. Once appended they are
-- covered by the same append-only guard and the same (batch_row_id, action_kind) uniqueness as every
-- other link (§0b).
--
-- STABLE, so it can only read; every write in this slice stays in the caller.
create or replace function private.fn_reconciliation_rollback_assert_action_bundle(
  p_org uuid,
  p_batch_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row      record;
  v_corrects uuid;
  v_other    uuid;
  v_source   text;
  v_expected text[];
  v_actual   text[];
begin
  -- (0) no reinstatement link may pre-exist: this rollback is the only writer of those kinds, and it
  --     runs exactly once per batch.
  if exists (
    select 1
      from public.reconciliation_action_links al
     where al.batch_id = p_batch_id
       and al.action_kind in (
         'correction_reversal_reinstatement', 'orphan_reversal_reinstatement'
       )
  ) then
    raise exception
      'reconciliation rollback preflight: a reinstatement action link already exists for this batch'
      using errcode = '23514';
  end if;

  -- (1) REVERSE: every original execution link belongs to this batch and org, sits on a batch row of
  --     THIS batch, and maps to exactly one `executed` ledger row for that row's own evidence item.
  if exists (
    select 1
      from public.reconciliation_action_links al
      left join public.reconciliation_batch_rows br
        on br.id = al.batch_row_id
       and br.org_id = al.org_id
       and br.batch_id = al.batch_id
     where al.batch_id = p_batch_id
       and al.action_kind in (
         'addition', 'correction_reversal', 'correction_replacement',
         'orphan_reversal', 'zero_value_noop'
       )
       and (
         al.org_id is distinct from p_org
         or br.id is null
         or (
           select count(*)
             from public.reconciliation_execution_ledger l
            where l.org_id = al.org_id
              and l.status = 'executed'
              and l.executed_by_batch_row_id = al.batch_row_id
              and l.evidence_item_id = br.evidence_item_id
         ) <> 1
       )
  ) then
    raise exception
      'reconciliation rollback preflight: an execution action link does not map to exactly one owned executed ledger row'
      using errcode = '23514';
  end if;

  -- (2) FORWARD: every executed ledger row this batch owns carries the exact bundle its frozen review
  --     decision and its evidence item require.
  for v_row in
    select l.id                as ledger_id,
           l.org_id            as ledger_org,
           l.evidence_item_id  as ledger_evidence,
           br.id               as batch_row_id,
           br.evidence_item_id as row_evidence,
           br.target_table     as target_table,
           br.corrects_expense_id,
           br.corrects_sale_id,
           ei.source_amount    as source_amount
      from public.reconciliation_execution_ledger l
      join public.reconciliation_batch_rows br
        on br.id = l.executed_by_batch_row_id
      left join public.reconciliation_evidence_items ei
        on ei.id = br.evidence_item_id
       and ei.org_id = br.org_id
     where l.status = 'executed'
       and br.batch_id = p_batch_id
     order by br.id
  loop
    -- The ledger claim, the batch row and the evidence item must agree on tenant and identity before
    -- anything is derived from them.
    if v_row.ledger_org is distinct from p_org
       or v_row.ledger_evidence is distinct from v_row.row_evidence
       or v_row.target_table is null
       or v_row.source_amount is null
       or v_row.source_amount < 0 then
      raise exception
        'reconciliation rollback preflight: an executed ledger row does not agree with its batch row and evidence item'
        using errcode = '23514';
    end if;

    if v_row.target_table = 'expenses' then
      v_corrects := v_row.corrects_expense_id;
      v_other    := v_row.corrects_sale_id;
      v_source   := 'expense';
    else
      v_corrects := v_row.corrects_sale_id;
      v_other    := v_row.corrects_expense_id;
      v_source   := 'sale';
    end if;
    -- A correction pointer for the domain this row does NOT target is a mismatched decision, not a
    -- harmless leftover: it would mean the frozen row describes two different actions.
    if v_other is not null then
      raise exception
        'reconciliation rollback preflight: a batch row carries a correction target for the wrong domain'
        using errcode = '23514';
    end if;

    v_expected := case
      when v_corrects is null then
        case when v_row.source_amount = 0
             then array['zero_value_noop']
             else array['addition'] end
      else
        case when v_row.source_amount = 0
             then array['correction_reversal']
             else array['correction_replacement', 'correction_reversal'] end
    end;
    -- Sort BOTH sides with the same comparison, so the equality test can never depend on the literal
    -- order written above or on the database collation.
    v_expected := array(select kind from unnest(v_expected) as kind order by kind);

    -- `orphan_reversal` is normalized onto the reversal slot (see this function's header): the two
    -- reversal kinds are interchangeable HERE and nowhere else, because the rollback undoes both by
    -- the same route. Every other kind is compared literally.
    select coalesce(
             array_agg(
               case al.action_kind when 'orphan_reversal' then 'correction_reversal'
                                   else al.action_kind end
               order by case al.action_kind when 'orphan_reversal' then 'correction_reversal'
                                            else al.action_kind end
             ),
             array[]::text[]
           )
      into v_actual
      from public.reconciliation_action_links al
     where al.batch_id = p_batch_id
       and al.org_id = p_org
       and al.batch_row_id = v_row.batch_row_id
       and al.action_kind in (
         'addition', 'correction_reversal', 'correction_replacement',
         'orphan_reversal', 'zero_value_noop'
       );

    if v_actual is distinct from v_expected then
      raise exception
        'reconciliation rollback preflight: the action links for an executed batch row are not the exact bundle its frozen row and evidence require'
        using errcode = '23514';
    end if;

    -- A zero-value no-op moved nothing, so it must claim nothing.
    if exists (
      select 1
        from public.reconciliation_action_links al
       where al.batch_id = p_batch_id
         and al.batch_row_id = v_row.batch_row_id
         and al.action_kind = 'zero_value_noop'
         and (al.target_table is not null
              or al.target_id is not null
              or al.journal_entry_id is not null
              or al.reinstates_journal_entry_id is not null)
    ) then
      raise exception
        'reconciliation rollback preflight: a zero-value no-op link claims a target or a journal'
        using errcode = '23514';
    end if;

    -- The reversal link — under EITHER reversal kind — must name the frozen row's OWN correction
    -- target and a journal that really reverses that target's posting in this org.
    if exists (
      select 1
        from public.reconciliation_action_links al
       where al.batch_id = p_batch_id
         and al.batch_row_id = v_row.batch_row_id
         and al.action_kind in ('correction_reversal', 'orphan_reversal')
         and (
           al.target_table is distinct from v_row.target_table
           or al.target_id is distinct from v_corrects
           or al.journal_entry_id is null
           or not exists (
             select 1
               from public.journal_entries reversal
               join public.journal_entries original
                 on original.id = reversal.reversal_of
                and original.org_id = p_org
                and original.source_type = v_source
                and original.source_id = v_corrects
              where reversal.id = al.journal_entry_id
                and reversal.org_id = p_org
                and reversal.source_type = v_source
                and reversal.source_id = v_corrects
           )
         )
    ) then
      raise exception
        'reconciliation rollback preflight: a correction reversal link does not name this row''s own reversed original'
        using errcode = '23514';
    end if;

    -- The creating link must name a row this execution created for THIS batch row: still
    -- `historical_treasury`, correction pointer exactly as the frozen decision says, and carrying its
    -- own POSTED, non-reversal journal.
    if v_row.target_table = 'expenses' then
      if exists (
        select 1
          from public.reconciliation_action_links al
         where al.batch_id = p_batch_id
           and al.batch_row_id = v_row.batch_row_id
           and al.action_kind in ('addition', 'correction_replacement')
           and not exists (
             select 1
               from public.expenses e
              where e.id = al.target_id
                and e.org_id = p_org
                and al.target_table = 'expenses'
                and e.payment_status = 'historical_treasury'
                and e.corrects_expense_id is not distinct from (
                  case when al.action_kind = 'correction_replacement' then v_corrects end
                )
                and exists (
                  select 1
                    from public.journal_entries je
                   where je.id = al.journal_entry_id
                     and je.org_id = p_org
                     and je.source_type = 'expense'
                     and je.source_id = e.id
                     and je.status = 'posted'
                     and je.reversal_of is null
                )
           )
      ) then
        raise exception
          'reconciliation rollback preflight: a created-expense link does not name this batch row''s own posted historical expense'
          using errcode = '23514';
      end if;
    else
      if exists (
        select 1
          from public.reconciliation_action_links al
         where al.batch_id = p_batch_id
           and al.batch_row_id = v_row.batch_row_id
           and al.action_kind in ('addition', 'correction_replacement')
           and not exists (
             select 1
               from public.sales s
              where s.id = al.target_id
                and s.org_id = p_org
                and al.target_table = 'sales'
                and s.payment_status = 'historical_treasury'
                and s.corrects_sale_id is not distinct from (
                  case when al.action_kind = 'correction_replacement' then v_corrects end
                )
                and exists (
                  select 1
                    from public.journal_entries je
                   where je.id = al.journal_entry_id
                     and je.org_id = p_org
                     and je.source_type = 'sale'
                     and je.source_id = s.id
                     and je.status = 'posted'
                     and je.reversal_of is null
                )
           )
      ) then
        raise exception
          'reconciliation rollback preflight: a created-sale link does not name this batch row''s own posted historical sale'
          using errcode = '23514';
      end if;
    end if;
  end loop;
end;
$$;
revoke execute on function private.fn_reconciliation_rollback_assert_action_bundle(uuid, uuid)
  from public, anon, authenticated;

-- ── 5) the one rollback path ──────────────────────────────────────────────────────────────────────
create or replace function public.fn_rollback_reconciliation_batch(
  p_batch_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid                    uuid := (select auth.uid());
  v_org                    uuid;
  v_status                 text;
  v_reason                 text;
  v_rolled_back_at         timestamptz := now();
  v_link                   record;
  v_entry_date             date;
  v_reversal_entry         uuid;
  v_original_entry         uuid;
  v_reinstated_entry       uuid;
  v_expenses_count         integer;
  v_expenses_total         numeric;
  v_sales_count            integer;
  v_sales_total            numeric;
  v_posted_journal_count   integer;
  v_reversed_journals      integer := 0;
  v_reinstated_journals    integer := 0;
  v_zero_value_rows        integer := 0;
  v_ledger_reversed        integer := 0;
  v_rows_marked            integer := 0;
begin
  if p_batch_id is null then
    raise exception 'batch id required' using errcode = '23502';
  end if;

  -- The reason is MANDATORY and is the audit record of why real money was undone. Validated before
  -- anything is read, because it depends on no tenant state and leaks nothing.
  v_reason := nullif(trim(coalesce(p_reason, '')), '');
  if v_reason is null then
    raise exception 'rollback reason required' using errcode = '23502';
  end if;
  if length(v_reason) > 500 then
    raise exception 'rollback reason is too long' using errcode = '22023';
  end if;

  -- ▼▼ per-org period mutex, SHARE (§0). Resolved through a NON-LOCKING read of the same
  --    membership-filtered query used below, purely so the key can be computed BEFORE this transaction
  --    takes any row lock — a transaction that already holds the mutex can never queue behind a pending
  --    exclusive close while another transaction waits on its rows. A batch that is missing or belongs
  --    to another tenant resolves to null, skips the lock, and falls through to the identical redacted
  --    P0002 below, so the existence oracle is unchanged. ▼▼
  select b.org_id
    into v_org
    from public.reconciliation_batches b
   where b.id = p_batch_id
     and b.org_id in (select public.user_org_ids());
  if v_org is not null then
    perform pg_catalog.pg_advisory_xact_lock_shared(private.fn_accounting_period_mutex_key(v_org));
  end if;
  v_org := null;
  -- ▲▲ end period mutex ▲▲

  -- Resolved THROUGH the caller's org membership, exactly as fn_execute_reconciliation_batch does, so
  -- "exists but belongs to another tenant" and "does not exist anywhere" fall out of the same empty
  -- result and raise the SAME SQLSTATE and the SAME message. SECURITY DEFINER bypasses RLS, so any
  -- distinct verdict here would be a cross-tenant existence oracle. Membership is resolved BEFORE the
  -- owner/permission check for the same reason: a role verdict would itself confirm the row exists.
  select b.org_id, b.status
    into v_org, v_status
    from public.reconciliation_batches b
   where b.id = p_batch_id
     and b.org_id in (select public.user_org_ids())
   for update;

  if v_org is null then
    raise exception 'reconciliation batch not found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1
      from public.organization_member m
     where m.org_id = v_org
       and m.user_id = v_uid
       and m.role = 'owner'
  ) or not public.authorize('reconciliation.write', v_org) then
    raise exception 'forbidden: only an owner may roll back reconciliation' using errcode = '42501';
  end if;

  -- Idempotent repeat: an already rolled-back batch returns its terminal state and writes NOTHING.
  if v_status = 'rolled_back' then
    return jsonb_build_object(
      'batch_id', p_batch_id,
      'status', 'rolled_back',
      'idempotent', true
    );
  end if;
  -- Every other state fails closed: staged/reviewed/approved never moved money, `executing` is another
  -- transaction's in-flight work, and `failed` already rolled itself back atomically.
  if v_status <> 'executed' then
    raise exception 'only an executed reconciliation batch may roll back' using errcode = '22023';
  end if;

  -- ── locks, in the order this migration's header pins ────────────────────────────────────────────
  perform 1
    from public.reconciliation_batch_rows br
   where br.batch_id = p_batch_id
   order by br.evidence_item_id
   for update;

  -- Cash 1010 at exactly the executor's position: the single point execution and rollback serialize on.
  perform 1
    from public.accounts a
   where a.org_id = v_org
     and a.code = '1010'
   for update;

  perform 1
    from public.reconciliation_action_links al
   where al.batch_id = p_batch_id
   order by al.id
   for update;

  perform 1
    from public.reconciliation_execution_ledger l
   where l.org_id = v_org
     and l.executed_by_batch_row_id in (
       select br.id from public.reconciliation_batch_rows br where br.batch_id = p_batch_id
     )
   order by l.id
   for update;

  perform 1
    from public.expenses e
   where e.org_id = v_org
     and e.id in (
       select al.target_id from public.reconciliation_action_links al
        where al.batch_id = p_batch_id and al.target_table = 'expenses'
     )
   order by e.id
   for update;

  perform 1
    from public.journal_entries je
   where je.org_id = v_org
     and je.source_type = 'expense'
     and je.source_id in (
       select al.target_id from public.reconciliation_action_links al
        where al.batch_id = p_batch_id and al.target_table = 'expenses'
     )
   order by je.id
   for update;

  perform 1
    from public.journal_lines jl
   where jl.org_id = v_org
     and jl.journal_entry_id in (
       select je.id from public.journal_entries je
        where je.org_id = v_org
          and je.source_type = 'expense'
          and je.source_id in (
            select al.target_id from public.reconciliation_action_links al
             where al.batch_id = p_batch_id and al.target_table = 'expenses'
          )
     )
   order by jl.id
   for update;

  perform 1
    from public.sales s
   where s.org_id = v_org
     and s.id in (
       select al.target_id from public.reconciliation_action_links al
        where al.batch_id = p_batch_id and al.target_table = 'sales'
     )
   order by s.id
   for update;

  perform 1
    from public.journal_entries je
   where je.org_id = v_org
     and je.source_type = 'sale'
     and je.source_id in (
       select al.target_id from public.reconciliation_action_links al
        where al.batch_id = p_batch_id and al.target_table = 'sales'
     )
   order by je.id
   for update;

  perform 1
    from public.journal_lines jl
   where jl.org_id = v_org
     and jl.journal_entry_id in (
       select je.id from public.journal_entries je
        where je.org_id = v_org
          and je.source_type = 'sale'
          and je.source_id in (
            select al.target_id from public.reconciliation_action_links al
             where al.batch_id = p_batch_id and al.target_table = 'sales'
          )
     )
   order by jl.id
   for update;

  -- ── execution-evidence preflight (§4b) ──────────────────────────────────────────────────────────
  -- Runs under the full lock ladder above and BEFORE the batch status moves, before a single journal
  -- is reversed and before a single ledger claim is released: the action links must be provably the
  -- complete, exact record of what this batch executed, in both directions. Anything else aborts the
  -- transaction here, leaving the batch `executed`, the ledger `executed`, and every journal and domain
  -- row exactly as the execution left them.
  perform private.fn_reconciliation_rollback_assert_action_bundle(v_org, p_batch_id);

  -- ── org-wide before-state, so the postflight can prove the exact shape of the change ────────────
  select count(*)::integer, coalesce(sum(e.total), 0)
    into v_expenses_count, v_expenses_total
    from public.expenses e
   where e.org_id = v_org;

  select count(*)::integer, coalesce(sum(coalesce(s.total, 0)), 0)
    into v_sales_count, v_sales_total
    from public.sales s
   where s.org_id = v_org;

  select count(*)::integer
    into v_posted_journal_count
    from public.journal_entries je
   where je.org_id = v_org
     and je.status = 'posted';

  -- The terminal status is written FIRST, because the two lifecycle guards read it as the proof that
  -- a rollback is genuinely under way. It is not a claim a caller can forge: reconciliation_batches
  -- carries no client write grant, and this whole function is owner-gated above. If anything below
  -- fails, this write disappears with the aborted transaction and the batch stays `executed`.
  update public.reconciliation_batches
     set status = 'rolled_back'
   where id = p_batch_id;

  -- ── pass 1: reverse every posting this batch CREATED ────────────────────────────────────────────
  for v_link in
    select al.id, al.action_kind, al.target_table, al.target_id,
           al.journal_entry_id, al.batch_row_id
      from public.reconciliation_action_links al
     where al.batch_id = p_batch_id
       and al.action_kind in ('addition', 'correction_replacement')
     order by al.id
  loop
    -- Re-prove the link still names this row's own posted journal before reversing anything.
    select je.entry_date
      into v_entry_date
      from public.journal_entries je
     where je.id = v_link.journal_entry_id
       and je.org_id = v_org
       and je.status = 'posted'
       and je.source_type = case v_link.target_table when 'expenses' then 'expense' else 'sale' end
       and je.source_id = v_link.target_id
     for update;
    if v_entry_date is null then
      raise exception 'reconciliation rollback target journal is not the posted entry the batch created'
        using errcode = '23514';
    end if;

    -- Reversed ON ITS OWN ENTRY DATE, so the undo lands in the very period the posting landed in and
    -- no reporting period is left net-changed. private.fn_reverse_journal_entry_internal refuses a
    -- locked period on EITHER side, which is precisely the guarantee wanted here. The PRIVATE helper
    -- is the only usable route: 20260726160000 §7 makes the public RPC fail closed on exactly this
    -- journal, because its domain row is `historical_treasury` right now.
    v_reversal_entry := private.fn_reverse_journal_entry_internal(
      p_entry => v_link.journal_entry_id,
      p_reason => v_reason,
      p_reversal_date => v_entry_date,
      p_reconciliation_context => true
    );

    if not exists (
      select 1
        from public.journal_entries reversal
        join public.journal_entries created
          on created.id = reversal.reversal_of
       where reversal.id = v_reversal_entry
         and reversal.org_id = v_org
         and created.id = v_link.journal_entry_id
         and created.status = 'reversed'
    ) then
      raise exception 'reconciliation rollback reversal is not linked to the entry it reverses'
        using errcode = '23514';
    end if;

    -- Exact-inverse proof, in both directions, over every typed dimension. Line DESCRIPTIONS are
    -- excluded because the reversal helper deliberately rewrites them ('عكس: …'); every column that
    -- carries money or meaning is compared.
    if exists (
      (
        select account_id, credit, debit, cost_center_id, custody_account_id,
               custody_movement_id, expense_id, payment_request_id
          from public.journal_lines
         where journal_entry_id = v_link.journal_entry_id
        except all
        select account_id, debit, credit, cost_center_id, custody_account_id,
               custody_movement_id, expense_id, payment_request_id
          from public.journal_lines
         where journal_entry_id = v_reversal_entry
      )
      union all
      (
        select account_id, debit, credit, cost_center_id, custody_account_id,
               custody_movement_id, expense_id, payment_request_id
          from public.journal_lines
         where journal_entry_id = v_reversal_entry
        except all
        select account_id, credit, debit, cost_center_id, custody_account_id,
               custody_movement_id, expense_id, payment_request_id
          from public.journal_lines
         where journal_entry_id = v_link.journal_entry_id
      )
    ) then
      raise exception 'rollback reversal is not the exact inverse of the entry it reverses'
        using errcode = '23514';
    end if;

    -- Two single-column UPDATEs, on purpose: neither lifecycle guard's "a historical transition
    -- cannot alter other fields" clause has to be widened to admit a second column.
    if v_link.target_table = 'expenses' then
      update public.expenses
         set payment_status = 'historical_reversed'
       where id = v_link.target_id
         and org_id = v_org
         and payment_status = 'historical_treasury';
      if not found then
        raise exception 'reconciliation rollback target expense is not a posted historical treasury row'
          using errcode = '23514';
      end if;
      update public.expenses
         set reversed_by_rollback_at = v_rolled_back_at
       where id = v_link.target_id
         and org_id = v_org;
    else
      update public.sales
         set payment_status = 'historical_reversed'
       where id = v_link.target_id
         and org_id = v_org
         and payment_status = 'historical_treasury';
      if not found then
        raise exception 'reconciliation rollback target sale is not a posted historical treasury row'
          using errcode = '23514';
      end if;
      update public.sales
         set reversed_by_rollback_at = v_rolled_back_at
       where id = v_link.target_id
         and org_id = v_org;
    end if;

    v_reversed_journals := v_reversed_journals + 1;
  end loop;

  -- ── pass 2: reinstate every production journal this batch REVERSED ──────────────────────────────
  for v_link in
    select al.id, al.action_kind, al.target_table, al.target_id,
           al.journal_entry_id, al.batch_row_id
      from public.reconciliation_action_links al
     where al.batch_id = p_batch_id
       and al.action_kind in ('correction_reversal', 'orphan_reversal')
     order by al.id
  loop
    -- The link names the REVERSAL the execution posted; the entry to reinstate is the one it reversed,
    -- which is exactly the entry the immutable baseline snapshotted.
    select je.reversal_of
      into v_original_entry
      from public.journal_entries je
     where je.id = v_link.journal_entry_id
       and je.org_id = v_org
     for update;
    if v_original_entry is null then
      raise exception 'reconciliation rollback reversal link does not name a reversal entry'
        using errcode = '23514';
    end if;
    if not exists (
      select 1
        from public.journal_entries original
       where original.id = v_original_entry
         and original.org_id = v_org
         and original.status = 'reversed'
         and original.source_type =
             case v_link.target_table when 'expenses' then 'expense' else 'sale' end
         and original.source_id = v_link.target_id
    ) then
      raise exception 'reconciliation rollback cannot reinstate a journal that is not this row''s reversed original'
        using errcode = '23514';
    end if;

    v_reinstated_entry := private.fn_reconciliation_reinstate_baseline_journal(
      v_org, p_batch_id, v_original_entry
    );

    -- Appended BEFORE the status restore: the lifecycle guard's reinstatement proof reads this link.
    insert into public.reconciliation_action_links(
      org_id, batch_id, batch_row_id, action_kind, target_table, target_id,
      journal_entry_id, reinstates_journal_entry_id
    )
    values (
      v_org, p_batch_id, v_link.batch_row_id,
      case v_link.action_kind
        when 'correction_reversal' then 'correction_reversal_reinstatement'
        else 'orphan_reversal_reinstatement'
      end,
      v_link.target_table, v_link.target_id, v_reinstated_entry, v_original_entry
    );

    -- `reversed_by_rollback_at` is deliberately NOT stamped on a reinstated row: that column records
    -- "this row's journal was reversed BY a rollback" (20260726090000), and this row's journal was
    -- reinstated by one. Stamping it would assert the opposite of what happened.
    if v_link.target_table = 'expenses' then
      update public.expenses
         set payment_status = 'historical_treasury'
       where id = v_link.target_id
         and org_id = v_org
         and payment_status = 'historical_reversed';
      if not found then
        raise exception 'reconciliation rollback original expense is not a reversed historical row'
          using errcode = '23514';
      end if;
    else
      update public.sales
         set payment_status = 'historical_treasury'
       where id = v_link.target_id
         and org_id = v_org
         and payment_status = 'historical_reversed';
      if not found then
        raise exception 'reconciliation rollback original sale is not a reversed historical row'
          using errcode = '23514';
      end if;
    end if;

    v_reinstated_journals := v_reinstated_journals + 1;
  end loop;

  -- A zero_value_noop moved no money, so it has nothing to undo — but its ledger row still transitions
  -- below, exactly like every other row's, so the evidence item is released either way.
  select count(*)::integer
    into v_zero_value_rows
    from public.reconciliation_action_links al
   where al.batch_id = p_batch_id
     and al.action_kind = 'zero_value_noop';

  -- ── ledger: executed -> reversed, for the rows THIS batch executed and no others ────────────────
  -- A row this batch SKIPPED was claimed by a different batch, so its ledger row names that batch's
  -- row and must stay `executed` — rolling it back here would silently release another batch's claim.
  with reversed_rows as (
    update public.reconciliation_execution_ledger l
       set status = 'reversed',
           reversed_at = v_rolled_back_at
     where l.org_id = v_org
       and l.status = 'executed'
       and l.executed_by_batch_row_id in (
         select br.id from public.reconciliation_batch_rows br where br.batch_id = p_batch_id
       )
    returning 1
  )
  select count(*)::integer into v_ledger_reversed from reversed_rows;

  -- ── batch rows: `posted` is no longer true, and `reversed` is the accepted value that is ─────────
  -- A row that already reads `reversed` (a correction) or `skipped` (a zero-value no-op or a
  -- previously-claimed evidence item) is already truthful and is left alone. The frozen-row guard
  -- (20260726083000) permits exactly this column, so nothing is weakened to write it.
  with marked_rows as (
    update public.reconciliation_batch_rows br
       set execution_result = 'reversed'
     where br.batch_id = p_batch_id
       and br.execution_result = 'posted'
    returning 1
  )
  select count(*)::integer into v_rows_marked from marked_rows;

  -- ── postflight: prove the undo, do not assume it ────────────────────────────────────────────────
  if exists (
    select 1
      from public.reconciliation_action_links al
      join public.journal_entries je on je.id = al.journal_entry_id
     where al.batch_id = p_batch_id
       and al.action_kind in ('addition', 'correction_replacement')
       and je.status <> 'reversed'
  ) then
    raise exception 'rollback postflight: a created reconciliation journal is still posted'
      using errcode = '23514';
  end if;

  if exists (
    select 1
      from public.reconciliation_action_links reversal_link
     where reversal_link.batch_id = p_batch_id
       and reversal_link.action_kind in ('correction_reversal', 'orphan_reversal')
       and (
         select count(*)
           from public.reconciliation_action_links reinstatement
           join public.journal_entries reinstated
             on reinstated.id = reinstatement.journal_entry_id
            and reinstated.status = 'posted'
          where reinstatement.batch_id = reversal_link.batch_id
            and reinstatement.target_table = reversal_link.target_table
            and reinstatement.target_id = reversal_link.target_id
            and reinstatement.action_kind in (
              'correction_reversal_reinstatement', 'orphan_reversal_reinstatement'
            )
       ) <> 1
  ) then
    raise exception 'rollback postflight: a reversed production journal was not reinstated exactly once'
      using errcode = '23514';
  end if;

  if exists (
    select 1
      from public.reconciliation_execution_ledger l
     where l.status = 'executed'
       and l.executed_by_batch_row_id in (
         select br.id from public.reconciliation_batch_rows br where br.batch_id = p_batch_id
       )
  ) then
    raise exception 'rollback postflight: an execution ledger row is still executed'
      using errcode = '23514';
  end if;

  if exists (
    select 1
      from public.reconciliation_batch_rows br
     where br.batch_id = p_batch_id
       and br.execution_result = 'posted'
  ) then
    raise exception 'rollback postflight: a batch row still reports a posted execution result'
      using errcode = '23514';
  end if;

  -- A rollback creates and destroys NO domain row: expense/sale counts and totals must be untouched.
  if (select count(*) from public.expenses e where e.org_id = v_org)
       is distinct from v_expenses_count
    or round((
         select coalesce(sum(e.total), 0) from public.expenses e where e.org_id = v_org
       ), 2) is distinct from round(v_expenses_total, 2)
    or (select count(*) from public.sales s where s.org_id = v_org)
       is distinct from v_sales_count
    or round((
         select coalesce(sum(coalesce(s.total, 0)), 0) from public.sales s where s.org_id = v_org
       ), 2) is distinct from round(v_sales_total, 2)
  then
    raise exception 'rollback postflight: organization domain totals changed during rollback'
      using errcode = '23514';
  end if;

  -- Posted-journal arithmetic: every reversal takes one out of the posted ledger (the reversing entry
  -- itself is written `reversed`), every reinstatement puts one back.
  if (
    select count(*)
      from public.journal_entries je
     where je.org_id = v_org
       and je.status = 'posted'
  ) is distinct from
     v_posted_journal_count - v_reversed_journals + v_reinstated_journals
  then
    raise exception 'rollback postflight: posted journal count does not match the rollback arithmetic'
      using errcode = '23514';
  end if;

  -- Every journal this batch now touches must balance, reinstatements and reversals alike.
  if exists (
    select 1
      from public.reconciliation_action_links al
      join public.journal_lines jl on jl.journal_entry_id = al.journal_entry_id
     where al.batch_id = p_batch_id
     group by al.journal_entry_id
    having round(sum(jl.debit), 2) is distinct from round(sum(jl.credit), 2)
  ) then
    raise exception 'rollback postflight: a batch journal is unbalanced' using errcode = '23514';
  end if;

  -- Domain lifecycle: every created row is reversed and stamped; every reinstated row is restored.
  if exists (
    select 1
      from public.reconciliation_action_links al
      join public.expenses e on e.id = al.target_id and e.org_id = al.org_id
     where al.batch_id = p_batch_id
       and al.target_table = 'expenses'
       and al.action_kind in ('addition', 'correction_replacement')
       and (e.payment_status is distinct from 'historical_reversed'
            or e.reversed_by_rollback_at is null)
  ) or exists (
    select 1
      from public.reconciliation_action_links al
      join public.sales s on s.id = al.target_id and s.org_id = al.org_id
     where al.batch_id = p_batch_id
       and al.target_table = 'sales'
       and al.action_kind in ('addition', 'correction_replacement')
       and (s.payment_status is distinct from 'historical_reversed'
            or s.reversed_by_rollback_at is null)
  ) or exists (
    select 1
      from public.reconciliation_action_links al
      join public.expenses e on e.id = al.target_id and e.org_id = al.org_id
     where al.batch_id = p_batch_id
       and al.target_table = 'expenses'
       and al.action_kind in (
         'correction_reversal_reinstatement', 'orphan_reversal_reinstatement'
       )
       and e.payment_status is distinct from 'historical_treasury'
  ) or exists (
    select 1
      from public.reconciliation_action_links al
      join public.sales s on s.id = al.target_id and s.org_id = al.org_id
     where al.batch_id = p_batch_id
       and al.target_table = 'sales'
       and al.action_kind in (
         'correction_reversal_reinstatement', 'orphan_reversal_reinstatement'
       )
       and s.payment_status is distinct from 'historical_treasury'
  ) then
    raise exception 'rollback postflight: a reconciliation domain row is in the wrong lifecycle state'
      using errcode = '23514';
  end if;

  -- Counts and the owner's own reason only — never a row-level private value (§2.7 redaction).
  update public.reconciliation_batches
     set result_summary = jsonb_build_object(
           'rolled_back_at', v_rolled_back_at,
           'rollback_reason', v_reason,
           'reversed_journals', v_reversed_journals,
           'reinstated_journals', v_reinstated_journals,
           'zero_value_rows', v_zero_value_rows,
           'ledger_rows_reversed', v_ledger_reversed,
           'rows_marked_reversed', v_rows_marked
         )
   where id = p_batch_id;

  return jsonb_build_object(
    'batch_id', p_batch_id,
    'status', 'rolled_back',
    'reversed_journals', v_reversed_journals,
    'reinstated_journals', v_reinstated_journals,
    'zero_value_rows', v_zero_value_rows,
    'ledger_rows_reversed', v_ledger_reversed,
    'rows_marked_reversed', v_rows_marked
  );
end;
$$;

revoke execute on function public.fn_rollback_reconciliation_batch(uuid, text)
  from public, anon;
grant execute on function public.fn_rollback_reconciliation_batch(uuid, text)
  to authenticated;

comment on function public.fn_rollback_reconciliation_batch(uuid, text) is
  'Owner-only, whole-batch atomic rollback of an executed reconciliation batch: reverses every '
  'posting the batch created and reinstates every production journal it reversed, exactly, from the '
  'immutable baseline snapshot. Append-only — no DELETEs. Requires a mandatory reason.';

commit;
