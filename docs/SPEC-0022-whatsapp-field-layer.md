# SPEC-0022 — WhatsApp Field Layer (طبقة واتساب الميدانية)

*Status: DRAFT — Owner review required. Created 2026-07-02 from the 360° review + market research. Build gate: Stage M first; security review REQUIRED before any build (outbound-send capability = lethal-trifecta-adjacent).*

## 1. Problem

Field adoption is the #1 product risk (MASTER-PLAN risk #10). The field reality in Egypt: supervisors and workers live in **WhatsApp**, not in browsers; connectivity is patchy; digital literacy varies. The `/m` surface is good phone-first craft, but it still requires opening an app, logging in, and having signal. Meanwhile the research confirms discovery and daily coordination in Egyptian agriculture already run through WhatsApp.

## 2. The idea

Meet field roles where they are: **WhatsApp Business API as a thin, gated I/O channel** on top of existing RPCs — never a second application.

### Outbound (phase 1 — lowest risk)
- **Task-of-the-day digest** per assignee: morning message listing today's assigned operations (from `plan_operation_assignees`), Arabic, with the same REI/PHI safety notice logic as `/m`.
- **Owner/manager alerts**: shortage alarm from the coverage engine, PR awaiting approval, overdue operations. (Read-only projections of existing data — no new authority.)

### Inbound (phase 2 — gated)
- Reply **"تم ✅"** (or a numbered pick from the digest) → marks the operation executed via the existing idempotent `fn_execute_operation` path, attributed to the linked person.
- **Photo reply** → stored via the existing attachments path onto the operation/palm file.
- Anything unparseable → polite Arabic fallback + it lands in a review queue; never guess.

### Explicit non-goals
No approval-by-WhatsApp for money (PR approval stays in-app behind auth); no free-text agronomy Q&A (that is Stage 11 عبدالجليل, separately gated); no bulk marketing sends.

## 3. Security model (the hard part — this section gates the build)

The lethal trifecta rule (docs/CLAUDE.md): private data + untrusted input + outbound send must never co-locate.

1. **Identity:** `people.phone` (already service-role-scoped since 0048) ↔ WhatsApp sender id, verified once via a nonce the manager hands the worker. Unmatched senders get a static reply; nothing else.
2. **Authority:** inbound actions execute through the SAME `SECURITY DEFINER` RPCs with the linked person's user context (session-minted server-side), so RLS + `authorize()` + idempotency all apply unchanged. The webhook has **no service-role data access**; it holds only: (verified sender → user mapping) + (RPC allowlist: execute-op confirm, attach photo).
3. **Untrusted input isolation:** message text is treated as data, never as instructions; parsing is a strict command grammar (تم / numbers / media), not an LLM, in phase 1–2.
4. **Outbound scoping:** digests/alerts are template messages rendered from RLS-scoped queries per recipient; a per-org daily send cap; kill-switch org setting (`org_settings`).
5. **Audit:** every inbound-triggered mutation carries a `source='whatsapp'` marker in the audit trail.
6. Secrets (WABA token) in Vercel/Supabase env only; webhook signature verification mandatory.

**Independent security review REQUIRED before merge (same tier as Stage 11).**

## 4. Implementation shape

- One Supabase Edge Function (webhook: verify → identify → parse → allowlisted RPC) + one scheduled digest function (cron).
- New tables: `whatsapp_links` (person↔wa_id, verified_at, revoked_at; org-scoped, FORCE RLS), `whatsapp_outbox`/`inbox_log` (append-only, audit-triggered).
- Org settings: enable/disable, digest time, alert rules, send cap.
- Provider: WhatsApp Business Cloud API direct (no third-party BSP holding farm data) — decision for Owner.

## 5. MVP slice + acceptance

Phase 1 only (outbound digest + shortage/approval alerts) for the reference tenant:
- Supervisor with 3 assigned ops receives one Arabic digest at the configured hour; numbers/dates in Arabic-Indic via the same formatting rules.
- A seeded coverage shortage produces exactly one owner alert (no repeats within the window).
- Kill-switch verified: toggling off stops sends within one cycle.
- Evidence: message logs + audit rows; no PII beyond the recipient's own scope in any message.

Phase 2 (inbound تم/photo) is a separate task behind its own security review.

## 6. Risks

| Risk | Mitigation |
|---|---|
| Outbound send + private data co-location | Read-only template projections, per-recipient RLS scope, send cap, kill-switch |
| Spoofed sender executes ops | Verified link nonce + webhook signature + RPC-layer authz anyway |
| WhatsApp policy/template rejection | Use approved template categories (utility); digest = utility not marketing |
| Channel becomes shadow-app scope creep | Hard non-goals list above; anything new = new spec |
