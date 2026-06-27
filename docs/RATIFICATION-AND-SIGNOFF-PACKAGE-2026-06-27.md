# Back-half stages — Ratification & sign-off package (2026-06-27)

*The six back-half stages are **built to the limit of what code can do** (PRs below, all verified green).
What each one needs now is a **gate that only the Owner or a named external expert can close** — by
design, per [`CLAUDE.md`](CLAUDE.md): "the Owner never lets a tool silently decide product, financial,
people, legal, security, or architecture choices." This doc gives you one decision per gate, a
recommendation, and the PR it releases. **An AI cannot ratify a SPEC, sign off agronomy, run a privacy
review, or reconcile your Excel — and shouldn't pretend to.***

## At a glance

| Stage | Built (PR) | The gate | Who closes it | Type |
|---|---|---|---|---|
| 5 Croquis | [#347](https://github.com/AmrEbeid/Farm/pull/347) — full feature | Ratify SPEC-0003 + **4-vs-5 sectors** | **Owner** | Decision |
| 9 Weather | [#350](https://github.com/AmrEbeid/Farm/pull/350) — full feature | Ratify SPEC-0007 + provider **API key** | **Owner** | Decision + config |
| 8 Payroll | [#352](https://github.com/AmrEbeid/Farm/pull/352) — engine | Ratify SPEC-0006 + **independent access review** | **Owner** + reviewer | Decision + review |
| 7 Accounting | [#354](https://github.com/AmrEbeid/Farm/pull/354) — engine | **7-yr Excel reconciliation** + privacy review | **Owner** + finance/data | **External** |
| 10 Academy | [#355](https://github.com/AmrEbeid/Farm/pull/355) — #4 gate | **Agronomist + pesticide-registration sign-off** | **Licensed agronomist** | **External / legal** |
| 11 AI عبدالجليل | [#356](https://github.com/AmrEbeid/Farm/pull/356) — trifecta gate | Ratify SPEC-0005 + **independent review** | **Owner** + reviewer | Decision + review |

---

## 1 — Stage 5 · Croquis · *Owner decision (one signal)*
- **Decision:** ratify [`SPEC-0003`](SPEC-0003-farm-structure-and-palm-registry-import.md); confirm **4 vs 5 sectors**.
- **Recommendation:** **5 sectors** (S22 / HSW / BAB / SHF / KHT) — this already matches the **live prod
  registry** (5 sectors, 4,380 برحي / 299 ذكور / 28 حوش, verified). 4-vs-5 is effectively already 5 on prod.
- **Note:** the croquis itself is **ungated and works today** — this ratification is the formal Stage-2/5
  scope sign-off, not a blocker for the view. ✅ One Owner signal closes it.

## 2 — Stage 9 · Weather · *Owner decision + one secret*
- **Decision:** ratify [`SPEC-0007`](SPEC-0007-weather-integration.md); pick a **provider** + set the key.
- **Recommendation:** **advisory mode** (warn, don't hard-block — §5.3); provider **OpenWeather One-Call**
  (or a MENA source); set server-only `WEATHER_API_KEY` + `WEATHER_API_URL` in Vercel. Thresholds are
  agronomic — ideally cross-checked with the agronomist (overlaps Stage 10).
- **Unblocks:** [#350](https://github.com/AmrEbeid/Farm/pull/350) goes live the moment the key is set.

## 3 — Stage 8 · Payroll · *Owner ratify + independent access review*
- **Decision:** ratify [`SPEC-0006`](SPEC-0006-people-labor-payroll.md); commission the **independent
  access review** the spec requires for the payroll RPC slice.
- **Status:** PII-1 (wage confidentiality) is **already live** (migrations 0046/0048/0079). The
  computation **engine** is done ([#352](https://github.com/AmrEbeid/Farm/pull/352)). Remaining build =
  `labor_logs` + the idempotent payroll RPC + owner/accountant RLS — buildable on synthetic data **once
  you ratify**; **real staff PII stays behind the Stage-M privacy review.**
- **Owner action:** ratify + name the independent reviewer; I then build slices 2–3 on synthetic data.

## 4 — Stage 7 · Accounting / P&L · *External — I cannot substitute this*
- **Gate:** the **finance oracle** — a dual-run reconciliation of one **closed season** against your real
  **7-year Excel** totals; plus a privacy review before real financials enter any environment.
- **Why I can't close it:** non-negotiable #1 forbids fabricating financials; I don't have the Excel, and
  a privacy review is a human process. The **engine** ([#354](https://github.com/AmrEbeid/Farm/pull/354))
  correctly separates drawings (مسحوبات) from operating expenses (#6) and is ready to be reconciled.
- **Owner action:** provide the closed-season Excel totals + a finance reviewer; then the dual-run
  reconciliation can run as the acceptance gate.

## 5 — Stage 10 · Care Academy · *External / legal — I must not cross this*
- **Gate:** a **named local agronomist** signs off the NPK/irrigation/**pesticide** figures **and**
  confirms **current Egyptian pesticide registrations** for any chemical named (#4).
- **Why I can't close it:** I am not a licensed agronomist, and an AI marking doses "authoritative" risks
  crop damage / illegal chemical use — a real liability. The **#4 gate**
  ([#355](https://github.com/AmrEbeid/Farm/pull/355)) **guarantees nothing renders as authoritative** until
  a valid sign-off exists; until then content shows "قالب استرشادي — راجِع مهندسك الزراعي".
- **Owner action:** engage a licensed Egyptian agronomist to sign off the figures + confirm registrations;
  record the sign-off (who/when/scope). The content editor build follows that.

## 6 — Stage 11 · AI عبدالجليل · *Owner ratify + independent review (highest risk)*
- **Decision:** ratify [`SPEC-0005`](SPEC-0005-ai-assistant-abduljalil.md); pick provider/model; commission
  **independent review of each slice** (mandatory — it's the lethal trifecta).
- **Status:** the **capability boundary** ([#356](https://github.com/AmrEbeid/Farm/pull/356)) is the
  security control any AI build must use (read-only, RLS-scoped, no compensation/PII, no outbound).
- **Recommendation:** build the **no-ingest version first** (answer over the user's own RLS-scoped data,
  no untrusted web ingest), independent review per slice. **I did not build the AI** — that's the gated,
  reviewed work after you ratify.

---

## The honest bottom line
- **4 gates are yours to decide** (ratify SPEC-0003/0006/0007/0005, the 4-vs-5 call). Your written
  direction is the ratification; I've recommended each. Say the word and I build/release the rest.
- **2 gates are external and uncrossable by me or by directive alone:** the **agronomist sign-off**
  (a licensed expert) and the **Excel reconciliation + privacy review** (real data + a human review). No
  amount of code substitutes them — and faking them would be the exact harm the gates prevent.

Every PR is ready; the buildable work is done. The remaining six gates are, deliberately, **yours**.
