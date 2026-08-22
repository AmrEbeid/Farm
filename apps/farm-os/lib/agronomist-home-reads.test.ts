import { describe, expect, it } from "vitest";
import { AGRONOMIST_HOME_SNAPSHOT_VERSION, parseAgronomistHomeSnapshot } from "./agronomist-home-reads";

const orgId = "11111111-1111-1111-1111-111111111111";
const planId = "22222222-2222-2222-2222-222222222222";
const opId = "33333333-3333-3333-3333-333333333333";
const itemId = "44444444-4444-4444-4444-444444444444";
const trapId = "55555555-5555-5555-5555-555555555555";
const checkId = "66666666-6666-6666-6666-666666666666";
const materialId = "77777777-7777-7777-7777-777777777777";
const personId = "88888888-8888-8888-8888-888888888888";
const opId2 = "99999999-9999-9999-9999-999999999999";
const trapId2 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const asOf = "2026-08-23";

function operation() {
  return {
    id: opId, plan_id: planId, plan_type: "weekly", period_start: asOf, subtype: "spraying",
    status: "planned", planned_at: asOf, ends_on: null,
  };
}

function fixture() {
  return {
    version: AGRONOMIST_HOME_SNAPSHOT_VERSION, org_id: orgId, as_of: asOf, detail_limit: 1,
    authority: { operations: "partial" },
    recorded: { pending_signoffs: "3", due_today: "2", overdue: "1", trap_followups: "4" },
    drivers: {
      pending_signoffs: [{
        ...operation(),
        material_count: "1",
        materials: [{
          id: materialId, item_id: itemId, item_name: "مبيد اختبار", qty: "2.50", unit: "لتر",
          target_pest: "سوسة النخيل", apc_registration_ref: "APC-2026-001",
          rei_hours: "12.0", phi_days: "7", target_zone: "bunch",
          applicator_person_id: personId, applicator_name: "مهندس اختبار",
        }],
      }],
      due_operations: [{ ...operation(), urgency: "overdue" }],
      trap_followups: [{
        id: trapId, code: "T-1", label: "مصيدة ١", installed_at: "2026-01-01",
        lure_changed_at: null, last_checked_at: null,
        days_since_check: "234", days_since_lure_change: "234",
        overdue_check: true, needs_lure_change: true,
      }],
      blocked_checks: [{ id: checkId, plan_id: planId, plan_type: "weekly", period_start: asOf, kind: "weather" }],
    },
  };
}

function fixtureAtLimitTwo() {
  const value = structuredClone(fixture());
  value.detail_limit = 2;
  value.drivers.pending_signoffs.push({
    ...structuredClone(value.drivers.pending_signoffs[0]),
    id: opId2,
  });
  value.drivers.due_operations.push({
    ...structuredClone(value.drivers.due_operations[0]),
    id: opId2,
    urgency: "today",
  });
  value.drivers.trap_followups.push({
    ...structuredClone(value.drivers.trap_followups[0]),
    id: trapId2,
  });
  return value;
}

describe("parseAgronomistHomeSnapshot", () => {
  it("keeps recorded counts exact text and quantities decimal text", () => {
    const parsed = parseAgronomistHomeSnapshot(fixture(), orgId, asOf);
    expect(parsed.recorded).toEqual({
      pendingSignoffs: "3", dueToday: "2", overdue: "1", trapFollowups: "4",
    });
    expect(parsed.drivers.pendingSignoffs[0].materials[0].qty).toBe("2.5");
    expect(parsed.drivers.pendingSignoffs[0].materials[0].reiHours).toBe("12");
    expect(parsed.drivers.pendingSignoffs[0].materials[0].phiDays).toBe("7");
    expect(parsed.drivers.pendingSignoffs[0].materials[0].targetZone).toBe("bunch");
    expect(parsed.drivers.pendingSignoffs[0].materialCount).toBe("1");
    expect(parsed.drivers.dueOperations[0].urgency).toBe("overdue");
    expect(parsed.drivers.trapFollowups[0].daysSinceCheck).toBe(234);
    expect(parsed.drivers.blockedChecks[0].kind).toBe("weather");
  });

  it("keeps exact counts visible while the operations source is only partial", () => {
    const parsed = parseAgronomistHomeSnapshot(fixture(), orgId, asOf);
    expect(parsed.authority.operations).toBe("partial");
    expect(parsed.recorded.pendingSignoffs).toBe("3");
  });

  it("treats a missing APC reference as missing, never as a validity claim", () => {
    const missing = fixture();
    (missing.drivers.pending_signoffs[0].materials[0] as Record<string, unknown>).apc_registration_ref = null;
    const parsed = parseAgronomistHomeSnapshot(missing, orgId, asOf);
    expect(parsed.drivers.pendingSignoffs[0].materials[0].apcRegistrationRef).toBeNull();
  });

  it("defaults an absent operations authority to unverified", () => {
    const absent = { ...fixture(), authority: {} };
    expect(parseAgronomistHomeSnapshot(absent, orgId, asOf).authority.operations).toBe("unverified");
  });

  it("fails closed on identity, version, dates, counts and authority", () => {
    expect(() => parseAgronomistHomeSnapshot({ ...fixture(), version: "farm-os.agronomist-home.v2" }, orgId, asOf))
      .toThrow(/version mismatch/);
    expect(() => parseAgronomistHomeSnapshot({ ...fixture(), org_id: "22222222-2222-2222-2222-222222222222" }, orgId, asOf))
      .toThrow(/organization mismatch/);
    expect(() => parseAgronomistHomeSnapshot({ ...fixture(), as_of: "2026-02-30" }, orgId, asOf))
      .toThrow(/calendar date/);
    expect(() => parseAgronomistHomeSnapshot({ ...fixture(), as_of: "2026-08-22" }, orgId, asOf))
      .toThrow(/as-of mismatch/);
    const badCount = fixture();
    badCount.recorded.overdue = "1.5";
    expect(() => parseAgronomistHomeSnapshot(badCount, orgId, asOf)).toThrow(/exact count text/);
    expect(() => parseAgronomistHomeSnapshot({ ...fixture(), authority: { operations: "trusted" } }, orgId, asOf))
      .toThrow(/authority status/);
    expect(() => parseAgronomistHomeSnapshot({ ...fixture(), detail_limit: 21 }, orgId, asOf))
      .toThrow(/detail limit/);
  });

  it("bounds every driver array independently, including nested materials", () => {
    const limit = fixture().detail_limit;
    for (const key of ["pending_signoffs", "due_operations", "trap_followups", "blocked_checks"] as const) {
      const unbounded = fixture();
      const rows = unbounded.drivers[key] as unknown[];
      unbounded.drivers[key] = Array.from({ length: limit + 1 }, () => rows[0]) as never;
      expect(() => parseAgronomistHomeSnapshot(unbounded, orgId, asOf)).toThrow(/bounded array/);
    }
    const nested = fixture();
    const material = nested.drivers.pending_signoffs[0].materials[0];
    nested.drivers.pending_signoffs[0].materials = Array.from({ length: limit + 1 }, () => material);
    expect(() => parseAgronomistHomeSnapshot(nested, orgId, asOf)).toThrow(/materials must be a bounded array/);
  });

  it("requires material rows to match the exact count up to the bound", () => {
    const value = fixture();
    value.drivers.pending_signoffs[0].material_count = "0";
    expect(() => parseAgronomistHomeSnapshot(value, orgId, asOf)).toThrow(/material rows do not match/);

    const truncated = fixtureAtLimitTwo();
    truncated.drivers.pending_signoffs[0].material_count = "2";
    expect(() => parseAgronomistHomeSnapshot(truncated, orgId, asOf)).toThrow(/material rows do not match/);
  });

  it("requires driver rows to match exact counts up to the independent bounds", () => {
    const pending = fixture();
    pending.recorded.pending_signoffs = "0";
    expect(() => parseAgronomistHomeSnapshot(pending, orgId, asOf)).toThrow(/pending rows do not match/);

    const pendingTruncated = fixtureAtLimitTwo();
    pendingTruncated.drivers.pending_signoffs.pop();
    expect(() => parseAgronomistHomeSnapshot(pendingTruncated, orgId, asOf)).toThrow(/pending rows do not match/);

    const due = fixture();
    due.recorded.overdue = "0";
    expect(() => parseAgronomistHomeSnapshot(due, orgId, asOf)).toThrow(/overdue-first bounded counts/);

    const dueTruncated = fixtureAtLimitTwo();
    dueTruncated.drivers.due_operations.pop();
    expect(() => parseAgronomistHomeSnapshot(dueTruncated, orgId, asOf)).toThrow(/overdue-first bounded counts/);

    const trap = fixture();
    trap.recorded.trap_followups = "0";
    expect(() => parseAgronomistHomeSnapshot(trap, orgId, asOf)).toThrow(/trap rows do not match/);

    const trapTruncated = fixtureAtLimitTwo();
    trapTruncated.drivers.trap_followups.pop();
    expect(() => parseAgronomistHomeSnapshot(trapTruncated, orgId, asOf)).toThrow(/trap rows do not match/);
  });

  it("rejects a trap driver that does not actually need follow-up", () => {
    const value = fixture();
    value.drivers.trap_followups[0].overdue_check = false;
    value.drivers.trap_followups[0].needs_lure_change = false;
    expect(() => parseAgronomistHomeSnapshot(value, orgId, asOf)).toThrow(/no follow-up flag/);
  });

  it("rejects malformed identifiers, urgencies and trap flags", () => {
    const badId = fixture();
    badId.drivers.due_operations[0].id = "op-1";
    expect(() => parseAgronomistHomeSnapshot(badId, orgId, asOf)).toThrow(/must be a UUID/);
    const badUrgency = fixture();
    badUrgency.drivers.due_operations[0].urgency = "unscheduled";
    expect(() => parseAgronomistHomeSnapshot(badUrgency, orgId, asOf)).toThrow(/urgency/);
    const badFlag = fixture();
    (badFlag.drivers.trap_followups[0] as unknown as Record<string, unknown>).overdue_check = "true";
    expect(() => parseAgronomistHomeSnapshot(badFlag, orgId, asOf)).toThrow(/must be boolean/);
    const badDays = fixture();
    badDays.drivers.trap_followups[0].days_since_check = "12.5";
    expect(() => parseAgronomistHomeSnapshot(badDays, orgId, asOf)).toThrow(/day-count text/);
    const badZone = fixture();
    badZone.drivers.pending_signoffs[0].materials[0].target_zone = "fruit";
    expect(() => parseAgronomistHomeSnapshot(badZone, orgId, asOf)).toThrow(/target zone/);
  });
});
