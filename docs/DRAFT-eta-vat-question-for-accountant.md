# Question for the accountant — Egyptian VAT + ETA e-invoicing obligation (date-palm farm)

*Status: **a ready-to-send question for the Owner's accountant** — not a legal opinion, and not a build
authorization. Produced to unblock owner-decision #2 in
[`ROADMAP-accounting-custody-2026-07-01.md`](ROADMAP-accounting-custody-2026-07-01.md), which gates **Slice C**
(VAT + ETA e-invoicing). Tax/legal is expert + Owner territory — this file frames the question and what we already
know; the accountant provides the determination. Companion to
[`SPEC-0004-accounting-and-pnl.md`](SPEC-0004-accounting-and-pnl.md) §7.4 (which currently assumes "fresh dates are
largely VAT-exempt; ETA triggers on VAT registration → post-pilot").*

*Author: autonomous session, Owner: Amr Ebeid.*

---

## 1. Why we're asking

Farm OS can already record cash-method accounting, but it **cannot legally issue tax invoices** — it has no VAT or
Egyptian Tax Authority (ETA) e-invoicing. Before we scope and build that (roadmap Slice C), we need a definitive
answer to one question: **is the Ebeid date-palm farm entity actually obligated to register for VAT and comply with
ETA e-invoicing/e-receipts — and if so, when and how?** The answer decides whether Slice C is urgent, deferrable,
or unnecessary, and whether to build it natively vs integrate an existing provider (Daftra / Wafeq).

## 2. What we already know (for the accountant to confirm or correct)

- **Legal framework:** Egypt's e-invoicing mandate rests on the Decree 188/2020 (founding) + 554/2021 (enforcement)
  framework. VAT-registered businesses must **pre-register on the ETA e-invoicing system before issuing invoices**,
  stamp each invoice with an **electronic signature** (Egypt Trust certificate + token), and calculate VAT;
  reported penalties reach **EGP 50,000**.
- **It is a solved, off-the-shelf capability** in Egyptian SME accounting tools (Daftra, Wafeq are fully ETA-
  integrated), so if we must comply, **integrating an existing provider is a real option** vs building submission
  natively.
- **⚠️ Do not assume an exemption.** A commonly-repeated claim that agriculture/fisheries — or firms under
  ~EGP 500k turnover — are automatically exempt from e-invoicing was checked against sources and **could not be
  substantiated (it was refuted)**. So exemption must be confirmed by you, not assumed.
- **Our current working assumption (unverified):** *fresh* dates may be largely VAT-exempt, and the ETA obligation
  may trigger only on VAT registration — hence SPEC-0004 tentatively defers this to post-pilot. **This memo exists
  to replace that assumption with your ruling.**
- **Note:** even where tools "generate a VAT return ready for submission," that means *formatted/exportable*, not
  auto-filed — filing remains a taxpayer action.

## 3. The specific questions

1. **VAT registration:** Is the farm entity currently VAT-registered? If not, does its activity or turnover
   **require** registration (what is the current threshold, and does the farm cross it)?
2. **Product VAT status (line by line):** For each thing the farm sells — **fresh dates, any processed/packed
   dates, offshoots (فسائل), and any other sales** — is it VAT-**exempt**, **zero-rated**, or **standard-rated**?
3. **ETA obligation if not VAT-registered / products exempt:** Is the entity nonetheless required to issue ETA
   **e-invoices** (or **e-receipts**, نظام الإيصال الإلكتروني, for cash farm-gate sales)? What exactly triggers the
   obligation?
4. **If obligated — process & timeline:** What's involved (ETA portal registration, Egypt Trust e-signature token,
   tax card / commercial-register data) and **by when** must we comply?
5. **e-receipt vs e-invoice:** Are cash sales at the farm gate subject to the **e-receipt** system even if
   e-invoicing doesn't apply?
6. **Input VAT:** Even if our *outputs* are exempt, is there **input-VAT** on purchases worth capturing on the
   expense side (recoverable or not)?

## 4. What each answer unblocks

- **Obligated & urgent** → Slice C moves up; we add a VAT-payable account (`2200` in the draft chart), VAT fields on
  sales/expenses, and either build ETA submission or integrate Daftra/Wafeq.
- **Exempt / deferrable** → Slice C stays deferred (post-pilot); we keep the current no-VAT posture and note it
  explicitly in SPEC-0004.
- **e-receipt only** → a narrower build (receipts, not full e-invoicing).

## 5. Caveats

Everything in §2 is drawn from vendor and guidance sources, **not a legal opinion**. Egypt's e-invoicing rollout is
phased and thresholds/exemptions shift, so this needs a determination against **current** ETA rules for a farm
entity of this size — which is exactly what we're asking you for.
