import { describe, it, expect } from "vitest";
import {
  COMPENSATION_MAX_SEASON_DAYS,
  COMPENSATION_MODE_INVALID_AR,
  COMPENSATION_RATE_INVALID_AR,
  COMPENSATION_RATE_MAX,
  COMPENSATION_SEASON_FORBIDDEN_AR,
  COMPENSATION_SEASON_ORDER_AR,
  COMPENSATION_SEASON_REQUIRED_AR,
  COMPENSATION_SEASON_TOO_LONG_AR,
  COMPENSATION_UNIT_FORBIDDEN_AR,
  COMPENSATION_UNIT_REQUIRED_AR,
} from "@/lib/compensation";
import {
  LABOR_DATE_FUTURE_AR,
  LABOR_HOURS_AR,
  LABOR_PIECE_ONLY_AR,
  LABOR_QUANTITY_AR,
  LABOR_UNIT_REQUIRED_AR,
} from "@/lib/labor-entry";
import { resolveRefs } from "../resolve";
import { validateRows } from "../validate";
import { buildTemplateSpec } from "../workbook-spec";
import {
  PAYROLL_READINESS_DESCRIPTORS,
  READINESS_NAME_MAX,
  payrollReadinessCompensationDescriptor,
  payrollReadinessLaborDescriptor,
  payrollReadinessStaffDescriptor,
} from "./payroll-readiness";

/**
 * The three payroll-readiness templates.
 *
 * Two properties matter more than any individual rule here. First, these templates must carry NO
 * contact PII and no real identifiers — they are filled in weeks before the Stage-M privacy review
 * clears, so a phone column would be a leak with a lead time. Second, their mode-dependent rules
 * must be the SAME rules the wage editor and the attendance form enforce: a template that accepts a
 * shape the real surface rejects teaches the wrong lesson, which is worse than teaching none.
 */

// A fixed "now" so the Cairo-day rule is deterministic. 2026-07-29T21:30Z is already 2026-07-30 in
// Cairo (UTC+3) — the case that catches a surface comparing against the server's UTC day instead.
const CAIRO_NEXT_DAY = new Date("2026-07-29T21:30:00Z");
const CAIRO_SAME_DAY = new Date("2026-07-29T09:00:00Z");

/** Run one row through the real pipeline and return its Arabic reasons. */
function reasonsFor(
  descriptor: (typeof PAYROLL_READINESS_DESCRIPTORS)[number],
  row: Record<string, unknown>,
  now: Date = CAIRO_SAME_DAY,
): string[] {
  return validateRows(descriptor, [row], now).errors.map((e) => e.reason);
}

function columnsWithErrors(
  descriptor: (typeof PAYROLL_READINESS_DESCRIPTORS)[number],
  row: Record<string, unknown>,
  now: Date = CAIRO_SAME_DAY,
): string[] {
  return validateRows(descriptor, [row], now).errors.map((e) => e.column);
}

/**
 * The (column, reason) pairs one row produces — i.e. the exact CELL the reader is sent to, and the
 * exact sentence they read there. Asserted together because these templates are filled in on a
 * spreadsheet: a correct message against the wrong column sends the accountant to re-type a value
 * that was already right, which is the mistake this rehearsal exists to catch, not to commit.
 */
function cellErrorsFor(
  descriptor: (typeof PAYROLL_READINESS_DESCRIPTORS)[number],
  row: Record<string, unknown>,
  now: Date = CAIRO_SAME_DAY,
): { column: string; reason: string }[] {
  return validateRows(descriptor, [row], now).errors.map((e) => ({
    column: e.column,
    reason: e.reason,
  }));
}

const validStaff = {
  name: "عامل تجريبي ١",
  position: "وظيفة تجريبية",
  employmentType: "permanent",
  active: "true",
};
const validComp = { personName: "عامل تجريبي ١", mode: "daily", rate: "150" };
const validLabor = {
  personName: "عامل تجريبي ١",
  workDate: "2026-07-29",
  mode: "daily",
  hours: "8",
};

describe("payroll readiness descriptors — shape of the descriptors themselves", () => {
  it("are all validation-only and owner/accountant only", () => {
    expect(PAYROLL_READINESS_DESCRIPTORS).toHaveLength(3);
    for (const d of PAYROLL_READINESS_DESCRIPTORS) {
      expect(d.validationOnly, d.key).toBe(true);
      expect(d.allowedRoles, d.key).toEqual(["owner", "accountant"]);
    }
  });

  it("declare no contact PII column, in key or in Arabic label", () => {
    const banned = [
      "phone",
      "email",
      "mobile",
      "tel",
      "whatsapp",
      "هاتف",
      "تليفون",
      "جوال",
      "محمول",
      "بريد",
      "واتس",
      "عنوان",
      "رقم قومي",
    ];
    for (const d of PAYROLL_READINESS_DESCRIPTORS) {
      for (const column of d.columns) {
        for (const token of banned) {
          expect(column.key.toLowerCase(), `${d.key}.${column.key}`).not.toContain(token);
          expect(column.labelAr, `${d.key}.${column.labelAr}`).not.toContain(token);
        }
      }
    }
  });

  it("carry no contact PII anywhere in the rendered template either", () => {
    for (const d of PAYROLL_READINESS_DESCRIPTORS) {
      const flat = buildTemplateSpec(d)
        .sheets.flatMap((s) => s.rows.flat())
        .join("\n")
        .toLowerCase();
      for (const token of ["phone", "email", "@", "هاتف", "بريد", "جوال"]) {
        expect(flat, `${d.key} template contains "${token}"`).not.toContain(token);
      }
    }
  });

  it("use obviously synthetic Arabic placeholders for every free-text example", () => {
    const textExamples = PAYROLL_READINESS_DESCRIPTORS.flatMap((d) =>
      d.columns.filter((c) => c.type === "string").map((c) => ({ key: `${d.key}.${c.key}`, example: c.example })),
    );
    expect(textExamples.length).toBeGreaterThan(0);
    for (const { key, example } of textExamples) {
      expect(example, key).toMatch(/تجريب/);
    }
  });

  it("prefills nothing from the database (no table, so no roster ever reaches a template)", () => {
    for (const d of PAYROLL_READINESS_DESCRIPTORS) {
      expect(d.table, d.key).toBeUndefined();
      expect(d.fromRow, d.key).toBeUndefined();
      // Only the header row — the data sheet is empty by construction.
      expect(buildTemplateSpec(d).sheets[1].rows, d.key).toHaveLength(1);
    }
  });
});

describe("staff readiness", () => {
  it("accepts a well-formed synthetic row", () => {
    expect(validateRows(payrollReadinessStaffDescriptor, [validStaff], CAIRO_SAME_DAY).okCount).toBe(1);
  });

  it("requires a non-blank name and position", () => {
    expect(columnsWithErrors(payrollReadinessStaffDescriptor, { ...validStaff, name: "   " })).toEqual([
      "name",
    ]);
    expect(
      columnsWithErrors(payrollReadinessStaffDescriptor, { ...validStaff, position: "" }),
    ).toEqual(["position"]);
  });

  it("bounds the name and the position", () => {
    const long = "ع".repeat(READINESS_NAME_MAX + 1);
    expect(columnsWithErrors(payrollReadinessStaffDescriptor, { ...validStaff, name: long })).toEqual([
      "name",
    ]);
    expect(
      columnsWithErrors(payrollReadinessStaffDescriptor, { ...validStaff, position: long }),
    ).toEqual(["position"]);
  });

  it("restricts employment type to the four the team directory knows", () => {
    for (const type of ["permanent", "seasonal", "daily", "contractor"]) {
      expect(
        validateRows(payrollReadinessStaffDescriptor, [{ ...validStaff, employmentType: type }], CAIRO_SAME_DAY)
          .okCount,
        type,
      ).toBe(1);
    }
    expect(
      columnsWithErrors(payrollReadinessStaffDescriptor, { ...validStaff, employmentType: "intern" }),
    ).toEqual(["employmentType"]);
  });

  it("requires a real boolean for active", () => {
    expect(columnsWithErrors(payrollReadinessStaffDescriptor, { ...validStaff, active: "نعم" })).toEqual([
      "active",
    ]);
    expect(
      validateRows(payrollReadinessStaffDescriptor, [{ ...validStaff, active: "false" }], CAIRO_SAME_DAY)
        .okCount,
    ).toBe(1);
  });
});

describe("compensation readiness — the wage editor's own rules, not a second copy", () => {
  it("accepts a well-formed daily rate", () => {
    expect(validateRows(payrollReadinessCompensationDescriptor, [validComp], CAIRO_SAME_DAY).okCount).toBe(1);
  });

  it("rejects an unknown mode at column coercion, before the shape validator runs", () => {
    expect(reasonsFor(payrollReadinessCompensationDescriptor, { ...validComp, mode: "monthly" })).toContain(
      "قيمة غير مسموح بها",
    );
    // A BLANK mode is caught earlier still, by the required-column check, which short-circuits the
    // row before `crossFieldCheck` ever calls `parseCompensationShape` — so the editor's own
    // COMPENSATION_MODE_INVALID_AR is reported by neither case, and the row is refused regardless.
    expect(reasonsFor(payrollReadinessCompensationDescriptor, { ...validComp, mode: "" })).not.toContain(
      COMPENSATION_MODE_INVALID_AR,
    );
  });

  it("rejects a zero, negative or unbounded rate", () => {
    for (const rate of ["0", "-5", String(COMPENSATION_RATE_MAX + 1)]) {
      expect(reasonsFor(payrollReadinessCompensationDescriptor, { ...validComp, rate }), rate).toContain(
        COMPENSATION_RATE_INVALID_AR,
      );
    }
    expect(
      validateRows(
        payrollReadinessCompensationDescriptor,
        [{ ...validComp, rate: String(COMPENSATION_RATE_MAX) }],
        CAIRO_SAME_DAY,
      ).okCount,
    ).toBe(1);
  });

  it("requires a unit for a piece rate and forbids one everywhere else", () => {
    expect(
      reasonsFor(payrollReadinessCompensationDescriptor, { ...validComp, mode: "piece" }),
    ).toContain(COMPENSATION_UNIT_REQUIRED_AR);
    expect(
      validateRows(
        payrollReadinessCompensationDescriptor,
        [{ ...validComp, mode: "piece", unit: "box" }],
        CAIRO_SAME_DAY,
      ).okCount,
    ).toBe(1);
    expect(reasonsFor(payrollReadinessCompensationDescriptor, { ...validComp, unit: "box" })).toContain(
      COMPENSATION_UNIT_FORBIDDEN_AR,
    );
  });

  it("accepts only the seven piece units", () => {
    for (const unit of ["tree", "box", "crate", "kg", "bucket", "bin", "row"]) {
      expect(
        validateRows(
          payrollReadinessCompensationDescriptor,
          [{ ...validComp, mode: "piece", unit }],
          CAIRO_SAME_DAY,
        ).okCount,
        unit,
      ).toBe(1);
    }
    expect(
      columnsWithErrors(payrollReadinessCompensationDescriptor, {
        ...validComp,
        mode: "piece",
        unit: "sack",
      }),
    ).toEqual(["unit"]);
  });

  it("requires both real contract dates for a seasonal rate, in order and within one leap year", () => {
    const seasonal = { ...validComp, mode: "seasonal" };
    expect(reasonsFor(payrollReadinessCompensationDescriptor, seasonal)).toContain(
      COMPENSATION_SEASON_REQUIRED_AR,
    );
    // An impossible calendar day is rejected as a date, never rolled forward.
    expect(
      columnsWithErrors(payrollReadinessCompensationDescriptor, {
        ...seasonal,
        contractPeriodStart: "2026-02-30",
        contractPeriodEnd: "2026-03-31",
      }),
    ).toEqual(["contractPeriodStart"]);
    expect(
      reasonsFor(payrollReadinessCompensationDescriptor, {
        ...seasonal,
        contractPeriodStart: "2026-04-01",
        contractPeriodEnd: "2026-03-31",
      }),
    ).toContain(COMPENSATION_SEASON_ORDER_AR);
    // 366 inclusive days is the boundary: allowed at exactly 366, refused at 367.
    expect(
      validateRows(
        payrollReadinessCompensationDescriptor,
        [{ ...seasonal, contractPeriodStart: "2028-01-01", contractPeriodEnd: "2028-12-31" }],
        CAIRO_SAME_DAY,
      ).okCount,
      `${COMPENSATION_MAX_SEASON_DAYS} days inclusive`,
    ).toBe(1);
    expect(
      reasonsFor(payrollReadinessCompensationDescriptor, {
        ...seasonal,
        contractPeriodStart: "2026-01-01",
        contractPeriodEnd: "2027-01-02",
      }),
    ).toContain(COMPENSATION_SEASON_TOO_LONG_AR);
  });

  it("blames the contract bound that is actually wrong, not always the start", () => {
    const seasonal = { ...validComp, mode: "seasonal" };
    // A real start with NO end is an end error. (An impossible end like 2026-02-30 never reaches the
    // shape validator at all — the date column refuses to coerce it, and already names its own
    // column — so the missing bound is the case that exercises the split.)
    expect(
      cellErrorsFor(payrollReadinessCompensationDescriptor, {
        ...seasonal,
        contractPeriodStart: "2026-01-01",
      }),
    ).toEqual([{ column: "contractPeriodEnd", reason: COMPENSATION_SEASON_REQUIRED_AR }]);
    // …and a missing START stays on the start.
    expect(
      cellErrorsFor(payrollReadinessCompensationDescriptor, {
        ...seasonal,
        contractPeriodEnd: "2026-03-31",
      }),
    ).toEqual([{ column: "contractPeriodStart", reason: COMPENSATION_SEASON_REQUIRED_AR }]);
    // Neither given: the start is the first bound missing, so it is the one reported.
    expect(cellErrorsFor(payrollReadinessCompensationDescriptor, seasonal)).toEqual([
      { column: "contractPeriodStart", reason: COMPENSATION_SEASON_REQUIRED_AR },
    ]);
    // An inverted pair is attributed to the END — the start is the date the user is sure of.
    expect(
      cellErrorsFor(payrollReadinessCompensationDescriptor, {
        ...seasonal,
        contractPeriodStart: "2026-04-01",
        contractPeriodEnd: "2026-03-31",
      }),
    ).toEqual([{ column: "contractPeriodEnd", reason: COMPENSATION_SEASON_ORDER_AR }]);
    // An over-long span keeps reporting the start (unchanged), and keeps its own sentence.
    expect(
      cellErrorsFor(payrollReadinessCompensationDescriptor, {
        ...seasonal,
        contractPeriodStart: "2026-01-01",
        contractPeriodEnd: "2027-01-02",
      }),
    ).toEqual([{ column: "contractPeriodStart", reason: COMPENSATION_SEASON_TOO_LONG_AR }]);
  });

  it("forbids contract dates on every non-seasonal mode", () => {
    expect(
      reasonsFor(payrollReadinessCompensationDescriptor, {
        ...validComp,
        contractPeriodStart: "2026-01-01",
      }),
    ).toContain(COMPENSATION_SEASON_FORBIDDEN_AR);
    expect(
      reasonsFor(payrollReadinessCompensationDescriptor, {
        ...validComp,
        contractPeriodEnd: "2026-03-31",
      }),
    ).toContain(COMPENSATION_SEASON_FORBIDDEN_AR);
  });

  it("blames the contract bound the user actually filled in on a non-seasonal row", () => {
    // An END alone lands on the END cell. It used to land on `contractPeriodStart` — an empty cell,
    // which told the reader to clear a column they had never typed into.
    expect(
      cellErrorsFor(payrollReadinessCompensationDescriptor, {
        ...validComp,
        contractPeriodEnd: "2026-03-31",
      }),
    ).toEqual([{ column: "contractPeriodEnd", reason: COMPENSATION_SEASON_FORBIDDEN_AR }]);
    // A start — alone, or alongside an end — stays on `contractPeriodStart`.
    expect(
      cellErrorsFor(payrollReadinessCompensationDescriptor, {
        ...validComp,
        contractPeriodStart: "2026-01-01",
      }),
    ).toEqual([{ column: "contractPeriodStart", reason: COMPENSATION_SEASON_FORBIDDEN_AR }]);
    expect(
      cellErrorsFor(payrollReadinessCompensationDescriptor, {
        ...validComp,
        contractPeriodStart: "2026-01-01",
        contractPeriodEnd: "2026-03-31",
      }),
    ).toEqual([{ column: "contractPeriodStart", reason: COMPENSATION_SEASON_FORBIDDEN_AR }]);
  });
});

describe("labor readiness — the attendance form's own rules, not a second copy", () => {
  it("accepts a well-formed daily row", () => {
    expect(validateRows(payrollReadinessLaborDescriptor, [validLabor], CAIRO_SAME_DAY).okCount).toBe(1);
  });

  it("requires positive hours ≤24 for EVERY mode", () => {
    for (const mode of ["hourly", "daily", "piece", "seasonal"]) {
      const base =
        mode === "piece"
          ? { ...validLabor, mode, quantity: "40", unit: "box" }
          : { ...validLabor, mode };
      for (const hours of ["0", "-1", "25"]) {
        expect(reasonsFor(payrollReadinessLaborDescriptor, { ...base, hours }), `${mode}/${hours}`).toContain(
          LABOR_HOURS_AR,
        );
      }
      expect(
        columnsWithErrors(payrollReadinessLaborDescriptor, { ...base, hours: "" }),
        `${mode}/blank`,
      ).toEqual(["hours"]);
      expect(
        validateRows(payrollReadinessLaborDescriptor, [{ ...base, hours: "24" }], CAIRO_SAME_DAY).okCount,
        `${mode}/24`,
      ).toBe(1);
    }
  });

  it("requires a positive bounded quantity + unit for piece rows only", () => {
    const piece = { ...validLabor, mode: "piece" };
    expect(reasonsFor(payrollReadinessLaborDescriptor, piece)).toContain(LABOR_QUANTITY_AR);
    expect(reasonsFor(payrollReadinessLaborDescriptor, { ...piece, quantity: "0" })).toContain(
      LABOR_QUANTITY_AR,
    );
    expect(reasonsFor(payrollReadinessLaborDescriptor, { ...piece, quantity: "200000" })).toContain(
      LABOR_QUANTITY_AR,
    );
    expect(reasonsFor(payrollReadinessLaborDescriptor, { ...piece, quantity: "40" })).toContain(
      LABOR_UNIT_REQUIRED_AR,
    );
    expect(
      reasonsFor(payrollReadinessLaborDescriptor, { ...validLabor, quantity: "40", unit: "box" }),
    ).toContain(LABOR_PIECE_ONLY_AR);
    expect(reasonsFor(payrollReadinessLaborDescriptor, { ...validLabor, unit: "box" })).toContain(
      LABOR_PIECE_ONLY_AR,
    );
  });

  it("blames the piece column the user actually filled in on a non-piece row", () => {
    // Unit alone lands on the UNIT cell. It used to land on `quantity` — an empty cell, which told
    // the reader to fix something they had not written.
    expect(cellErrorsFor(payrollReadinessLaborDescriptor, { ...validLabor, unit: "box" })).toEqual([
      { column: "unit", reason: LABOR_PIECE_ONLY_AR },
    ]);
    // A quantity — alone, or alongside a unit — lands on `quantity`: it is the half the close would
    // have priced, so it is the one to delete.
    expect(cellErrorsFor(payrollReadinessLaborDescriptor, { ...validLabor, quantity: "40" })).toEqual([
      { column: "quantity", reason: LABOR_PIECE_ONLY_AR },
    ]);
    expect(
      cellErrorsFor(payrollReadinessLaborDescriptor, { ...validLabor, quantity: "40", unit: "box" }),
    ).toEqual([{ column: "quantity", reason: LABOR_PIECE_ONLY_AR }]);
  });

  it("refuses a future work date on the CAIRO day, not the server's UTC day", () => {
    // 2026-07-30 is already today in Cairo at 21:30Z on the 29th — so it must be accepted…
    expect(
      validateRows(
        payrollReadinessLaborDescriptor,
        [{ ...validLabor, workDate: "2026-07-30" }],
        CAIRO_NEXT_DAY,
      ).okCount,
    ).toBe(1);
    // …and refused when Cairo is still on the 29th.
    expect(
      reasonsFor(payrollReadinessLaborDescriptor, { ...validLabor, workDate: "2026-07-30" }, CAIRO_SAME_DAY),
    ).toContain(LABOR_DATE_FUTURE_AR);
  });

  it("refuses an impossible calendar day rather than rolling it forward", () => {
    expect(columnsWithErrors(payrollReadinessLaborDescriptor, { ...validLabor, workDate: "2026-02-30" })).toEqual(
      ["workDate"],
    );
  });

  it("bounds an optional note", () => {
    expect(
      validateRows(
        payrollReadinessLaborDescriptor,
        [{ ...validLabor, note: "ملاحظة تجريبية" }],
        CAIRO_SAME_DAY,
      ).okCount,
    ).toBe(1);
    expect(
      columnsWithErrors(payrollReadinessLaborDescriptor, { ...validLabor, note: "م".repeat(301) }),
    ).toEqual(["note"]);
  });

  it("counts a cross-field failure as exactly one bad row, like any other", () => {
    const dry = validateRows(
      payrollReadinessLaborDescriptor,
      [validLabor, { ...validLabor, mode: "piece" }],
      CAIRO_SAME_DAY,
    );
    expect(dry.okCount).toBe(1);
    expect(dry.errorCount).toBe(1);
  });
});

describe("person references fail closed", () => {
  const personColumn = { table: "people", codeColumn: "name", idColumn: "id", activeColumn: "active", activeValue: true };

  it("resolve a unique active name to its id", async () => {
    const rows = validateRows(payrollReadinessLaborDescriptor, [validLabor], CAIRO_SAME_DAY).okRows;
    const resolved = await resolveRefs(payrollReadinessLaborDescriptor, rows, async (spec, codes) => {
      expect(spec).toMatchObject(personColumn);
      expect(codes).toEqual(["عامل تجريبي ١"]);
      return new Map([["عامل تجريبي ١", "person-1"]]);
    });
    expect(resolved.errors).toEqual([]);
    expect(resolved.rows[0].personName).toBe("person-1");
  });

  it("turn an AMBIGUOUS name into a row error and never pick one of the matches", async () => {
    const rows = validateRows(payrollReadinessLaborDescriptor, [validLabor], CAIRO_SAME_DAY).okRows;
    // An ambiguous code is absent from the lookup map — the route's refLookup deletes any code that
    // matched more than one row. The resolver must treat that as "not found", not as "pick either".
    const resolved = await resolveRefs(payrollReadinessLaborDescriptor, rows, async () => new Map());
    expect(resolved.rows).toEqual([]);
    expect(resolved.errors).toEqual([
      { row: 1, column: "personName", reason: "لم يتم العثور على هذا الكود" },
    ]);
  });

  it("do the same on the compensation template", async () => {
    const rows = validateRows(payrollReadinessCompensationDescriptor, [validComp], CAIRO_SAME_DAY).okRows;
    const resolved = await resolveRefs(
      payrollReadinessCompensationDescriptor,
      rows,
      async () => new Map(),
    );
    expect(resolved.rows).toEqual([]);
    expect(resolved.errors.map((e) => e.column)).toEqual(["personName"]);
  });

  it("only ever look up ACTIVE people", () => {
    for (const d of [payrollReadinessCompensationDescriptor, payrollReadinessLaborDescriptor]) {
      const ref = d.columns.find((c) => c.key === "personName")?.ref;
      expect(ref, d.key).toMatchObject({
        table: "people",
        codeColumn: "name",
        activeColumn: "active",
        activeValue: true,
      });
    }
  });
});
