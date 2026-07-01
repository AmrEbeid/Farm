# RUNBOOK — production hardening: backups/restore, monitoring, staging, load sanity (2026-07)

*Closes the Stage-P control gaps flagged in `REVIEW-360-2026-07-01.md` §4. Every EXECUTE step here is Owner-gated (touches prod/infra); this doc makes each one a 30–90-minute checklist instead of a project. Owner: Amr Ebeid.*

## 1. Backup verification + restore drill (do FIRST — before real data, not after)

**Verify (read-only, 10 min):**
1. Supabase dashboard → project `veezkmytervjnpxcrbkw` → Database → Backups: confirm plan tier, daily backup presence, and whether **PITR** is enabled (PITR is a paid add-on; on the free/Pro-default you get daily physical backups only). Record: last backup timestamp, retention days.
2. Decide the target: **RPO** (max acceptable data loss — recommend ≤24h now, ≤5min via PITR before real financial data) and **RTO** (max downtime — recommend ≤4h).

**The drill (60–90 min, quarterly + before Stage-M):**
1. Create a THROWAWAY Supabase project (or use a branch if available on plan).
2. Restore the latest backup into it (dashboard restore-to-new-project path; if only downloadable dumps: `pg_restore` locally into PG17).
3. Acceptance probes against the restored copy: `select count(*) from public.assets` (=palm count), `select count(*) from supabase_migrations.schema_migrations` (=migration count), `select count(*) from public.journal_entries`, one RLS smoke (anon denied), one RPC smoke (`fn_stock_coverage` on a seeded item).
4. Record in this file's log (below): date, backup used, restore duration, probe results, gaps.
5. Delete the throwaway project.

**Failure modes to check explicitly:** storage bucket (`farm-media`) is NOT in DB backups — attachments need their own story (Supabase Storage backups / periodic `rclone` copy — decide); Auth users ARE in the DB (verify `auth.users` count in the restored copy).

**Drill log:** *(append rows)*
| Date | Backup ts | Restore time | Probes | Gaps found |
|---|---|---|---|---|

## 2. Monitoring & alerting (half a day, Owner applies env/integrations)

Current state: NOTHING beyond Vercel deploy status + Supabase advisors (verified in review). Minimum viable stack:
1. **Error tracking — Sentry** (free tier fine): `@sentry/nextjs` wizard; wrap server actions + the two error boundaries; scrub PII (no wage/phone values in events); DSN via Vercel env. One PR + one env var.
2. **Uptime — external ping** (UptimeRobot/BetterStack free): monitor `https://ebeidfarm.business/` and `/login` (expect 200), alert to Owner email/WhatsApp. 15 min, no code.
3. **DB health — Supabase built-ins**: enable email notifications; weekly `get_advisors` check is already session practice — make it a monthly calendar item.
4. **Alert routing:** all alerts → Owner email now; route into the future pending-actions inbox (BOOM-PLAN P5) later.
5. **What we deliberately skip now:** APM/tracing, log aggregation, PagerDuty — single-tenant pilot doesn't need them.

## 3. Staging path (kills "migrate-first = migrate-prod-first")

Options, in order of preference:
1. **Supabase branching** (if plan supports): preview branch per PR — the CI `Supabase Preview` check exists but is `skipping`; investigate enabling it (requires branching enabled on the project + GitHub integration setting). If enabled: schema PRs validate against a real preview branch before the prod apply.
2. **Fallback (works today, $0):** a second free Supabase project `farm-staging`: apply migrations there first (`supabase db push`), run the 3-probe smoke, THEN prod. Keep seed-only data; never real data.
3. Either way the rule becomes: **migrate STAGING → verify → migrate PROD → merge** (the migrate-first-then-merge order is unchanged, just with a rehearsal).

## 4. Load sanity-check (before + after Stage-M)

Local, no prod involvement:
1. Generate synthetic volume in the local pgTAP-style ephemeral DB: 4,500 assets, 1 season of events (~8–10 events/palm ≈ 40k farm_event + event_assets rows), 5k plan_operations, 10k movements. (Script under `scratch/` — not committed to app code.)
2. Time the known-suspect queries: the unbounded `/m` feed (`plan_operations` full-org scan — F5 in REVIEW-360), the owner dashboard fan-out, `fn_stock_coverage` per item, palm-360 event timeline, PvA JSONB join.
3. Thresholds: any page query >500ms at this volume gets an index/limit PR (candidates already known: `/m` needs status+date window; PvA needs the `farm_event.plan_op_id` FK from LINKAGE-MAP fix #10).
4. Re-run after real-data import (Stage-M acceptance step).

## 5. Order of execution (all Owner-gated)

1. §1 verify + drill (before Stage-M — a restore you've never tested is not a backup).
2. §2 uptime (15 min) + Sentry PR.
3. §3 decision: branching vs `farm-staging` project.
4. §4 local load check (can run any time; repeat post-Stage-M).
