import Link from "next/link";

/** SPEC-0032 — a "guide" blueprint section: reviewed static bullet points, no source markup. */
export function WorkspaceGuidePanel({
  title,
  description,
  points,
  link,
}: {
  title: string;
  description?: string;
  points: readonly string[];
  link?: { href: string; label: string };
}) {
  return (
    <section className="flex flex-col gap-2 rounded-lg border p-4" style={{ borderColor: "var(--line)" }}>
      <h2 className="text-lg font-bold">{title}</h2>
      {description && <p style={{ color: "var(--ink-muted)" }}>{description}</p>}
      {points.length > 0 && (
        <ol className="flex list-decimal flex-col gap-1 ps-5 text-sm">
          {points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ol>
      )}
      {link && (
        <Link href={link.href} className="no-print w-fit font-bold underline-offset-2 hover:underline">
          {link.label}
        </Link>
      )}
    </section>
  );
}
