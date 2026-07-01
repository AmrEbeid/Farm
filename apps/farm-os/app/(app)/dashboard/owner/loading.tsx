// Owner-dashboard-specific loading skeleton. Rendered inside AppChrome while
// the strategic aggregator's server data resolves. Reserves space for every
// section of the real page (header, alert rail, 6-KPI strip, 3 chart cards,
// module-card grid) so nothing shifts once content arrives (protects CLS).
// Mirrors the generic (app)/loading.tsx pattern; RTL is inherited from the
// root <html dir="rtl">.
function Block({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-md ${className}`}
      style={{ backgroundColor: "var(--surface-muted, rgba(0,0,0,0.06))" }}
    />
  );
}

export default function OwnerDashboardLoading() {
  return (
    <div className="flex flex-col gap-6 p-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">جارٍ التحميل…</span>

      {/* page header: title + subtitle + quick actions */}
      <div
        className="flex flex-wrap items-end justify-between gap-3 border-b pb-4"
        style={{ borderColor: "var(--line)" }}
      >
        <div className="flex flex-col gap-2">
          <Block className="h-7 w-56" />
          <Block className="h-4 w-80" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Block className="h-8 w-24" />
          <Block className="h-8 w-28" />
        </div>
      </div>

      {/* alert rail — most-severe-first alerts, up to 2 columns */}
      <section className="flex flex-col gap-2">
        <Block className="h-6 w-32" />
        <div className="grid gap-2 lg:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Block key={i} className="h-16 w-full" />
          ))}
        </div>
      </section>

      {/* cross-module KPI strip — 6 metrics, responsive 2 → 3 → 6 */}
      <section className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Block key={i} className="h-24 w-full" />
        ))}
      </section>

      {/* charts — 3 cards */}
      <section className="flex flex-col gap-3">
        <Block className="h-6 w-28" />
        <div className="grid gap-4 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Block key={i} className="h-80 w-full" />
          ))}
        </div>
      </section>

      {/* module-summary cards — one per module (6) */}
      <section className="flex flex-col gap-3">
        <Block className="h-6 w-32" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Block key={i} className="h-16 w-full" />
          ))}
        </div>
      </section>
    </div>
  );
}
