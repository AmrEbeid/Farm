# 0006 — Changesets + private-first publish

- **Status:** Accepted — 2026-06-21
- **Context project:** `@amrebeid/ui` packaging & publish (spec §5, §6)

## Context

The library must be consumable by the Farm OS app as a real dependency, with predictable versioning and a changelog, while the public API is still moving. It should be shippable to a registry now (for the app to build against) **without** committing to a public npm launch, marketing, or an external contribution process — yet nothing in how we build should *block* going public later. The repo is standalone today but should be able to drop into a monorepo (`packages/ui` + `apps/farm-os`) without restructuring.

## Decision

- **Versioning via Changesets** — automated CHANGELOG generation and version bumps. **Stay on 0.x while the API moves**, and **cut 1.0 as the publish-ready milestone** (full v1 catalog, a11y-clean, token-pure, documented).
- **Private registry first** (GitHub Packages or npm-private — either satisfies the gate; pick at implementation) with a `prepublishOnly`/CI gate of build + typecheck + test. The package is currently `"private": true` / `UNLICENSED`.
- **Public-capable, not public.** Build to a public-quality bar (typed `.d.ts`, ESM + CJS via tsup, tree-shakeable, `sideEffects` flags CSS, exports `.` + `./styles.css`) so flipping to a public registry later is a config change, not a rebuild. No marketing site or external contribution flow in v1.
- **CI** chains typecheck → build → test → build-storybook → Changesets release; red blocks merge.

## Consequences

- **Positive:** The app gets a versioned, changelog'd dependency immediately; semver discipline is automated. Staying 0.x sets the expectation that the API can still break pre-1.0. Going public later is low-friction.
- **Negative / trade-offs:** Changesets adds a per-PR step (authors must write a changeset) — friction that buys an accurate changelog. A private registry needs auth config for consumers and CI. Monorepo-readiness is a structural intention, not yet realized, so a future move still carries some cost — kept minimal by avoiding repo-specific path assumptions now.
