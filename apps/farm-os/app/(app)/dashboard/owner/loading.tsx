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
      <span className="sr-only">جار التحميل...</span>
      <div className="flex flex-wrap items-end justify-between gap-3 border-b pb-4" style={{ borderColor: "var(--line)" }}>
        <div className="flex flex-col gap-2">
          <Block className="h-7 w-52 max-w-full" />
          <Block className="h-4 w-72 max-w-full" />
        </div>
        <div className="flex gap-2">
          <Block className="h-10 w-20" />
          <Block className="h-10 w-24" />
        </div>
      </div>
      <section className="flex flex-col gap-2">
        <Block className="h-6 w-32" />
        <Block className="h-12 w-full" />
        <Block className="h-12 w-full" />
      </section>
      <section className="space-y-3">
        <Block className="h-6 w-28" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => <Block key={index} className="h-28 w-full" />)}
        </div>
      </section>
      <Block className="h-16 w-full" />
      <section className="space-y-3">
        <Block className="h-6 w-52 max-w-full" />
        <div className="grid gap-6 lg:grid-cols-2">
          <Block className="h-44 w-full" />
          <Block className="h-44 w-full" />
        </div>
      </section>
    </div>
  );
}
