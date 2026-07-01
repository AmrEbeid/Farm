# SUPPORT + BILLING MODEL — the boring wrapper, decided simply (2026-07)

*Two small operating decisions that block farm #2 if left undesigned. Deliberately manual-first — no billing infra, no ticketing system, until ≥5 farms. Owner: Amr Ebeid.*

## A. Support model (pilot → 5 farms)

**Channel:** one WhatsApp Business number = "the support line" (NOT the founder's personal number — separable, transferable later). Field users already live there; voice notes accepted (literacy). In-app: the existing Help Drawer/page-help stays the self-serve layer; add the support number to it (one-line PR).

**Tiers & response targets (set expectations in the ToS, keep them modest):**
| Severity | Example | Target |
|---|---|---|
| S1 — can't work | login broken, app down, data loss suspected | same day |
| S2 — blocked flow | can't receive stock, approval stuck | next business day |
| S3 — question/how-to | "how do I record a drawing?" | 48h |
- Uptime alerts (RUNBOOK-ops-hardening §2) page the founder before customers do.

**The 6am reality:** the manager's dawn-dispatch window is 5–7am. Rule: S1 acknowledged whenever seen; everything else queued to a fixed daily support half-hour (protect founder time). The trained **farm clerk is tier-0** — the hand-off (ONBOARDING-PLAYBOOK Phase 5) is the support-load control.

**Loop into product:** every S2/S3 gets one line in a support log (date, farm, role, question, root cause). ≥3 repeats of the same question = a page-help fix or a UX PR, not a better answer. The support log feeds the ideas backlog triage.

**Escalation for data corrections:** support NEVER edits farm data silently — corrections happen with the clerk on a call, through the app's own gated paths (and expose missing correction flows, e.g. the known no-reversal gap).

## B. Billing model (manual-first)

**Mechanics now (0–5 farms):** manual Arabic invoice (the accountant's own template; ETA-compliant once the determination lands), bank transfer / InstaPay. Subscription tracked in one sheet: farm, tier, fee, setup fee, deposit date, go-live, renewal date, status. **No payment gateway, no self-serve checkout** — the buyer count doesn't justify it and the sales motion is white-glove anyway.

**Terms (from BOOM-PLAN §4, restated operationally):**
- Setup fee: invoiced 50% at contract, 50% at go-live. Repriced every season.
- Subscription: annual, invoiced at go-live; **harvest-aligned option** = 30% deposit at go-live + 70% within 30 days of harvest end (define "harvest end" per farm in the contract).
- Renewal: invoiced with the season ledger attached (the value evidence), 30 days before anniversary.
- Late/棄: 30-day grace, then read-only mode (never delete; the data-export pledge holds regardless — export works even for lapsed accounts).
- Price protection: none beyond the paid year (annual repricing clause; EGP reality).

**Read-only mode note:** "read-only for lapsed accounts" needs a small product mechanism eventually (org flag gating write RPCs); until built, it's contractual only — flag as a backlog item, not a launch blocker.

**When to revisit:** at 5 paying farms — evaluate Paymob/InstaPay Business for collection, a proper ticket inbox, and a part-time onboarding/support person (the founder-hours data from the playbook instrumentation decides).
