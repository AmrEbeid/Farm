// Route-level loading skeleton for /m (the field task feed). Rendered while the
// server component's plan_operations (and, with ?mine=1, plan_operation_assignees)
// query resolves. Mirrors the mobile card-list layout (max-w-md, stacked cards) so
// the field view gets an instantly correctly-shaped skeleton instead of falling
// back to the generic (app)/loading.tsx dashboard-shaped one. RTL is inherited
// from the root <html dir="rtl">.
function Block({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-md ${className}`}
      style={{ backgroundColor: "var(--surface-muted, rgba(0,0,0,0.06))" }}
    />
  );
}

function CardSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-md border p-4" style={{ borderColor: "var(--border, rgba(0,0,0,0.1))" }}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-2">
          <Block className="h-4 w-24" />
          <Block className="h-3 w-32" />
        </div>
        <Block className="h-6 w-16 rounded-full" />
      </div>
      <Block className="h-11 w-28 rounded-md" />
    </div>
  );
}

export default function MobileHomeLoading() {
  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 p-4" aria-busy="true" aria-live="polite">
      <span className="sr-only">جارٍ التحميل…</span>

      {/* header */}
      <div className="flex flex-col gap-2">
        <Block className="h-6 w-20" />
        <Block className="h-4 w-28" />
      </div>

      {/* section title + mine-filter toggle */}
      <div className="flex items-center justify-between gap-3">
        <Block className="h-6 w-36" />
        <Block className="h-11 w-24 rounded-md" />
      </div>

      {/* card list */}
      <div className="flex flex-col gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
