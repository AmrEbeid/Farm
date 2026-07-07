-- Farm OS — make the ledger mirror the source sheet exactly (Owner-directed).
--
-- CONTEXT. After the history GL backfill (20260707115445), a sheet-vs-system reconciliation showed the system
--   held 31 expense rows NOT present in the source workbook (`شيت محاسبي للمزارع`, a Feb-2026 snapshot):
--     • 29 rows = إذن صرف ٦ (June 2026 disbursement permit) totalling 289,000
--     • 2 rows  = post-cutover live entries (كاش 30,000 on 2026-07-23, اجل 12,000 on 2026-07-01)
--   The Owner directed that "the sheet should be the only data we have", so these 31 rows (and the journal
--   entries the backfill posted for them) are removed. After this, expenses = 20,527,757 and revenue =
--   25,835,533, tying to the sheet to the pound, and every category matches exactly.
--
-- REVERSIBLE. Every removed row (expenses + journal_entries + journal_lines) is copied into schema `_recovery`
--   BEFORE deletion. To restore إذن-6 / the live entries later:
--     insert into public.expenses        select * from _recovery.removed_expenses_20260707;
--     insert into public.journal_entries  select * from _recovery.removed_journal_entries_20260707;
--     insert into public.journal_lines    select * from _recovery.removed_journal_lines_20260707;
--
-- SECURITY. Data-only. The `_recovery` schema is not exposed (no grants to authenticated/anon; PostgREST only
--   serves the `public` schema). No schema/permission change to application tables. Deleting a journal_entry
--   cascades to its lines (FK on delete cascade); the deferred balance guard passes (entry has 0 lines at commit).
--
-- IDEMPOTENT. Deletion is pinned to the explicit 31 ids; re-running removes nothing more (ids already gone) and
--   the `create table if not exists` backup is preserved from the first run.

begin;

create schema if not exists _recovery;

create table if not exists _recovery.removed_expenses_20260707 as
  select * from public.expenses where id in (
    '0319e073-7cb3-4de4-9f56-6b4ec12f17a2','2fca2f99-591c-4f74-b88c-e0f9b5f001d2',
    '5c0a6ceb-3326-4766-b646-4cc1b20ca697','e64bf55f-6f27-441c-829b-ac2b47dff589',
    '84ea91e4-3bf0-414b-b47f-cbb1e302bdee','6026d7a9-780c-4f4c-baf9-0ced5d915424',
    '7282fdd9-ba6f-4740-a5a4-0ab233a52682','fa5d0b95-9f1f-4552-abca-f65e059daf27',
    '697d3ae2-5533-4019-8f33-11e6d42b5079','7dd4dd94-8cf7-4246-9326-83c88dc7c01c',
    'aa5e5f48-101a-4390-9766-8836f75e62f9','f6bf33cb-5ca5-4310-aaf6-ebf5fdafdb98',
    'a80765db-cea9-4939-9ba1-1c5ebb6175eb','51163425-10a9-40fc-982d-bf93e3246b8a',
    '51558b28-ef4f-47d8-8675-d2108d58bac1','a3ed9ca1-197b-4968-ad5a-f3dae19c7102',
    '70b3db56-f32c-40aa-8c71-dd540de39517','43e792ab-9eb7-48d2-9165-519c8c2a9db7',
    '90812c33-55c6-475c-8229-30f198917bf6','b301d2e0-0aea-4ea3-a0d8-efdd0db6c87f',
    'b2a17c96-9424-4aa8-9a2e-03c12693480a','8b11d462-494b-4f31-b597-0c709996497f',
    '3b8a8194-7a2f-4857-a089-c13e78cfdd3f','28d099bd-291e-492e-ac5e-672854283b22',
    '19ac8ce4-419c-47cb-a320-5a8c897de677','229ed115-bad4-44fe-b39b-06999f9f4997',
    '55cb1760-4b32-4516-a601-e1db1f99cd71','7eeecc1e-e946-4b49-af24-23fbd36f0be7',
    'ea08e92c-5878-40d1-9c22-8c2466c0f9aa','3c7ea42e-4272-4fc6-952b-718a6ebce858',
    'c1f68ef3-074b-4e67-953c-4083f9e74a5e');

create table if not exists _recovery.removed_journal_entries_20260707 as
  select je.* from public.journal_entries je
   where je.source_type='expense'
     and je.source_id in (select id from _recovery.removed_expenses_20260707);

create table if not exists _recovery.removed_journal_lines_20260707 as
  select jl.* from public.journal_lines jl
   where jl.journal_entry_id in (select id from _recovery.removed_journal_entries_20260707);

delete from public.journal_entries
 where source_type='expense'
   and source_id in (select id from _recovery.removed_expenses_20260707);

delete from public.expenses
 where id in (select id from _recovery.removed_expenses_20260707);

do $$
declare v_bak int; v_left int;
begin
  select count(*) into v_bak from _recovery.removed_expenses_20260707;
  select count(*) into v_left from public.expenses e
    where e.id in (select id from _recovery.removed_expenses_20260707);
  -- Completeness invariant (always valid): whatever was backed up must be gone. NOT a hard "= 31" check —
  -- on prod v_bak is 31, but on a clean-DB replay (CI pgTAP / fresh env) the 31 prod ids don't exist so
  -- v_bak = 0 and this migration is a safe no-op. A hard "= 31" would fail every clean replay.
  if v_left <> 0 then raise exception 'deletion incomplete: % of % backed-up rows remain', v_left, v_bak; end if;
  raise notice 'remove_non_sheet_expenses: backed up and removed % rows (0 on a fresh DB — prod ids absent)', v_bak;
end $$;

commit;
