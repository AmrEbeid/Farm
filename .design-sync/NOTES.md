# design-sync NOTES — @farm-os/ui

## General learnings
- [GENERAL] Source repo (no `node_modules/@farm-os/ui`) → converter run with `--entry dist/index.js`; build the lib (`npm run build`) before each converter run so `dist/` is current.
- [GENERAL] Font: the system Arabic-safe stack (`"Segoe UI", Tahoma, system-ui`) is used deliberately so no webfont is referenced-but-unshipped (avoids `[FONT_MISSING]`). If a branded Arabic face (e.g. IBM Plex Arabic) is adopted later, ship the woff2 + `@font-face` via `cfg.extraFonts` AND inject the same `@font-face` into `.design-sync/sb-reference/iframe.html` so the oracle verifies on both sides.
- KpiCard: the `Row` story is wider than a grid cell → `cfg.overrides.KpiCard.cardMode = "column"` (applied). Presentation-only; grades carry.

## Re-sync risks (watch on the next sync)
- **VerdictBanner**: render-check reports `errs:1, caught:1` on the ReorderSoon story, but all three stories render correctly in the screenshot (verified by image). Treated as a benign caught-console artifact, graded `match` by image. If a future run shows it as a real blank/mismatch, own `.design-sync/previews/VerdictBanner.tsx` (direct render of the three tones) to bypass the story-decorator compose path.
- **Initial upload performed (2026-06-21)**: rebuilt → converter → validate (exit 0) → uploaded all 55 shippable files to a new design project **"Farm OS UI"** (`projectId: 115ae675-68f4-438b-8d03-6e83752aace3`). The remote now has a `_ds_sync.json` anchor, so future re-syncs diff against it and ship only what changed. Dotfiles + `_screenshots/` are local-only and were correctly excluded.
- Story caps: each component has ≤6 stories; none capped. All 37 stories paired to exports.

## State at last local build
- shape=storybook, 9 components, 37 stories, bundle 11 KB, css 9 KB, validate exit 0 (1 non-blocking warning = the VerdictBanner artifact above).
- Reference storybook: `.design-sync/sb-reference` (rebuild if DS source changes).
