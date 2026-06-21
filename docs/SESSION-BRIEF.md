# Session Brief — Farm OS      Updated: 2026-06-18 by Claude (Owner: Amr Ebeid)
*Updated LAST, after meaningful work.*

## Where we are
Deep research (4 cited streams) + three HTML prototypes done; white-space confirmed. Governed under the **AI Project Operating System v3** (CLAUDE.md / TRACKER / this brief / SPEC-0001 / MASTER-PLAN). After a GPT review we closed the implementation/validation/commercial gaps with five build specs (**06 MVP-0 Build Spec**, **07 Screen Map**, **08 User Stories**, **09 Acceptance Tests**, **10 Operations & Readiness**). The **design system is real and live**: `farm-os-ui` (React+TS+tsup+Storybook, 9 components) is built, verified, and **synced to Claude Design** ("Farm OS UI", projectId `115ae675-68f4-438b-8d03-6e83752aace3`). The Farm OS **application** (Next.js+Supabase) is still unbuilt — Stage 0 → MVP-0 is the next build.

## Approved to do next (the next safe slice)
**Nothing is approved for execution yet.** The next action is an **Owner decision**, not a build:
1. Owner approves **Stage 0 — Security remediation & data cleanup** (Critical/High), OR
2. Owner first wants the **5-farm interviews / pricing validation** (Phase 0 close).

When Stage 0 is approved, its ready-to-paste execution prompt is in `MASTER-PLAN.md` §7.

## NOT approved yet (a session must not start these)
- Any **production deploy**, **DB migration**, **key rotation/history rewrite** without explicit Owner go-ahead (these are Critical/High).
- **Migrating real Ebeid financial/PII data** into any environment or model before a privacy review.
- **Building Stage 1+ code** before Stage 0 (security/data) is closed.
- Turning **research findings directly into build** — each must pass through a SPEC first (market-led control).

## Active stage
**Stage 0 — Security remediation & data cleanup** (proposed; awaiting Owner approval). Spec: see MASTER-PLAN.md §4 Stage 0 + §7 prompt.

## Reconcile-first notes (what the next session must check)
- Re-read `CLAUDE.md` and this brief before acting. Do **not** act on any earlier conversational plan that the Owner has since changed.
- Confirm the **canonical palm count = 4,380 برحي / 299 ذكور / 28 حوش** (Nov-2025 registry) is still the agreed source.
- Confirm whether the **exposed secret** (Gmail/password in the accounting sheet; anon key + project id in the old repo) has already been rotated/purged — if unsure, treat as still exposed.

## Last evidence
- Docs: `farm-os-docs/01–05` + `README`, `CLAUDE.md`, `PROJECT-TRACKER.md`, `SPEC-0001`, `MASTER-PLAN.md`.
- Designs: `ebeid-farm-os-demo.html` (real-data walkthrough), `farm-os-prototype.html` (interactive core-loop + live stock-coverage sim).
- Source data verified: palm registry (docx), offshoot jard (pdf), 7-yr accounting (xlsx).
- **No checks/tests run yet** — there is no code. Verification stack begins at Stage 1.
