// SPEC-0033 R4c — the shared Arabic rendering vocabulary for the people directory and the person
// 360.
//
// One module so the two surfaces can never describe the same colleague differently. Everything here
// is pure: exact count text in, Arabic-Indic display text out. Nothing rounds a number into
// existence, and nothing turns an unrecorded value into a zero or an invented dash — an absence is
// named as an absence («غير مسجلة»), because "we never wrote it down" and "it is none" are
// different facts.
//
// The status/type vocabularies are re-exported from lib/labels.ts rather than restated, so an
// operation is never labelled one way where it is PLANNED and another way on the person's file.

import type { PillStatus } from "@amrebeid/ui";
import { EMP_TYPE_AR, EVENT_TYPE_AR, OP_STATUS_AR, SUBTYPE_AR } from "./labels";
import type {
  EventStatus,
  ExactCountString,
  OperationStatus,
  PeopleDirectoryFilter,
} from "./people-snapshot-reads";

/** One Arabic-Indic integer formatter for both surfaces (docs/CLAUDE.md #2 — no Western digits). */
const ARABIC_INTEGER = new Intl.NumberFormat("ar-EG");

/** Render an exact count. Read as a BigInt so a bigint beyond 2^53 still prints every digit. */
export function exactCount(value: ExactCountString): string {
  return ARABIC_INTEGER.format(BigInt(value));
}

export function plainCount(value: number): string {
  return ARABIC_INTEGER.format(value);
}

/** A recorded employment type. Unrecorded is «غير مسجل»; recorded-but-unknown says so instead. */
export function employmentTypeLabel(value: string | null): string {
  if (value === null) return "غير مسجل";
  return EMP_TYPE_AR[value] ?? "نوع غير معروف";
}

/** A recorded job title, or an honest absence. Never a bare dash. */
export function positionLabel(value: string | null): string {
  return value ?? "وظيفة غير مسجلة";
}

/** A recorded operation subtype, or an honest absence. */
export function operationSubtypeLabel(value: string | null): string {
  if (value === null) return "عملية غير مصنّفة";
  return SUBTYPE_AR[value] ?? "عملية غير معروفة";
}

/**
 * A recorded activity's label. The subtype is the specific fact and wins; otherwise the recorded
 * KIND is used. Neither ever renders raw English on this surface: an unmapped value falls back to
 * the generic «نشاط», the same fallback the palm/sector 360s already use.
 */
export function eventLabel(subtype: string | null, type: string): string {
  if (subtype !== null) return SUBTYPE_AR[subtype] ?? EVENT_TYPE_AR[type] ?? "نشاط";
  return EVENT_TYPE_AR[type] ?? "نشاط";
}

export function statusLabel(value: OperationStatus | EventStatus): string {
  return OP_STATUS_AR[value] ?? value;
}

/**
 * The pill tone for a recorded status. Terminal-but-cancelled reads as a warning, `done` reads as
 * done, and everything still open reads as active work — never as a verdict about whether it is on
 * time, which this surface does not know.
 */
export function statusPill(value: OperationStatus | EventStatus): PillStatus {
  switch (value) {
    case "done":
      return "done";
    case "blocked":
      return "blocked";
    case "abandoned":
    case "skipped":
      return "warning";
    case "planned":
      return "draft";
    default:
      return "active";
  }
}

export const PEOPLE_FILTER_LABEL: Record<PeopleDirectoryFilter, string> = {
  all: "كل الفريق",
  active: "على رأس العمل",
  assigned: "لديهم عمل مفتوح",
};

/** How this person is attached to an operation. Both links at once is one honest sentence. */
export function operationLinkLabel(isLead: boolean, isResponsible: boolean): string {
  if (isLead && isResponsible) return "مسؤول عنها وقائد فريقها";
  if (isResponsible) return "مسؤول عنها";
  if (isLead) return "قائد فريقها";
  return "ضمن فريقها";
}
