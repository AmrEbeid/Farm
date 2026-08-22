import Link from "next/link";

/**
 * SPEC-0032 — `ep_harvest_log` / `ep_owner_whatsapp`: authoritative in /harvest and /website
 * (fidelity-manifest.ts `mapped_elsewhere`). This panel avoids presenting an unsynchronised
 * workspace value and links to the page that actually owns the data.
 */
export function WorkspaceReadonlyStatePanel({
  title,
  description,
  points,
  link,
  statusLabel,
}: {
  title: string;
  description?: string;
  points: readonly string[];
  link: { href: string; label: string };
  statusLabel: string;
}) {
  return (
    <section className="flex flex-col gap-2 rounded-lg border p-4" style={{ borderColor: "var(--line)" }}>
      <h2 className="text-lg font-bold">{title}</h2>
      {description && <p style={{ color: "var(--ink-muted)" }}>{description}</p>}
      <div className="rounded-md border p-3 text-sm" style={{ borderColor: "var(--line)" }}>
        {statusLabel}
      </div>
      {points.length > 0 && (
        <ol className="flex list-decimal flex-col gap-1 ps-5 text-sm">
          {points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ol>
      )}
      <Link href={link.href} className="no-print w-fit font-bold underline-offset-2 hover:underline">
        {link.label}
      </Link>
    </section>
  );
}
