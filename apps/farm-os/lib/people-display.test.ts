// SPEC-0033 R4c — the shared Arabic rendering vocabulary for the two people surfaces.
//
// These helpers are where an absence becomes words. The rules they encode are product rules, not
// formatting taste: an unrecorded value is named as unrecorded (never «٠» and never a bare dash),
// every digit is Arabic-Indic, and no raw English database value ever reaches an Arabic-first page.

import { describe, expect, it } from "vitest";
import { EVENT_TYPE_AR, OP_STATUS_AR, SUBTYPE_AR } from "./labels";
import {
  PEOPLE_FILTER_LABEL,
  employmentTypeLabel,
  eventLabel,
  exactCount,
  operationLinkLabel,
  operationSubtypeLabel,
  plainCount,
  positionLabel,
  statusLabel,
  statusPill,
} from "./people-display";
import { EVENT_STATUSES, OPERATION_STATUSES, PEOPLE_DIRECTORY_FILTERS } from "./people-snapshot-reads";

describe("exact counts render as Arabic-Indic digits without losing precision", () => {
  it("formats an exact count through BigInt, so a bigint beyond 2^53 keeps every digit", () => {
    expect(exactCount("0")).toBe("٠");
    expect(exactCount("12")).toBe("١٢");
    // 2^53 + 1: a JS number would render the wrong last digit here.
    expect(exactCount("9007199254740993")).toContain("٣");
    expect(exactCount("9007199254740993")).toBe(
      new Intl.NumberFormat("ar-EG").format(BigInt("9007199254740993")),
    );
    expect(plainCount(7)).toBe("٧");
  });

  it("never emits a Western digit", () => {
    for (const rendered of [exactCount("1234567"), plainCount(890)]) {
      expect(rendered).not.toMatch(/[0-9]/);
    }
  });
});

describe("an absence is named as an absence", () => {
  it("distinguishes unrecorded from unknown-but-recorded", () => {
    expect(positionLabel(null)).toBe("وظيفة غير مسجلة");
    expect(positionLabel("مشرف")).toBe("مشرف");
    expect(employmentTypeLabel(null)).toBe("غير مسجل");
    expect(employmentTypeLabel("daily")).toBe("يومي");
    // Recorded, but not a value this product knows: that is a different fact from "not recorded".
    expect(employmentTypeLabel("freelance")).toBe("نوع غير معروف");
    expect(operationSubtypeLabel(null)).toBe("عملية غير مصنّفة");
    expect(operationSubtypeLabel("irrigation")).toBe("ري");
    expect(operationSubtypeLabel("teleportation")).toBe("عملية غير معروفة");
  });

  it("never renders a zero or a bare dash for a missing value", () => {
    for (const rendered of [
      positionLabel(null), employmentTypeLabel(null), operationSubtypeLabel(null),
      eventLabel(null, "unmapped_kind"),
    ]) {
      expect(rendered).not.toBe("—");
      expect(rendered).not.toBe("٠");
      expect(rendered).not.toBe("0");
    }
  });
});

describe("no raw English database value reaches an Arabic page", () => {
  it("labels every recorded activity in Arabic, whatever the recorded kind is", () => {
    expect(eventLabel("irrigation", "operation")).toBe("ري");
    expect(eventLabel(null, "inspection")).toBe("تفتيش");
    expect(eventLabel(null, "note")).toBe("ملاحظة");
    // An unmapped subtype falls back to the recorded kind, and an unmapped kind to the generic word
    // — the same fallback the palm/sector 360s already use. Never the raw column value.
    expect(eventLabel("teleportation", "operation")).toBe("عملية");
    expect(eventLabel(null, "something_new")).toBe("نشاط");
    expect(eventLabel("teleportation", "something_new")).toBe("نشاط");
    for (const label of Object.values(EVENT_TYPE_AR)) {
      expect(label).not.toMatch(/[A-Za-z]/);
    }
  });

  it("has an Arabic label for every status either payload can carry", () => {
    for (const status of [...OPERATION_STATUSES, ...EVENT_STATUSES]) {
      expect(OP_STATUS_AR[status], status).toBeTruthy();
      expect(statusLabel(status), status).not.toMatch(/[A-Za-z]/);
    }
  });

  it("has an Arabic label for every filter chip", () => {
    for (const filter of PEOPLE_DIRECTORY_FILTERS) {
      expect(PEOPLE_FILTER_LABEL[filter], filter).toBeTruthy();
      expect(PEOPLE_FILTER_LABEL[filter], filter).not.toMatch(/[A-Za-z]/);
    }
  });

  it("keeps the subtype vocabulary shared, never restated", () => {
    expect(operationSubtypeLabel("pollination")).toBe(SUBTYPE_AR.pollination);
  });
});

describe("a status pill carries meaning, never a verdict the surface cannot support", () => {
  it("maps each recorded status to a tone", () => {
    expect(statusPill("done")).toBe("done");
    expect(statusPill("blocked")).toBe("blocked");
    expect(statusPill("abandoned")).toBe("warning");
    expect(statusPill("skipped")).toBe("warning");
    expect(statusPill("planned")).toBe("draft");
    for (const status of ["approved", "reserved", "ready", "in_progress"] as const) {
      expect(statusPill(status), status).toBe("active");
    }
  });

  it("never claims an operation is late — this surface knows a planned date, not a commitment", () => {
    for (const status of [...OPERATION_STATUSES, ...EVENT_STATUSES]) {
      expect(["draft", "scheduled", "active", "done", "warning", "blocked"]).toContain(statusPill(status));
    }
  });
});

describe("how a person is attached to an operation is stated, not guessed", () => {
  it("says both links when both exist", () => {
    expect(operationLinkLabel(true, true)).toBe("مسؤول عنها وقائد فريقها");
    expect(operationLinkLabel(false, true)).toBe("مسؤول عنها");
    expect(operationLinkLabel(true, false)).toBe("قائد فريقها");
    // Neither flag is the ordinary plain-assignee case, and it says exactly that.
    expect(operationLinkLabel(false, false)).toBe("ضمن فريقها");
  });
});
