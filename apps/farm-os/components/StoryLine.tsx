// SPEC-0025 U-12 (§2c) — "lead with the sentence, not the grid". A report opens with one (or two)
// plain-Arabic sentences built from the SAME live data the page already fetched — rule-based templates
// only (Stage-11 AI gate intact), honest nulls (#1): callers pass no sentence when there is no data.
// Server component; pure presentation.

export function StoryLine({ lead, notes = [] }: { lead: string; notes?: string[] }) {
  return (
    <section
      aria-label="خلاصة الفترة"
      className="flex flex-col gap-1 rounded-lg px-4 py-3"
      style={{
        background: "var(--surface-raised, #fff)",
        border: "1px solid var(--line)",
        borderInlineStartWidth: "4px",
        borderInlineStartColor: "var(--brand, #1e6b3a)",
      }}
    >
      <p className="text-base font-bold" style={{ color: "var(--ink)" }}>
        {lead}
      </p>
      {notes.map((n) => (
        <p key={n} className="text-sm" style={{ color: "var(--ink-muted)" }}>
          {n}
        </p>
      ))}
    </section>
  );
}
