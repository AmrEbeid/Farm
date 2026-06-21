# Farm OS UI — conventions for building with this library

Arabic-RTL-first component library for a farm operating system. Build screens by composing the exported React components; style your own layout glue with the design tokens (CSS variables). Numbers and labels in examples are Arabic on purpose — keep that.

## Setup & wrapping
- **No provider/wrapper is required.** Components are styled purely by the stylesheet. Import it once at the app root: `import "@farm-os/ui/styles.css";`. Without that import, components render unstyled.
- Set direction on the app root: `<html dir="rtl" lang="ar">` (the library is RTL-first; it also works LTR if you set `dir="ltr"`).
- Components are presentational and controlled — e.g. `Tabs` takes `value` + `onChange`; you own state.

## Styling idiom — tokens, not hand-written classes
- **Style component look via props** (`variant`, `tone`, `size`, `deltaDirection`), never by overriding the internal `fos-*` classes — treat those as private.
- **For your own layout/containers, use the design tokens as CSS variables.** Real names:
  - Color: `var(--color-green-600)` (primary), `--color-green-700` (hover/heading text), `--color-gold` (accent), `--color-ink`, `--color-muted`, `--color-line`, `--color-bg`, `--color-surface`; semantic `--color-success/--warning/--danger/--info/--accent`.
  - Spacing (4px base): `var(--space-1)`…`--space-10`.
  - Type: `var(--text-xs/sm/base/md/lg/xl/2xl/3xl)`, `--font-family`, weights `--weight-semibold/bold/extrabold`.
  - Radius `var(--radius-sm/md/lg/xl/pill)`; elevation `var(--shadow-sm/md/lg)`; motion `var(--dur)`, `var(--ease)`.
- Status is **semantic only** — use the `tone` prop (`ok/warning/danger/info/neutral/accent`); never signal status with raw color.
- Financial numbers: add `style={{ fontVariantNumeric: "tabular-nums" }}` (KpiCard already does).

## Where the truth lives
- Tokens + component CSS: the bound `styles.css` (it `@import`s the token and component layers). Read it before writing custom styles.
- Per-component API and usage: each component's `.d.ts` and `.prompt.md`.

## Components available
`Button` (primary/ghost/danger, sizes md/sm, loading, disabled=permission-denied), `Tag` (6 semantic tones), `Card` (title/subtitle), `KpiCard` (label/value/unit/icon/delta), `Alert` (ok/info/warning/danger), `Progress` (default/warning/danger), `Field` (labelled input, error), `VerdictBanner` (the stock-coverage/budget verdict line: ok/warning/danger), `Tabs`.

## One idiomatic snippet
```tsx
import { KpiCard, VerdictBanner, Button } from "@farm-os/ui";
import "@farm-os/ui/styles.css";

export function StockCoverage() {
  return (
    <div dir="rtl" style={{ display: "grid", gap: "var(--space-4)", maxWidth: 640 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: "var(--space-4)" }}>
        <KpiCard label="المتاح" value="300" unit="كجم" icon="📦" />
        <KpiCard label="الغطاء" value="4.2" unit="يوم" icon="📉" delta="< مهلة 5 أيام" deltaDirection="down" />
      </div>
      <VerdictBanner tone="danger">نقص حرج — اطلب 300 كجم اليوم.</VerdictBanner>
      <Button variant="primary">إنشاء أمر شراء</Button>
    </div>
  );
}
```
