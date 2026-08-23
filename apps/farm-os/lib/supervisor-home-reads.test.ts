import { describe, expect, it } from "vitest";
import { SUPERVISOR_HOME_SNAPSHOT_VERSION, parseSupervisorHomeSnapshot } from "./supervisor-home-reads";

const orgId = "11111111-1111-1111-1111-111111111111";
const planId = "22222222-2222-2222-2222-222222222222";
const opId = "33333333-3333-3333-3333-333333333333";
const opId2 = "99999999-9999-9999-9999-999999999999";
const itemId = "44444444-4444-4444-4444-444444444444";
const materialId = "55555555-5555-5555-5555-555555555555";
const personId = "66666666-6666-6666-6666-666666666666";
const crewId = "77777777-7777-7777-7777-777777777777";
const asOf = "2026-08-23";

function work(overrides: Record<string, unknown> = {}) {
  return {
    id: opId, plan_id: planId, plan_type: "weekly", period_start: asOf, subtype: "irrigation",
    status: "planned", planned_at: asOf, ends_on: null, urgency: "today",
    target_type: "sector", target_state: "ok", target_label: "قطاع الاختبار",
    scope_type: "sector", scope_label: "قطاع الاختبار",
    executable: true, blockers: [],
    material_count: "1",
    materials: [{
      id: materialId, item_id: itemId, item_name: "سماد اختبار", qty: "2.50",
      unit: "كجم", item_unit: "كجم",
    }],
    crew_count: "1",
    crew: [{ person_id: crewId, name: "زميل الفريق", is_lead: false }],
    ...overrides,
  };
}

function fixture() {
  return {
    version: SUPERVISOR_HOME_SNAPSHOT_VERSION, org_id: orgId, as_of: asOf, detail_limit: 1,
    authority: { operations: "partial" },
    link: { state: "linked", person_id: personId, person_name: "مشرف اختبار" },
    recorded: {
      due_today: "2", overdue: "1", ready_now: "2", blocked_now: "1",
      unscheduled: "1", upcoming: "1",
    },
    drivers: {
      ready_now: [work({ urgency: "overdue", planned_at: "2026-08-20" })],
      blocked_now: [work({
        id: opId2, subtype: "spraying", executable: false, blockers: ["signoff_missing"],
      })],
      unscheduled: [work({ urgency: "unscheduled", planned_at: null, ends_on: null })],
      upcoming: [work({ urgency: "upcoming", planned_at: "2026-08-30" })],
    },
  };
}

function unlinkedFixture(state: "unlinked" | "ambiguous") {
  return {
    version: SUPERVISOR_HOME_SNAPSHOT_VERSION, org_id: orgId, as_of: asOf, detail_limit: 6,
    authority: { operations: "verified" },
    link: { state, person_id: null, person_name: null },
    recorded: null,
    drivers: null,
  };
}

const parse = (value: unknown) => parseSupervisorHomeSnapshot(value, orgId, asOf);

describe("supervisor home snapshot parser", () => {
  it("parses a bounded, linked snapshot", () => {
    const snapshot = parse(fixture());
    expect(snapshot.link).toEqual({ state: "linked", personId, personName: "مشرف اختبار" });
    expect(snapshot.recorded?.dueToday).toBe("2");
    expect(snapshot.drivers?.readyNow).toHaveLength(1);
    expect(snapshot.drivers?.readyNow[0].materials[0].qty).toBe("2.5");
    expect(snapshot.drivers?.readyNow[0].crew[0].name).toBe("زميل الفريق");
    expect(snapshot.drivers?.blockedNow[0].blockers).toEqual(["signoff_missing"]);
    expect(snapshot.authority.operations).toBe("partial");
  });

  it("keeps exact counts as text rather than widening them to numbers", () => {
    const value = fixture();
    value.recorded.upcoming = "9007199254740993";
    expect(parse(value).recorded?.upcoming).toBe("9007199254740993");
  });

  it.each(["unlinked", "ambiguous"] as const)("returns %s with no counts at all", (state) => {
    const snapshot = parse(unlinkedFixture(state));
    expect(snapshot.link.state).toBe(state);
    expect(snapshot.recorded).toBeNull();
    expect(snapshot.drivers).toBeNull();
  });

  it("rejects an unresolved link that still carries counts", () => {
    const value = unlinkedFixture("unlinked") as Record<string, unknown>;
    value.recorded = { due_today: "0", overdue: "0", ready_now: "0", blocked_now: "0", unscheduled: "0", upcoming: "0" };
    expect(() => parse(value)).toThrow(/must carry no counts/);
  });

  it("rejects a linked state with no identified person", () => {
    const value = fixture();
    value.link.person_name = null as unknown as string;
    expect(() => parse(value)).toThrow(/linked person must be identified/);
  });

  it("rejects today's work that does not reconcile with ready plus blocked", () => {
    const value = fixture();
    value.recorded.blocked_now = "2";
    expect(() => parse(value)).toThrow(/do not reconcile/);
  });

  it("rejects overdue counts with no visible overdue driver", () => {
    const value = fixture();
    value.drivers.ready_now = [work({ urgency: "today" })];
    expect(() => parse(value)).toThrow(/visible overdue drivers contradict/);
  });

  it("rejects more visible overdue drivers than the recorded overdue count", () => {
    const value = fixture();
    value.detail_limit = 2;
    value.recorded.due_today = "1";
    value.recorded.overdue = "1";
    value.recorded.ready_now = "1";
    value.recorded.blocked_now = "1";
    value.drivers.ready_now = [work({ urgency: "overdue", planned_at: "2026-08-20" })];
    value.drivers.blocked_now = [work({
      id: opId2,
      urgency: "overdue",
      planned_at: "2026-08-21",
      subtype: "spraying",
      executable: false,
      blockers: ["signoff_missing"],
    })];
    expect(() => parse(value)).toThrow(/visible overdue drivers contradict/);
  });

  it("requires the independently bounded minimum of recorded overdue work", () => {
    const value = fixture();
    value.detail_limit = 2;
    value.recorded.due_today = "1";
    value.recorded.overdue = "3";
    value.recorded.ready_now = "3";
    value.recorded.blocked_now = "1";
    value.drivers.ready_now = [
      work({ urgency: "overdue", planned_at: "2026-08-20" }),
      work({ id: opId2, urgency: "today" }),
    ];
    value.drivers.blocked_now = [work({
      id: "88888888-8888-8888-8888-888888888888",
      subtype: "spraying",
      executable: false,
      blockers: ["signoff_missing"],
    })];
    expect(() => parse(value)).toThrow(/visible overdue drivers contradict/);
  });

  it("rejects a today row ordered before an overdue row in the same bucket", () => {
    const value = fixture();
    value.detail_limit = 2;
    value.recorded.due_today = "1";
    value.recorded.overdue = "1";
    value.recorded.ready_now = "2";
    value.recorded.blocked_now = "0";
    value.drivers.ready_now = [
      work({ urgency: "today" }),
      work({ id: opId2, urgency: "overdue", planned_at: "2026-08-20" }),
    ];
    value.drivers.blocked_now = [];
    expect(() => parse(value)).toThrow(/overdue drivers must be ordered/);
  });

  it("rejects a blocked operation offered as ready", () => {
    const value = fixture();
    value.drivers.ready_now = [work({ executable: false, blockers: ["unit_mismatch"] })];
    expect(() => parse(value)).toThrow(/offered as ready to record/);
  });

  it("rejects an executable flag that disagrees with its blockers", () => {
    const value = fixture();
    value.drivers.blocked_now = [work({ id: opId2, executable: true, blockers: ["signoff_missing"] })];
    expect(() => parse(value)).toThrow(/executable disagrees with the recorded blockers/);
  });

  it("rejects an unknown blocker code", () => {
    const value = fixture();
    value.drivers.blocked_now = [work({ id: opId2, executable: false, blockers: ["out_of_stock"] })];
    expect(() => parse(value)).toThrow(/unknown blocker code/);
  });

  it("rejects a repeated blocker code", () => {
    const value = fixture();
    value.drivers.blocked_now = [work({
      id: opId2, executable: false, blockers: ["signoff_missing", "signoff_missing"],
    })];
    expect(() => parse(value)).toThrow(/must be distinct/);
  });

  it("rejects a driver row whose urgency does not belong to its bucket", () => {
    const value = fixture();
    value.drivers.upcoming = [work({ urgency: "today" })];
    expect(() => parse(value)).toThrow(/wrong urgency for its bucket/);
  });

  it("rejects dated work placed in the unscheduled bucket", () => {
    const value = fixture();
    value.drivers.unscheduled = [work({ urgency: "unscheduled", planned_at: asOf })];
    expect(() => parse(value)).toThrow(/exactly the undated work/);
  });

  it.each([
    ["ready_now", "ready rows do not match"],
    ["blocked_now", "blocked rows do not match"],
    ["unscheduled", "unscheduled rows do not match"],
    ["upcoming", "upcoming rows do not match"],
  ])("rejects %s rows that exceed their bounded count", (bucket, message) => {
    const value = fixture() as unknown as { drivers: Record<string, unknown[]> };
    value.drivers[bucket] = [];
    expect(() => parse(value)).toThrow(new RegExp(message));
  });

  it("rejects an array longer than the snapshot's own detail limit", () => {
    const value = fixture();
    value.drivers.ready_now = [work({ urgency: "overdue" }), work({ id: opId2, urgency: "overdue" })];
    expect(() => parse(value)).toThrow(/bounded array/);
  });

  it("bounds the nested materials and crew independently", () => {
    const materials = fixture();
    materials.drivers.ready_now = [work({
      urgency: "overdue",
      material_count: "5",
      materials: [materials.drivers.ready_now[0].materials[0], materials.drivers.ready_now[0].materials[0]],
    })];
    expect(() => parse(materials)).toThrow(/bounded array/);

    const crew = fixture();
    crew.drivers.ready_now = [work({ urgency: "overdue", crew_count: "3", crew: [] })];
    expect(() => parse(crew)).toThrow(/crew rows do not match their bounded count/);
  });

  it("keeps a truncated nested sample honest against its exact recorded total", () => {
    const value = fixture();
    value.drivers.ready_now = [work({ urgency: "overdue", material_count: "9" })];
    expect(parse(value).drivers?.readyNow[0].materialCount).toBe("9");
    expect(parse(value).drivers?.readyNow[0].materials).toHaveLength(1);
  });

  it("rejects a foreign organisation, a stale as-of and a version drift", () => {
    const org = fixture();
    org.org_id = "00000000-0000-0000-0000-000000000000";
    expect(() => parse(org)).toThrow(/organization mismatch/);

    const stale = fixture();
    stale.as_of = "2026-08-22";
    expect(() => parse(stale)).toThrow(/as-of mismatch/);

    const version = fixture();
    version.version = "farm-os.supervisor-home.v0";
    expect(() => parse(version)).toThrow(/version mismatch/);
  });

  it("rejects an out-of-range detail limit", () => {
    const value = fixture();
    value.detail_limit = 21;
    expect(() => parse(value)).toThrow(/detail limit is invalid/);
  });

  it("fails closed on an unknown authority status", () => {
    const value = fixture();
    value.authority = { operations: "trusted" };
    expect(() => parse(value)).toThrow(/invalid authority status/);
  });

  it("defaults a missing operations authority to unverified rather than assuming coverage", () => {
    const value = fixture() as unknown as { authority: Record<string, unknown> };
    value.authority = {};
    expect(parse(value).authority.operations).toBe("unverified");
  });

  it("rejects an invalid target state and an unlabelled unrecognised target type", () => {
    const state = fixture();
    state.drivers.upcoming = [work({ urgency: "upcoming", planned_at: "2026-08-30", target_state: "maybe" })];
    expect(() => parse(state)).toThrow(/invalid target state/);

    const type = fixture();
    type.drivers.upcoming = [work({
      urgency: "upcoming", planned_at: "2026-08-30", target_type: "district", target_state: "ok",
    })];
    expect(() => parse(type)).toThrow(/unrecognized target type is not labelled as such/);
  });

  it("rejects a non-decimal quantity and a non-count total", () => {
    const qty = fixture();
    qty.drivers.upcoming = [work({
      urgency: "upcoming", planned_at: "2026-08-30",
      materials: [{ id: materialId, item_id: itemId, item_name: "سماد", qty: "كثير", unit: "كجم", item_unit: "كجم" }],
    })];
    expect(() => parse(qty)).toThrow(/must be decimal text/);

    const total = fixture();
    total.recorded.upcoming = "-1";
    expect(() => parse(total)).toThrow(/must be exact count text/);
  });
});
