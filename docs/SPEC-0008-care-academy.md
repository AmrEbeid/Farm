# SPEC-0008 — Care Academy: agronomy content as editable templates (Stage 10)

*Status: **DRAFT for Owner review** — design + decision-support only. No content is authored or
published by this doc. Stage 10 is **Medium/High risk** — agronomy/pesticide advice carries
**liability**; the gating control is a **named local agronomist + current Egyptian pesticide-
registration sign-off**, not an engineering check. Mirrors SPEC-0001..0007.*

*Companion to [`MASTER-PLAN.md`](MASTER-PLAN.md) §4 Stage 10 + §6 risk #4, [`CLAUDE.md`](CLAUDE.md)
(non-negotiable #4: agronomy content is an editable template, NOT a prescription).*

---

## 1. Value & the risk

The Academy is the onboarding/retention asset: care-by-age guidance, a disease library (Red Palm
Weevil first — the region's #1 threat), seasonal checklists, and the weather rules (Stage 9). The
risk is **liability**: NPK rates, irrigation volumes, and **pesticide doses** presented as
authoritative prescriptions are dangerous (crop damage, illegal/unregistered chemical use) and a
legal exposure. Per non-negotiable #4, all such content ships as **editable templates that require
expert sign-off before being presented as authoritative**.

## 2. Non-negotiable controls

1. **Templates, not prescriptions.** Every NPK/irrigation/pesticide figure is an *editable default*
   with a visible "review with your agronomist" disclaimer until signed off — never a hard
   instruction.
2. **Expert sign-off is the gate.** Content with agronomic numbers is **not published/authoritative**
   until a **named local agronomist** signs off the figures AND confirms **current Egyptian pesticide
   registrations** for any chemical named. The sign-off record (who/when/scope) is the evidence and is
   stored with the content.
3. **No unlicensed third-party material.** Agronomy text/images reused only with a license/source +
   review (non-negotiable / reuse rule). Cite sources.
4. **Pesticide specifics gated hardest.** A chemical may only appear with its **registration status**;
   an unregistered/expired chemical is not shown as a recommendation.

## 3. Scope

**Allowed:** content tables (`academy_topic`/`academy_item` with `category` = care-by-age / disease /
checklist / weather-rule, body, **editable agronomic fields**, `source`, **`signoff_*`** = agronomist
id/date/scope/status); a review/publish workflow (draft → agronomist-signed → published); RLS
(org-readable when published; edit gated to an `academy.write`/owner role); surfacing the relevant
checklist on the plan/operation views. Seed **structure + placeholders**, not authoritative numbers.

**Forbidden:** presenting NPK/irrigation/pesticide numbers as prescriptions pre-sign-off; publishing
a chemical without a verified current Egyptian registration; copying unlicensed agronomy text;
fabricating agronomic values (#1) — a missing number is "to be set with the agronomist", not invented.

## 4. Acceptance (the oracle — partly human)

1. **Publish gate:** content carrying agronomic numbers cannot reach `published` without a recorded
   agronomist sign-off (state-machine test: draft → published is blocked without `signoff`).
2. **Disclaimer/labeling:** unsigned numbers render with the "editable template / review with
   agronomist" treatment; signed ones show the signer + date.
3. **Pesticide registration:** any chemical shown carries a registration-status field; an
   unregistered one is not presented as a recommendation (data rule + test).
4. **Human evidence:** the agronomist's signed checklist (the off-system artifact) is attached to the
   published set — **this is the real gate**, not a code check. **Owner + agronomist gate.**

## 5. Open decisions for the Owner

1. **The agronomist** — engaging a named local expert is the **critical-path external dependency**
   (no authoritative content ships without them). Who + scope + cadence?
2. **Content sourcing** — original vs licensed; the source/citation policy.
3. **Scope for MVP** — recommend **RPW (Red Palm Weevil) + a care-by-age skeleton + the weather-rule
   checklist** first (highest value), expand later.
4. **Pesticide registration source** — the authoritative current Egyptian registry to check against.

## 6. Enforcement, evidence, slices

- **Enforcement:** the publish state-machine (no publish without sign-off) — enforced in the data
  layer, not just UI; RLS on edit; the disclaimer treatment for unsigned numbers.
- **Evidence:** the publish-gate test, the disclaimer/labeling test, and — decisively — the
  **agronomist's signed sign-off artifact**. **Gate:** Owner + agronomist.
- **Slices:** (1) content schema + the draft→signed→published state machine + RLS (no numbers yet);
  (2) RPW + care-by-age + checklist **structure/placeholders**; (3) agronomist review → sign-off →
  publish (external, gated); (4) surface checklists on plan/operation views. **Do not auto-advance**,
  and **never** publish agronomic numbers ahead of the sign-off.

This is the one stage whose gate is fundamentally **human/legal**, not a test — schedule the
agronomist early; it is the long-pole external dependency (see the path-to-finish roadmap).
