export interface ReconciliationHawsha {
  id: string;
  name?: string | null;
  code?: string | null;
  palm_count_barhi?: number | null;
  palm_count_male?: number | null;
}

export interface ReconciliationLine {
  id: string;
  line_no?: number | null;
  line_code?: string | null;
  palm_count?: number | null;
  hawsha_id?: string | null;
  hawshat?: { name?: string | null; code?: string | null } | { name?: string | null; code?: string | null }[] | null;
}

export interface ReconciliationPalm {
  id: string;
  hawsha_id?: string | null;
  line_id?: string | null;
  status?: string | null;
  archived?: boolean | null;
}

export type PalmCountMismatchScope = "hawsha" | "line";

export interface PalmCountMismatch {
  id: string;
  scope: PalmCountMismatchScope;
  label: string;
  parentLabel: string | null;
  stored: number | null;
  actual: number;
  difference: number;
  href: string;
}

export interface PalmCountReconciliation {
  mismatches: PalmCountMismatch[];
  hawshaMismatches: PalmCountMismatch[];
  lineMismatches: PalmCountMismatch[];
}

function one<T>(rel: T | T[] | null | undefined): T | null {
  return (Array.isArray(rel) ? rel[0] : rel) ?? null;
}

function countBy<K extends string>(rows: K[]): Map<K, number> {
  const counts = new Map<K, number>();
  for (const row of rows) {
    counts.set(row, (counts.get(row) ?? 0) + 1);
  }
  return counts;
}

function hawshaLabel(hawsha: ReconciliationHawsha): string {
  return hawsha.name ?? hawsha.code ?? hawsha.id;
}

function lineLabel(line: ReconciliationLine): string {
  if (line.line_no != null) return `خط ${line.line_no}`;
  return line.line_code ?? line.id;
}

function lineParentLabel(line: ReconciliationLine): string | null {
  const hawsha = one(line.hawshat);
  return hawsha?.name ?? hawsha?.code ?? null;
}

const COUNTABLE_PALM_STATUSES = new Set(["active", "watch", "sick", "dead"]);

function isCountablePalm(palm: ReconciliationPalm): boolean {
  if (palm.archived) return false;
  return palm.status == null || COUNTABLE_PALM_STATUSES.has(palm.status);
}

export function buildPalmCountReconciliation({
  hawshat,
  lines,
  palms,
}: {
  hawshat: ReconciliationHawsha[];
  lines: ReconciliationLine[];
  palms: ReconciliationPalm[];
}): PalmCountReconciliation {
  const countablePalms = palms.filter(isCountablePalm);
  const palmsByHawsha = countBy(countablePalms.map((p) => p.hawsha_id).filter((id): id is string => Boolean(id)));
  const palmsByLine = countBy(countablePalms.map((p) => p.line_id).filter((id): id is string => Boolean(id)));

  const hawshaMismatches = hawshat.flatMap<PalmCountMismatch>((hawsha) => {
    const stored = Number(hawsha.palm_count_barhi ?? 0) + Number(hawsha.palm_count_male ?? 0);
    const actual = palmsByHawsha.get(hawsha.id) ?? 0;
    if (stored === actual) return [];
    return [
      {
        id: hawsha.id,
        scope: "hawsha",
        label: hawshaLabel(hawsha),
        parentLabel: null,
        stored,
        actual,
        difference: actual - stored,
        href: `/farm/hawsha/${hawsha.id}`,
      },
    ];
  });

  const lineMismatches = lines.flatMap<PalmCountMismatch>((line) => {
    const actual = palmsByLine.get(line.id) ?? 0;
    const stored = line.palm_count ?? null;
    if (stored == null && actual === 0) return [];
    if (stored === actual) return [];
    return [
      {
        id: line.id,
        scope: "line",
        label: lineLabel(line),
        parentLabel: lineParentLabel(line),
        stored,
        actual,
        difference: actual - (stored ?? 0),
        href: `/farm/line/${line.id}`,
      },
    ];
  });

  return {
    mismatches: [...hawshaMismatches, ...lineMismatches],
    hawshaMismatches,
    lineMismatches,
  };
}
