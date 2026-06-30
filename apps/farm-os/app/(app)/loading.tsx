// Route-level loading skeleton for the (app) segment. Rendered inside AppChrome
// while a page's server data resolves. The reserved KPI-grid + table dimensions
// mirror the dashboard pages so the layout doesn't shift when content arrives
// (protects CLS). RTL is inherited from the root <html dir="rtl">.
function Block({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-md ${className}`}
      style={{ backgroundColor: "var(--surface-muted, rgba(0,0,0,0.06))" }}
    />
  );
}

export default function AppLoading() {
  return (
    <div className="flex flex-col gap-6 p-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">جارٍ التحميل…</span>

      {/* page title */}
      <Block className="h-8 w-48" />

      {/* KPI grid — matches grid-cols-2 lg:grid-cols-4 cards */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Block key={i} className="h-24 w-full" />
        ))}
      </section>

      {/* table — header row + body rows */}
      <section className="flex flex-col gap-3">
        <Block className="h-6 w-40" />
        <div className="flex flex-col gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Block key={i} className="h-10 w-full" />
          ))}
        </div>
      </section>
    </div>
  );
}
