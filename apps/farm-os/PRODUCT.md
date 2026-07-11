# Product

<!-- Strategic design context for Farm OS (نظام تشغيل المزارع). Derived by /impeccable init from the repo's
     own non-negotiables (docs/CLAUDE.md) + the UX specs (SPEC-0025 task-first, SPEC-0030 nav/workflow revamp),
     not invented. Owner (Amr Ebeid) gates any brand/strategy claim here — edit freely. -->

## Register

product

## Platform

web

<!-- Next.js 16 (App Router, RSC) + @amrebeid/ui + Supabase; responsive and offline-tolerant for field roles
     on phones (rule #2), but not a native app. -->

## Users

Primary: the **farm Owner** and the farm's operating roles — **farm_manager, agri_engineer (المهندس الزراعي),
accountant (المحاسب), supervisor (المشرف), storekeeper (أمين المخزن)** — all Arabic-first. Two very different
contexts share one product:

- **Field roles** (supervisor, storekeeper, agri_engineer) work on a **phone, in the field, sometimes offline**.
  They are not finance-literate and have no time to learn software — they need dead-simple, plain-Arabic,
  ≤3-tap flows that never fail silently.
- **Desk roles** (Owner, accountant) work from a screen, often **remotely** (the Owner runs the farm from
  Cairo), and need to trust every figure well enough to make money decisions on it.

The job to be done: **record what happened** (a harvest, a delivery, an expense, a dose, custody), **review
what needs my decision or signature**, and **know the true state of the farm** — money, stock, crop — without
hunting across modules or learning accounting jargon.

## Purpose

A trustworthy **operating system + accounting system-of-record** for a real date-palm/fruit farm in Egypt.
It turns messy real-world farm activity into an honest, auditable double-entry ledger and clear owner insight:
every owner-facing figure traces to a posted journal entry, and **nothing is ever fabricated to look complete**.

Success = the Owner trusts every number enough to act on it, and a field worker can record an operation in
**under 60 seconds with zero training**.

## Positioning

The only **Arabic-RTL-first, field-to-ledger farm OS that is a true accounting system-of-record** — every
figure is a posted GL entry or an honest "—", agronomy is gated behind a named agronomist's sign-off, and the
whole thing is usable by a field worker on a phone and an owner on a laptop from the same source of truth.

## Brand & Personality

Three words: **أمين (honest), مباشر (direct), عملي (practical)**.

It should feel like a **calm, precise, trustworthy tool that respects the user's time** — accounting-grade
rigor delivered in plain, warm Arabic. Confidence over cleverness. The interface earns trust by being legible,
predictable, and honest about what it does and doesn't know; it never performs.

## Anti-references

What Farm OS must **not** look or feel like:

- **A generic SaaS-cream, English-first dashboard.** Arabic-RTL is first-class, not a retrofit; the layout,
  logical properties, numerals (Arabic-Indic, tabular), and voice are all Arabic-native.
- **A cluttered enterprise ERP full of internal jargon.** No accounting/system vocabulary is shown to field
  users. Work is organized around plain intents — سجّل (record) / راجع (review) / اعرف·التقارير (know) — not
  modules named after database tables.
- **A flashy consumer app** leaning on decorative gradients, glassmorphism, or hero-metric theatre. Trust beats
  flash; a figure is never invented to fill a card. Empty and error states are honest, not dressed up.

## Strategic design principles

Drawn from the project's hard non-negotiables (docs/CLAUDE.md) and UX specs (SPEC-0025 / SPEC-0030):

- **Honest-null (#1) is the cardinal rule.** Never render a fabricated or placeholder figure. Unknown = "—" /
  «غير معروف», never `٠`. A wrong owner-facing number is a trust breach, not a rounding detail.
- **Task-first, ≤3 clicks, no dead-ends.** Three daily intents (سجّل / راجع / اعرف); one money ledger, one
  reports hub, one approvals inbox. Every actionable prompt lands on the surface that can actually do the
  action. Every list/empty state offers a path forward.
- **Story-first.** Each screen opens with the one-sentence situation (StoryLine) and surfaces its **one legal
  next action** inline; separation-of-duties and gates are enforced in the DB, the UI only mirrors them.
- **Owner drawings are separated from operating expenses (#6);** agronomy (doses/irrigation/pesticide) is an
  **editable template, not a prescription**, gated on a named agronomist + current Egyptian registration (#4);
  the **palm registry is canonical (#5)** for any per-tree denominator.
- **Mobile + offline-tolerant for the field.** Big tap targets, legible outdoors, an offline outbox for
  execution, and honest "saved locally, not sent" messaging — never a false "done".

## Accessibility

- **Arabic-RTL throughout** — RTL logical properties, correct bidi, Arabic-Indic tabular numerals (no
  Western-digit leaks via `lib/money`).
- **≥ WCAG AA** contrast on all text (the design system's two-tier tokens carry accessible defaults); large
  touch targets (≥44px) for field use; legible at arm's length in daylight.
- **Reduced motion respected** — every animation needs a `prefers-reduced-motion` alternative.
- Designed for a **range of literacy and age** — plain Arabic, no jargon, no reliance on color alone, honest
  and specific error/empty copy.
