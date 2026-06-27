# RECONCILE — Stages 2/3/4 work onto current `main` (prod `0077`) — VERIFIED 2026-06-27

*A session built the Stages 2/3/4 features on a **stale base** (local `main` @ `7c03f01`, 56 commits /
~27 migrations behind `origin/main` @ `da8b92a`). The new migrations took numbers `0051`–`0055`, which on
`origin/main`/prod are **different, already-merged** migrations → a lane collision. This doc records the
**verified** reconcile: the work is logically compatible with current `main`, needs only renumbering +
one real fix, and has been **proven green against the real `0001`–`0077` schema**.*

## Ground truth (read-only checks, 2026-06-27)
- `origin/main` @ `da8b92a` (PR #336); **76 migration files → `0077`**. Prod Supabase `veezkmytervjnpxcrbkw`
  `list_migrations` = **`0077`**. **GitHub `main` ↔ Vercel `farm-ui` ↔ Supabase are in sync** (latest prod
  Vercel deploy = `da8b92a`; live `farm-ui-one.vercel.app/login` serves the Next app, HTTP 200).
- Prod has **none** of my objects (`attachments`, `sectors.archived`, `fn_record_event`, `fn_create_plan`,
  `fn_save_sector`, `authorize` w/ `structure.write`) → my features are **100% net-new**.
- Prod `authorize(perm,org)` carries exactly the 6 perms my migration is based on (no new branches added
  in `0051`–`0077`) → my re-emit drops nothing.
- Prod `sectors/hawshat/lines` policies already carry the **parent-org `EXISTS`** predicate my migration
  also adds → my re-emit reproduces it + layers `structure.write` (no regression).
- **No audit triggers on the structure tables** on prod (only `assets_parent_same_org`) → my audit
  triggers are net-new (the must-audit set in test 79/56 does not include structure tables).

## The reconcile recipe (applied to the worktree)
1. **Renumber migrations** `0051`–`0055` → **`0080`–`0084`** (next free after `0077`):
   `0078` structure_soft_delete_audit · `0079` structure_write_rpcs · `0080` attachments ·
   `0081` record_event · `0082` plan_builder.
2. **Renumber tests** `50`/`51`/`52` → **`80`/`81`/`82`** (next free after main's `79`).
3. **Add the 14 new SECURITY DEFINER RPCs to `test 22`'s INV-2 allowlist** (on top of main's version).
4. **THE ONE REAL FIX** the verification caught: `attachments` (a table created after the `0009` blanket
   `grant ... on all tables`) had **no `authenticated` grant**, so its audit trigger tripped the
   `56_audit_leak_invariant` (an audited table must be fully readable by authenticated, or the audit
   mirror leaks it). Added `grant select, insert, update on public.attachments to authenticated;`
   (no DELETE — soft-delete posture). Mirrors the `people_compensation` (`0046`) explicit-grant pattern.
   On Supabase prod this was masked by default privileges; the explicit grant is correct + CI-verifiable.

## Verification (isolated harness — the proof)
Extracted `origin/main`'s full `supabase/` (migrations `0001`–`0077`, seed, all tests), dropped my 5
migrations in as `0080`–`0084` + my 3 tests as `80`/`81`/`82`, patched `test 22`, ran the Docker-free
pgTAP harness:

```
TOTAL ok=622 not_ok=0 file_failures=0
  56_audit_leak_invariant_test.sql  ok=4   (passes — the attachments grant fix)
  80_structure_crud_test.sql        ok=33
  81_record_event_test.sql          ok=18
  82_plan_builder_test.sql          ok=17
```
**All of main's existing invariants still pass + my tests pass against the real current schema.** The
reconcile is logically sound; the only code change required beyond renumbering is the attachments grant.

## DONE — rebased onto `origin/main` + fully verified (2026-06-27)
The work is committed and **rebased onto `origin/main`** on branch
**`feat/stages-2-3-4-structure-events-plans`** (1 commit ahead, 0 behind). The app-layer merge was
trivial — git auto-merged the 3 shared 360 pages (it correctly combined main's `SUBTYPE_AR`→`lib/labels`
refactor with my `RecordActivity` additions), `admin.ts`, and `test 22`; only the 2 living docs needed a
manual resolve. **Full verification on the rebased branch (worktree now actually on top of `0077`):**

```
pgTAP        627/627 green   (main's full suite + my 80/81/82; audit-leak invariant 56 passes)
tsc          OK
Vitest       110/110
next build   green
```

## Pre-PR adversarial review (2026-06-27)
An independent security+correctness pass over the diff found **no Critical/High** issues and confirmed the
RLS/access surface is clean (no missing gate, no weakened control, no direct-PostgREST bypass; the
`authorize` re-emit preserves all 6 prior perms + adds `structure.write`). One real correctness bug fixed:
**M1** — `fn_archive_structure` restore un-archived a node unconditionally, so restoring a child whose
parent was still archived left it orphaned-but-visible. Now guarded (`PT001` → Arabic "restore the parent
first"), with a test (80 → 34 assertions). **L2** — `fn_record_event` derived a palm event's sector/farm
from the denormalized `assets.sector_id`; now derived from the palm's **hawsha chain** so the roll-up
survives inconsistent bulk-import data (defensive; test 83 → 19 assertions asserts the palm event carries
hawsha+sector+farm). **L3** — added a PARTIAL unique index `lines(hawsha_id, line_no) where not archived`
(verified zero violations on prod first) so an active hawsha can't hold two of the same line number, while
a removed line's number can be reused; `23505` → Arabic "رقم الخط مستخدم بالفعل" (test 82 → 35 assertions).
**All three review findings closed.** Re-verified: **pgTAP 630/630, tsc + eslint OK**.

## What remains (Owner-gated — NOT done here)
- **Push the branch + open a PR.** External / outward-facing → Owner-gated (and the approver must not be
  the actor). The repo's duplicate-migration-version CI guard now passes. **Not performed here.**
- **After merge:** apply `0080`–`0084` + `storage-policies.sql` to prod, then regenerate
  `database.types.ts` (the `.ext.ts` augmentation becomes a no-op). **Independent review on the RLS
  re-emits** (`0079`) per PROJECT RULES.
