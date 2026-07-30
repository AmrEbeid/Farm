export interface PalmRegistrySource {
  id: string;
  locator: string;
  sha256: string;
}

export interface PalmRegistryBlockEvidence {
  id: string;
  name: string;
  sectorNumber: number;
  barhiCounts: readonly number[];
  maleCounts: readonly number[];
  plantingDateValues?: readonly string[];
}

export interface PalmRegistryRange {
  hawsha: number;
  firstPalm: number;
  lastPalm: number;
}

export interface PalmSourceManifest {
  source2026: PalmRegistrySource & {
    dimensions: { rows: number; columns: number };
    statedBarhiTotal: number;
    blocks: readonly PalmRegistryBlockEvidence[];
  };
  numbering2021: PalmRegistrySource & {
    numberedPalmTotal: number;
    headingCounts: readonly number[];
  };
  inspection2021: PalmRegistrySource & {
    numberedPalmTotal: number;
    ranges: readonly PalmRegistryRange[];
  };
  disputedBaseline: {
    barhi: number;
    male: number;
    hawshat: number;
  };
}

export type PalmSourceIssueCode =
  | "BARHI_TOTAL_MISMATCH"
  | "DUPLICATE_SECTOR_NUMBER"
  | "UNIT_SHAPE_MISMATCH"
  | "MALFORMED_PLANTING_DATE"
  | "UNIT_COUNT_AMBIGUOUS"
  | "NUMBERING_HEADING_TOTAL_MISMATCH"
  | "NUMBERING_RANGE_MISMATCH"
  | "DISPUTED_BASELINE_CONFLICT";

export interface PalmSourceIssue {
  code: PalmSourceIssueCode;
  sourceId: string;
  locator: string;
  message: string;
  expected?: number | string;
  actual?: number | string;
}

export interface PalmSourceReconciliation {
  authorityState: "blocked" | "review_required";
  importPayload: null;
  derived: {
    barhiRowTotal2026: number;
    maleRowTotal2026: number;
    barhiUnitColumns2026: number;
    impliedUnitColumns2026: number;
    headingTotal2021: number;
    rangeTotal2021: number;
    rangeSizes2021: number[];
  };
  issues: PalmSourceIssue[];
}

const SOURCE_2026: PalmRegistrySource = {
  id: "palm-structure-2026",
  locator:
    "ملفات خاصة بالمزرعة من عام 2021 الي 2026/مزرعة عبيد 2026/بيانات مزارع وقطاعات النخيل.xlsx",
  sha256: "1a74a4a4cafa40be36d7fad72899bea077c48266ab4b30eb53596844b470450d",
};

const NUMBERING_2021: PalmRegistrySource = {
  id: "palm-numbering-headings-2021",
  locator:
    "ملفات خاصة بالمزرعة من عام 2021 الي 2026/مزرعة عبيد 2021/الاسمدة والمبيدات المطلوبة للعام الجديد/ترقيم نخيل ال 18 فدان بالعزبة.xlsx",
  sha256: "e2536b9b4fe0a94eb948978589e689518e4cda902d39e5fa0996d47e2cfcead5",
};

const INSPECTION_2021: PalmRegistrySource = {
  id: "palm-inspection-ranges-2021",
  locator:
    "ملفات خاصة بالمزرعة من عام 2021 الي 2026/مزرعة عبيد 2021/الاسمدة والمبيدات المطلوبة للعام الجديد/النخيل/ترقيم وفحص النخيل بمزرعة 18 فدان.xlsx",
  sha256: "b068851b8937c2f39940311c113b99d0a4fd7baccf2fa293e4049feb50116a17",
};

export const EBEID_PALM_SOURCE_MANIFEST: PalmSourceManifest = {
  source2026: {
    ...SOURCE_2026,
    dimensions: { rows: 71, columns: 8 },
    statedBarhiTotal: 4539,
    blocks: [
      {
        id: "18-feddan",
        name: "18 فدان",
        sectorNumber: 1,
        barhiCounts: [134, 130, 120, 120, 120, 130],
        maleCounts: [11, 0, 6, 0, 3, 5],
      },
      {
        id: "4-feddan",
        name: "4 فدان",
        sectorNumber: 2,
        barhiCounts: [194],
        maleCounts: [0],
      },
      {
        id: "awama",
        name: "العوامة",
        sectorNumber: 3,
        barhiCounts: [160, 170, 170, 167],
        maleCounts: [16, 16, 16, 0],
      },
      {
        id: "haswa",
        name: "الحصوة",
        sectorNumber: 3,
        barhiCounts: [220, 212, 209, 115],
        maleCounts: [0, 0, 0, 0],
      },
      {
        id: "hod-el-babour",
        name: "حوض البابور",
        sectorNumber: 4,
        barhiCounts: [276, 347, 428, 203, 231],
        maleCounts: [58, 16, 17, 0, 0],
      },
      {
        id: "shafaa",
        name: "الشفاعة",
        sectorNumber: 5,
        barhiCounts: [118, 151],
        maleCounts: [0, 36, 34, 33],
        plantingDateValues: ["2026-2025", "2026"],
      },
      {
        id: "khattara",
        name: "الخطارة",
        sectorNumber: 6,
        barhiCounts: [56, 134, 154, 169],
        maleCounts: [0, 36, 34, 33],
      },
    ],
  },
  numbering2021: {
    ...NUMBERING_2021,
    numberedPalmTotal: 759,
    headingCounts: [125, 143, 132, 132, 108, 142],
  },
  inspection2021: {
    ...INSPECTION_2021,
    numberedPalmTotal: 759,
    ranges: [
      { hawsha: 1, firstPalm: 1, lastPalm: 125 },
      { hawsha: 2, firstPalm: 126, lastPalm: 268 },
      { hawsha: 3, firstPalm: 269, lastPalm: 376 },
      { hawsha: 4, firstPalm: 377, lastPalm: 508 },
      { hawsha: 5, firstPalm: 509, lastPalm: 616 },
      { hawsha: 6, firstPalm: 617, lastPalm: 759 },
    ],
  },
  disputedBaseline: {
    barhi: 4380,
    male: 299,
    hawshat: 28,
  },
};

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function validIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

export function buildPalmSourceReconciliation(
  manifest: PalmSourceManifest = EBEID_PALM_SOURCE_MANIFEST,
): PalmSourceReconciliation {
  const { source2026, numbering2021, inspection2021, disputedBaseline } = manifest;
  const barhiRowTotal2026 = sum(source2026.blocks.flatMap((block) => block.barhiCounts));
  const maleRowTotal2026 = sum(source2026.blocks.flatMap((block) => block.maleCounts));
  const barhiUnitColumns2026 = sum(source2026.blocks.map((block) => block.barhiCounts.length));
  const impliedUnitColumns2026 = sum(
    source2026.blocks.map((block) => Math.max(block.barhiCounts.length, block.maleCounts.length)),
  );
  const headingTotal2021 = sum(numbering2021.headingCounts);
  const rangeSizes2021 = inspection2021.ranges.map(
    (range) => range.lastPalm - range.firstPalm + 1,
  );
  const rangeTotal2021 = sum(rangeSizes2021);
  const issues: PalmSourceIssue[] = [];

  if (barhiRowTotal2026 !== source2026.statedBarhiTotal) {
    issues.push({
      code: "BARHI_TOTAL_MISMATCH",
      sourceId: source2026.id,
      locator: `${source2026.locator}#sheet-1`,
      message: "The Barhi row values do not reconcile to the workbook's stated total.",
      expected: source2026.statedBarhiTotal,
      actual: barhiRowTotal2026,
    });
  }

  const sectors = new Map<number, string[]>();
  for (const block of source2026.blocks) {
    sectors.set(block.sectorNumber, [...(sectors.get(block.sectorNumber) ?? []), block.name]);
    if (block.barhiCounts.length !== block.maleCounts.length) {
      issues.push({
        code: "UNIT_SHAPE_MISMATCH",
        sourceId: source2026.id,
        locator: `${source2026.locator}#${block.id}`,
        message: "Barhi and male values do not describe the same number of units.",
        expected: block.barhiCounts.length,
        actual: block.maleCounts.length,
      });
    }
    for (const value of block.plantingDateValues ?? []) {
      if (!validIsoDate(value)) {
        issues.push({
          code: "MALFORMED_PLANTING_DATE",
          sourceId: source2026.id,
          locator: `${source2026.locator}#${block.id}`,
          message: "A planting-date value is not a complete ISO calendar date.",
          actual: value,
        });
      }
    }
  }

  for (const [sectorNumber, names] of sectors) {
    if (names.length > 1) {
      issues.push({
        code: "DUPLICATE_SECTOR_NUMBER",
        sourceId: source2026.id,
        locator: `${source2026.locator}#sector-${sectorNumber}`,
        message: `Sector number ${sectorNumber} is assigned to multiple blocks: ${names.join(", ")}.`,
        actual: names.length,
      });
    }
  }

  if (barhiUnitColumns2026 !== impliedUnitColumns2026) {
    issues.push({
      code: "UNIT_COUNT_AMBIGUOUS",
      sourceId: source2026.id,
      locator: `${source2026.locator}#sheet-1`,
      message: "The claimed unit count depends on unmatched columns and cannot authorize 28 hawshat.",
      expected: impliedUnitColumns2026,
      actual: barhiUnitColumns2026,
    });
  }

  if (headingTotal2021 !== numbering2021.numberedPalmTotal) {
    issues.push({
      code: "NUMBERING_HEADING_TOTAL_MISMATCH",
      sourceId: numbering2021.id,
      locator: `${numbering2021.locator}#headings`,
      message: "The six heading counts do not reconcile to the explicitly numbered palms.",
      expected: numbering2021.numberedPalmTotal,
      actual: headingTotal2021,
    });
  }

  const rangeDifferences = numbering2021.headingCounts.flatMap((heading, index) =>
    heading === rangeSizes2021[index]
      ? []
      : [`hawsha ${index + 1}: heading ${heading}, range ${rangeSizes2021[index] ?? "missing"}`],
  );
  if (
    rangeTotal2021 !== inspection2021.numberedPalmTotal ||
    numbering2021.numberedPalmTotal !== inspection2021.numberedPalmTotal ||
    rangeDifferences.length > 0
  ) {
    issues.push({
      code: "NUMBERING_RANGE_MISMATCH",
      sourceId: inspection2021.id,
      locator: `${inspection2021.locator}#numbered-ranges`,
      message: `The 2021 heading and numbered-range evidence conflicts (${rangeDifferences.join("; ")}).`,
      expected: numbering2021.headingCounts.join(","),
      actual: rangeSizes2021.join(","),
    });
  }

  if (
    disputedBaseline.barhi !== source2026.statedBarhiTotal ||
    disputedBaseline.male !== maleRowTotal2026 ||
    disputedBaseline.hawshat !== impliedUnitColumns2026
  ) {
    issues.push({
      code: "DISPUTED_BASELINE_CONFLICT",
      sourceId: source2026.id,
      locator: `${source2026.locator}#comparison`,
      message: "The historical baseline conflicts with later source evidence and remains non-authoritative.",
      expected: `${disputedBaseline.barhi}/${disputedBaseline.male}/${disputedBaseline.hawshat}`,
      actual: `${source2026.statedBarhiTotal}/${maleRowTotal2026}/${impliedUnitColumns2026}`,
    });
  }

  return {
    authorityState: issues.length > 0 ? "blocked" : "review_required",
    importPayload: null,
    derived: {
      barhiRowTotal2026,
      maleRowTotal2026,
      barhiUnitColumns2026,
      impliedUnitColumns2026,
      headingTotal2021,
      rangeTotal2021,
      rangeSizes2021,
    },
    issues,
  };
}
