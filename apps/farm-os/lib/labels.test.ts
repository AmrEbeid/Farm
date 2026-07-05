import { describe, it, expect } from "vitest";
import {
  EXPENSE_KIND_AR,
  HARVEST_STAGE_AR,
  OP_STATUS_AR,
  PAYMENT_STATUS_AR,
  REQUEST_STATUS_AR,
  SUBTYPE_AR,
  isExecutableOpStatus,
} from "./labels";

// lib/labels was untested. isExecutableOpStatus backs the fn_execute_operation guard (migration 0057)
// and its UI affordances (/m, /m/execute), so a regression here is a security-relevant bug — a status
// silently becoming "executable". The maps back non-negotiable #2 (Arabic-RTL), where an omission is
// how "pollination" leaked raw English (#282/#289). These tests pin both.

describe("isExecutableOpStatus", () => {
  it.each(["planned", "approved", "reserved", "ready", "in_progress"])(
    "treats active status %s as executable",
    (s) => expect(isExecutableOpStatus(s)).toBe(true),
  );

  it.each(["done", "blocked", "abandoned", "skipped"])(
    "treats terminal status %s as NOT executable",
    (s) => expect(isExecutableOpStatus(s)).toBe(false),
  );

  it("defaults a null/undefined status to executable (the planned default)", () => {
    expect(isExecutableOpStatus(null)).toBe(true);
    expect(isExecutableOpStatus(undefined)).toBe(true);
  });

  it("treats an UNKNOWN status as executable — the precise reason plan_operations.status carries a DB CHECK (migration 0058): an unconstrained typo would otherwise read as executable", () => {
    expect(isExecutableOpStatus("cancled")).toBe(true);
  });
});

describe("OP_STATUS_AR — completeness vs the status vocabulary", () => {
  // Must match the plan_operations.status CHECK set (migration 0058) so every persisted status renders.
  const EXPECTED = [
    "planned",
    "approved",
    "reserved",
    "ready",
    "in_progress",
    "done",
    "blocked",
    "abandoned",
    "skipped",
  ];

  it.each(EXPECTED)("has a non-empty Arabic label for %s", (s) => {
    expect(OP_STATUS_AR[s]).toBeTruthy();
  });

  it("every terminal (non-executable) status is itself a known, labelled op status", () => {
    for (const s of ["done", "blocked", "abandoned", "skipped"]) {
      expect(OP_STATUS_AR[s]).toBeTruthy();
      expect(isExecutableOpStatus(s)).toBe(false);
    }
  });
});

describe("SUBTYPE_AR — completeness (locks in the pollination fix #289 + the operation-vocabulary expansion)", () => {
  // Must match the plan_operations.subtype CHECK set (migration 20260701230000) so every
  // persisted subtype renders with an Arabic label instead of leaking a raw English key.
  const EXPECTED = [
    "fertilization",
    "irrigation",
    "spraying",
    "pollination",
    "inspection",
    "pruning_dethorning",
    "offshoot_mgmt",
    "pollen_collection",
    "bunch_limiting",
    "thinning",
    "bunch_tilting",
    "bagging",
    "pest_scouting",
    "harvest",
    "post_harvest",
  ];

  it.each(EXPECTED)("has a non-empty Arabic label for offerable subtype %s", (s) =>
    expect(SUBTYPE_AR[s]).toBeTruthy(),
  );

  it("includes pollination = تلقيح (the subtype that leaked raw English before #289)", () => {
    expect(SUBTYPE_AR.pollination).toBe("تلقيح");
  });
});

describe("HARVEST_STAGE_AR — completeness (ripening stage, migration 20260701230000)", () => {
  it.each(["khalal", "rutab", "tamar"])("has a non-empty Arabic label for harvest stage %s", (s) =>
    expect(HARVEST_STAGE_AR[s]).toBeTruthy(),
  );
});

describe("EXPENSE_KIND_AR — completeness vs the expenses.kind CHECK", () => {
  // Must match expenses_kind_check / accounts_kind_check (operating|drawing|capex) so every persisted
  // kind renders — and the owner-drawings/opex split (#6) never leaks a raw English key to the UI.
  it.each(["operating", "drawing", "capex"])("has a non-empty Arabic label for kind %s", (k) =>
    expect(EXPENSE_KIND_AR[k]).toBeTruthy(),
  );
});

describe("PAYMENT_STATUS_AR — completeness vs the expenses.payment_status CHECK", () => {
  // Must match expenses_payment_status_check so every persisted status renders instead of leaking a key.
  it.each(["post_paid_unpaid", "paid_from_custody", "paid_by_owner", "cancelled"])(
    "has a non-empty Arabic label for payment status %s",
    (s) => expect(PAYMENT_STATUS_AR[s]).toBeTruthy(),
  );

  it("normalizes cancelled to «ملغى» (pins the ملغي/ملغى drift the map's comment documents)", () => {
    expect(PAYMENT_STATUS_AR.cancelled).toBe("ملغى");
  });
});

describe("REQUEST_STATUS_AR — completeness vs the payment_requests.status CHECK", () => {
  // Must match payment_requests_status_check so every persisted request-lifecycle status renders.
  it.each(["draft", "submitted", "approved_operational", "approved_final", "paid", "closed"])(
    "has a non-empty Arabic label for request status %s",
    (s) => expect(REQUEST_STATUS_AR[s]).toBeTruthy(),
  );
});
