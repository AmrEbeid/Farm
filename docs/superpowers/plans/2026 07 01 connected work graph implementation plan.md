# Connected Work Graph Implementation Plan

Date: 2026-07-01

## Current status

The repo already has the data spine, but it is not presented as one system:

- 360 pages: structure/media/activity only.
- Planning: assignee join table exists, but dashboards still read responsible_person_id.
- Field execution: fn_record_event rolls up correctly; fn_execute_operation needs target-type-aware rollup.
- Finance/accounting: custody and cash accounting are live, but finance dashboard is not accountant-action oriented.

## Plan

### Step 1: Shared context helper

Create a reusable server helper under `apps/farm-os/lib/linked-work-context.ts`.

It should return:

- entity identity and descendants;
- matching plans;
- matching plan operations;
- plan operation assignees;
- matching events;
- matching expenses;
- related custody/payment/accounting rows for finance roles.

### Step 2: Entity 360 pages

Update:

- `apps/farm-os/app/(app)/farm/sector/[id]/page.tsx`
- `apps/farm-os/app/(app)/farm/hawsha/[id]/page.tsx`
- `apps/farm-os/app/(app)/farm/line/[id]/page.tsx`
- `apps/farm-os/app/(app)/farm/palm/[id]/page.tsx`
- `apps/farm-os/components/PalmFile.tsx`

Add tabs/sections:

- plans;
- tasks;
- finance;
- report.

### Step 3: Assignment dashboards

Update:

- `apps/farm-os/app/(app)/people/dashboard/page.tsx`
- `apps/farm-os/app/(app)/people/[personId]/page.tsx`
- `apps/farm-os/app/(app)/m/page.tsx`
- `apps/farm-os/components/OperationBuilder.tsx`
- `apps/farm-os/app/(app)/plans/[planId]/actions.ts`

Use `plan_operation_assignees` as the canonical assignment table and require at least one assignee when adding a new multi-operation.

### Step 4: Accountant dashboard

Update `apps/farm-os/app/(app)/finance/dashboard/page.tsx` to show accountant-focused queues:

- custody balance and target float;
- near-due payment requests;
- unpaid post-paid expenses;
- recent accounting entries;
- links to custody, accounting, payment requests, and expenses.

### Step 5: Execution rollup migration

Create one migration only after app-side work is reviewed:

- re-emit `fn_execute_operation`;
- resolve target type into farm/sector/hawsha/line/palm;
- insert full event_locations ancestor chain;
- insert event_assets for palm target;
- add tests.

### Step 6: Validation

Run:

- typecheck;
- lint;
- focused unit tests;
- pgTAP for any migration slice;
- protected-route smoke for changed pages if a server is available.

## Review gates

- UI/query slice: code review before merge.
- Migration slice: independent money/RLS/engine review before production apply.
- Live deployment: verify Vercel route protection and production migration ledger before marking live.
