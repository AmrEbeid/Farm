# Pilot Readiness — Farm OS MVP-0

The pilot is the **MVP-0 success gate**: per SPEC-0001 / 06 §1, we prove the wedge with real
farms *before* investing in the full ERP (Stages 1–11). This runbook makes the pilot turnkey:
a live demo script (the verified wedge loop), the interview plan, and the kill/continue rule.
Owner-run (the 5 interviews are human); deploy + Stage 0 should be done first (see the deploy /
Stage-0 runbooks) — though the demo can also run on the **local** stack for early interviews.

## Hypotheses to validate (kill/continue — 06 §1)
- **H1** — a farm manager will **build a monthly plan** in the tool instead of paper/WhatsApp.
- **H2** — the **stock-coverage forecast** changes a purchasing decision (catches a shortage
  before the field). *This is the wedge.*
- **H3** — the **farm/palm file** is something the owner/engineer opens repeatedly.
- **H4** — an owner confirms **willingness to pay** a setup fee after seeing it.

## The 7 gates — need **≥5** to continue to the full MVP (tracker §"Pilot validation gates")
- [ ] 5 farms interviewed
- [ ] 2 share real data
- [ ] 1 builds a monthly plan (H1)
- [ ] 1 validates stock coverage (H2)
- [ ] 1 owner confirms willingness to pay (H4)
- [ ] 1 accountant confirms the reports are useful
- [ ] 1 supervisor confirms the mobile flow is easy (<60s to log)

## Live demo script — the wedge loop (≈8 min; mirrors the passing e2e)
Use the seeded Ebeid scenario (the potassium shortage is intentional: on-hand 300 kg vs a plan
needing 500 kg).
1. **Manager** signs in → opens (or builds) the monthly plan; adds a fertilization op needing
   **500 kg سلفات بوتاسيوم**. *(H1 — does this feel better than paper/WhatsApp?)*
2. **Run plan checks** → the **stock check BLOCKS**: available 300, need 500, shortfall 200,
   coverage ≈ **4.2 days < 5-day lead** → "⚠️ نقص متوقع… اطلب 300 كجم اليوم". *(H2 — the wedge
   moment: would this have caught the shortage before the field?)*
3. **Create a purchase request from the shortage** → reserves the requirement (available drops,
   on-hand unchanged).
4. **Budget gate** → submit → **owner approves** (separation of duties: the author cannot
   self-approve — enforced in the DB).
5. **Storekeeper** records the **receipt** (300 kg) → on-hand 300 → 600.
6. **Supervisor** executes the op on **mobile**, logs actual **480 kg**. *(time it — target <60s.)*
7. **Planned-vs-actual report**: planned 500 kg / 42,000 vs actual 480 kg / 40,320 →
   **variance −1,680 (−4%)**. *(H3 — would the owner/engineer open this repeatedly?)*
8. Ask the **owner** for a setup-fee reaction. *(H4 — willingness to pay; pricing is per-farm
   EGP, never per-seat.)*

## Interview plan (per design-partner farm)
- **Roles to sit with:** owner, farm manager, accountant, supervisor/storekeeper.
- **Ask, don't pitch:** how they plan today; the last time they ran short of an input mid-op;
  how they track stock/spend now; what a report needs to be useful.
- **Data-sharing ask:** offer to load *their* registry + a month of costs (2 farms = the gate).
  Real data only after Stage 0 + a privacy review (PROJECT RULES); otherwise demo on the seed.
- **Capture per farm:** which gates were hit, verbatim quotes, objections, the WTP number, and
  any missing must-have. Log results against the gate checklist in `PROJECT-TRACKER.md`.

## Decision rule
- **≥5/7 gates hit → continue:** begin the full MVP (Stages 1–11) — each via its own spec +
  Owner approval, **Stage 0 closed first**.
- **<5/7 → do NOT build the ERP yet:** iterate the wedge or pivot on what the farms actually
  said. This is the point of MVP-0 — a cheap kill/continue signal before the big build.

## Readiness checklist before the first interview
- [ ] App deployed (or local stack ready) — `DEPLOY-RUNBOOK.md`.
- [ ] Email/password demo accounts ready (auth is email + password — phone-OTP removed).
- [ ] The seeded wedge scenario loads and the demo script runs end-to-end (it does — e2e green).
- [ ] Arabic-RTL verified on a real phone for the supervisor step.
- [ ] Stage 0 closed if any real farm data will be loaded.
