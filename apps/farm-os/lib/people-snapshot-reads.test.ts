// SPEC-0033 R4c — the people directory / person 360 parsers.
//
// These tests exist to prove the things a component must never be trusted to do: refuse a payload
// whose counts do not reconcile with each other or with its own rows, refuse a sample that is not
// the set its total describes, and refuse any contact PII, auth identity, wage or money key however
// deeply it is nested. A parser that quietly accepts an incoherent payload is worse than no parser —
// it launders a wrong workload figure into a work-assignment decision.

import { describe, expect, it } from "vitest";
import {
  PEOPLE_DIRECTORY_SNAPSHOT_VERSION,
  PERSON_SNAPSHOT_VERSION,
  canWritePeople,
  isPeopleDirectoryFilter,
  isOpenRecordedStatus,
  parsePeopleDirectoryFilter,
  parsePeopleDirectorySnapshot,
  parsePersonSnapshot,
  type PeopleDirectoryFilter,
} from "./people-snapshot-reads";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "99999999-9999-4999-8999-999999999999";
const MANAGER = "22222222-2222-4222-8222-222222222221";
const LEAD = "22222222-2222-4222-8222-222222222222";
const WORKER = "22222222-2222-4222-8222-222222222223";
const IDLE = "22222222-2222-4222-8222-222222222224";
const OP_A = "33333333-3333-4333-8333-333333333331";
const OP_B = "33333333-3333-4333-8333-333333333332";
const PLAN = "44444444-4444-4444-8444-444444444441";
const EVENT_A = "55555555-5555-4555-8555-555555555551";
const EVENT_B = "55555555-5555-4555-8555-555555555552";

type Row = Record<string, unknown>;

/** Clone a payload and replace one value at a dotted/indexed path, so a case edits ONE fact. */
function withPath(base: Row, path: string, value: unknown): Row {
  const clone = structuredClone(base) as Row;
  const keys = path.split(".");
  let node: Record<string, unknown> = clone;
  for (const key of keys.slice(0, -1)) {
    node = node[key] as Record<string, unknown>;
  }
  node[keys[keys.length - 1]] = value;
  return clone;
}

function withoutKey(base: Row, path: string): Row {
  const clone = structuredClone(base) as Row;
  const keys = path.split(".");
  let node: Record<string, unknown> = clone;
  for (const key of keys.slice(0, -1)) {
    node = node[key] as Record<string, unknown>;
  }
  delete node[keys[keys.length - 1]];
  return clone;
}

// ── directory fixtures ────────────────────────────────────────────────────────────────────────

function directoryRow(overrides: Row = {}): Row {
  return {
    person_id: LEAD,
    name: "قائد الوردية",
    position: "مشرف",
    employment_type: "daily",
    active: true,
    manager_id: MANAGER,
    manager_name: "مدير الفريق",
    open_operations: "2",
    ...overrides,
  };
}

function directoryPayload(overrides: Row = {}): Row {
  return {
    version: PEOPLE_DIRECTORY_SNAPSHOT_VERSION,
    org_id: ORG,
    query: null,
    filter: "all",
    limit: 20,
    offset: 0,
    can_write: false,
    authority: { operations: "partial" },
    counts: {
      total_people: "3",
      query_total: "3",
      matching: "3",
      active: "2",
      inactive: "1",
      assigned: "1",
    },
    rows: [
      directoryRow(),
      directoryRow({ person_id: MANAGER, name: "مدير الفريق", position: "مدير المزرعة", employment_type: "permanent", manager_id: null, manager_name: null, open_operations: "0" }),
      directoryRow({ person_id: WORKER, name: "عامل غير نشط", position: null, employment_type: null, active: false, open_operations: "0" }),
    ],
    ...overrides,
  };
}

const DIRECTORY_EXPECTATION = {
  orgId: ORG,
  query: null,
  filter: "all" as PeopleDirectoryFilter,
  limit: 20,
  offset: 0,
  canWrite: false,
};

function parseDirectory(payload: unknown, overrides: Partial<typeof DIRECTORY_EXPECTATION> = {}) {
  return parsePeopleDirectorySnapshot(payload, { ...DIRECTORY_EXPECTATION, ...overrides });
}

// ── person fixtures ───────────────────────────────────────────────────────────────────────────

function personPayload(overrides: Row = {}): Row {
  return {
    version: PERSON_SNAPSHOT_VERSION,
    org_id: ORG,
    person_id: LEAD,
    limits: { operations: 10, performed_events: 8, assigned_events: 8, direct_reports: 10 },
    authority: { operations: "partial" },
    person: {
      name: "قائد الوردية",
      position: "مشرف",
      employment_type: "daily",
      active: true,
      manager_id: MANAGER,
      manager_name: "مدير الفريق",
    },
    operations: {
      total: "3",
      open_total: "2",
      rows: [
        {
          plan_op_id: OP_A,
          plan_id: PLAN,
          subtype: "irrigation",
          status: "planned",
          planned_at: "2026-08-24",
          ends_on: null,
          is_lead: false,
          is_responsible: true,
        },
        {
          plan_op_id: OP_B,
          plan_id: PLAN,
          subtype: "pollination",
          status: "ready",
          planned_at: null,
          ends_on: null,
          is_lead: true,
          is_responsible: true,
        },
      ],
    },
    performed_events: {
      total: "1",
      rows: [
        {
          event_id: EVENT_A,
          type: "operation",
          subtype: "irrigation",
          status: "done",
          occurred_at: "2026-08-22T06:00:00+00:00",
          notes: "رية كاملة",
        },
      ],
    },
    assigned_events: {
      total: "2",
      open_total: "1",
      rows: [
        {
          event_id: EVENT_B,
          type: "operation",
          subtype: "spraying",
          status: "in_progress",
          occurred_at: "2026-08-23T06:00:00+00:00",
          notes: null,
        },
        {
          event_id: EVENT_A,
          type: "operation",
          subtype: "bagging",
          status: "done",
          occurred_at: "2026-08-19T06:00:00+00:00",
          notes: null,
        },
      ],
    },
    direct_reports: {
      total: "2",
      active_total: "1",
      rows: [
        { person_id: WORKER, name: "عامل مسند", position: "عامل حقل", employment_type: "seasonal", active: true },
        { person_id: IDLE, name: "عامل غير نشط", position: null, employment_type: null, active: false },
      ],
    },
    ...overrides,
  };
}

const PERSON_EXPECTATION = {
  orgId: ORG,
  personId: LEAD,
  operationLimit: 10,
  performedLimit: 8,
  assignedLimit: 8,
  reportLimit: 10,
};

function parsePerson(payload: unknown, overrides: Partial<typeof PERSON_EXPECTATION> = {}) {
  return parsePersonSnapshot(payload, { ...PERSON_EXPECTATION, ...overrides });
}

// ── vocabulary ────────────────────────────────────────────────────────────────────────────────

describe("the people vocabulary", () => {
  it("accepts only the three real directory filters", () => {
    expect(isPeopleDirectoryFilter("all")).toBe(true);
    expect(isPeopleDirectoryFilter("active")).toBe(true);
    expect(isPeopleDirectoryFilter("assigned")).toBe(true);
    expect(isPeopleDirectoryFilter("planned")).toBe(false);
    expect(parsePeopleDirectoryFilter("nonsense")).toBe("all");
    expect(parsePeopleDirectoryFilter(undefined)).toBe("all");
    expect(parsePeopleDirectoryFilter("assigned")).toBe("assigned");
  });

  it("treats open as NONTERMINAL, never as the literal planned", () => {
    for (const status of ["planned", "approved", "reserved", "ready", "in_progress"]) {
      expect(isOpenRecordedStatus(status), status).toBe(true);
    }
    for (const status of ["done", "blocked", "abandoned", "skipped"]) {
      expect(isOpenRecordedStatus(status), status).toBe(false);
    }
  });

  it("maps exactly the people.write roles to the onboarding capability", () => {
    expect(canWritePeople("owner")).toBe(true);
    expect(canWritePeople("farm_manager")).toBe(true);
    for (const role of ["agri_engineer", "accountant", "supervisor", "storekeeper"] as const) {
      expect(canWritePeople(role), role).toBe(false);
    }
  });
});

// ── directory parser ──────────────────────────────────────────────────────────────────────────

describe("the people directory parser", () => {
  it("reads a coherent page", () => {
    const snapshot = parseDirectory(directoryPayload());
    expect(snapshot.counts.totalPeople).toBe("3");
    expect(snapshot.rows).toHaveLength(3);
    expect(snapshot.rows[0].openOperations).toBe("2");
    expect(snapshot.rows[0].managerName).toBe("مدير الفريق");
    expect(snapshot.rows[1].managerId).toBeNull();
    expect(snapshot.rows[2].position).toBeNull();
    expect(snapshot.managerOptions).toBeNull();
  });

  it("refuses a version, organization or filter it did not ask for", () => {
    expect(() => parseDirectory(withPath(directoryPayload(), "version", "farm-os.people-directory.v2")))
      .toThrow(/version mismatch/);
    expect(() => parseDirectory(withPath(directoryPayload(), "org_id", OTHER_ORG)))
      .toThrow(/organization mismatch/);
    expect(() => parseDirectory(withPath(directoryPayload(), "filter", "nonsense")))
      .toThrow(/unknown directory filter/);
  });

  it("refuses a payload built for different request arguments", () => {
    expect(() => parseDirectory(withPath(directoryPayload(), "limit", 10)))
      .toThrow(/request arguments mismatch/);
    expect(() => parseDirectory(withPath(directoryPayload(), "offset", 20)))
      .toThrow(/request arguments mismatch/);
    expect(() => parseDirectory(withPath(directoryPayload(), "query", "عامل")))
      .toThrow(/request arguments mismatch/);
  });

  it("refuses an unexpected key anywhere, at any nesting level", () => {
    expect(() => parseDirectory(withPath(directoryPayload(), "extra", 1)))
      .toThrow(/root has unexpected keys/);
    expect(() => parseDirectory(withPath(directoryPayload(), "counts.extra", "1")))
      .toThrow(/counts has unexpected keys/);
    expect(() => parseDirectory(withPath(directoryPayload(), "rows.0.extra", "1")))
      .toThrow(/directory row has unexpected keys/);
  });

  it("refuses a missing key rather than reading it as an absent fact", () => {
    expect(() => parseDirectory(withoutKey(directoryPayload(), "counts.assigned")))
      .toThrow(/assigned must be text/);
    expect(() => parseDirectory(withoutKey(directoryPayload(), "rows.0.open_operations")))
      .toThrow(/open_operations must be text/);
    expect(() => parseDirectory(withoutKey(directoryPayload(), "rows.0.active")))
      .toThrow(/active must be a boolean/);
  });

  it("refuses a malformed value even when the key is present", () => {
    expect(() => parseDirectory(withPath(directoryPayload(), "counts.total_people", 3)))
      .toThrow(/must be text/);
    expect(() => parseDirectory(withPath(directoryPayload(), "counts.total_people", "3.0")))
      .toThrow(/exact count text/);
    expect(() => parseDirectory(withPath(directoryPayload(), "counts.total_people", "-1")))
      .toThrow(/exact count text/);
    expect(() => parseDirectory(withPath(directoryPayload(), "rows.0.person_id", "not-a-uuid")))
      .toThrow(/must be a UUID/);
    expect(() => parseDirectory(withPath(directoryPayload(), "rows.0.active", "true")))
      .toThrow(/must be a boolean/);
    expect(() => parseDirectory(withPath(directoryPayload(), "rows.0.name", "  ")))
      .toThrow(/name must be text/);
  });

  it("refuses counts that do not reconcile with each other", () => {
    expect(() => parseDirectory(withPath(directoryPayload(), "counts.active", "3")))
      .toThrow(/partition the searched people exactly/);
    expect(() => parseDirectory(withPath(directoryPayload(), "counts.total_people", "2")))
      .toThrow(/more people than the organization has/);
    expect(() => parseDirectory(withPath(directoryPayload(), "counts.assigned", "9")))
      .toThrow(/more people are assigned than the search matched/);
  });

  it("refuses a page total that contradicts the chip that selected it", () => {
    const payload = directoryPayload({
      filter: "active",
      counts: { total_people: "3", query_total: "3", matching: "3", active: "2", inactive: "1", assigned: "1" },
      rows: [directoryRow(), directoryRow({ person_id: MANAGER, name: "مدير الفريق", manager_id: null, manager_name: null, open_operations: "0" })],
    });
    expect(() => parseDirectory(payload, { filter: "active" }))
      .toThrow(/contradicts its own filter count/);
  });

  it("refuses a page whose length does not match its exact total, limit and offset", () => {
    expect(() => parseDirectory(withPath(directoryPayload(), "counts.matching", "2")))
      .toThrow(/contradicts its own filter count/);
    const shortPage = structuredClone(directoryPayload()) as Row;
    (shortPage.rows as Row[]).pop();
    expect(() => parseDirectory(shortPage))
      .toThrow(/does not match its exact total, limit and offset/);
  });

  it("refuses a page longer than the limit it was asked for", () => {
    const payload = directoryPayload({ limit: 2 });
    expect(() => parseDirectory(payload, { limit: 2 })).toThrow(/rows must be a bounded array/);
  });

  it("refuses a repeated person and an order that is not active first", () => {
    expect(() => parseDirectory(withPath(directoryPayload(), "rows.1.person_id", LEAD)))
      .toThrow(/must not repeat a row/);
    const misordered = directoryPayload({
      rows: [
        directoryRow({ person_id: WORKER, name: "عامل غير نشط", active: false, open_operations: "0" }),
        directoryRow(),
        directoryRow({ person_id: MANAGER, name: "مدير الفريق", manager_id: null, manager_name: null, open_operations: "0" }),
      ],
    });
    expect(() => parseDirectory(misordered)).toThrow(/not ordered active first/);
  });

  it("refuses a filtered page that contains a row outside its own filter", () => {
    const activePage = directoryPayload({
      filter: "active",
      counts: { total_people: "3", query_total: "3", matching: "2", active: "2", inactive: "1", assigned: "1" },
      rows: [
        directoryRow(),
        directoryRow({ person_id: WORKER, name: "عامل غير نشط", active: false, open_operations: "0" }),
      ],
    });
    expect(() => parseDirectory(activePage, { filter: "active" }))
      .toThrow(/contains an inactive person/);

    const assignedPage = directoryPayload({
      filter: "assigned",
      counts: { total_people: "3", query_total: "3", matching: "1", active: "2", inactive: "1", assigned: "1" },
      rows: [directoryRow({ open_operations: "0" })],
    });
    expect(() => parseDirectory(assignedPage, { filter: "assigned" }))
      .toThrow(/contains a person with no open operation/);
  });

  it("refuses half a manager reference — a dangling id or a nameless name", () => {
    expect(() => parseDirectory(withPath(directoryPayload(), "rows.0.manager_name", null)))
      .toThrow(/manager id without a name/);
    expect(() => parseDirectory(withPath(directoryPayload(), "rows.0.manager_id", null)))
      .toThrow(/manager id without a name/);
  });

  it("requires the manager option list for a writer, and refuses it for everyone else", () => {
    const writable = directoryPayload({
      can_write: true,
      manager_options: [
        { person_id: MANAGER, name: "مدير الفريق" },
        { person_id: LEAD, name: "قائد الوردية" },
      ],
    });
    const snapshot = parseDirectory(writable, { canWrite: true });
    expect(snapshot.managerOptions).toHaveLength(2);
    expect(parseDirectory(directoryPayload({ can_write: true, manager_options: null }), { canWrite: true })
      .managerOptions).toBeNull();

    expect(() => parseDirectory(withoutKey(writable, "manager_options"), { canWrite: true }))
      .toThrow(/root is missing keys: manager_options/);
    // A payload that hands the list to a caller who cannot onboard is a leak, and is refused too.
    expect(() => parseDirectory(directoryPayload({ manager_options: [] })))
      .toThrow(/root has unexpected keys: manager_options/);
    expect(() => parseDirectory(withPath(writable, "can_write", false), { canWrite: true }))
      .toThrow(/write capability mismatch/);
  });

  it("refuses a manager option list beyond the published ceiling, or one that repeats a person", () => {
    const options = Array.from({ length: 501 }, (unused, index) => ({
      person_id: `22222222-2222-4222-8222-${String(index).padStart(12, "0")}`,
      name: `زميل ${index}`,
    }));
    expect(() => parseDirectory(directoryPayload({ can_write: true, manager_options: options }), { canWrite: true }))
      .toThrow(/manager options must be a bounded array/);
    expect(() => parseDirectory(
      directoryPayload({
        can_write: true,
        manager_options: [{ person_id: MANAGER, name: "أ" }, { person_id: MANAGER, name: "ب" }],
      }),
      { canWrite: true },
    )).toThrow(/manager options must not repeat a row/);
  });

  it("refuses contact PII, an auth identity, a wage or a money key however deeply nested", () => {
    for (const [path, value] of [
      ["rows.0.phone", "01000000000"],
      ["rows.0.email", "x@example.test"],
      ["rows.0.user_id", MANAGER],
      ["rows.0.rate", "120"],
      ["rows.0.est_cost", "500"],
      ["counts.amount", "1"],
    ] as const) {
      expect(() => parseDirectory(withPath(directoryPayload(), path, value)), path)
        .toThrow(/the payload carries/);
    }
  });

  it("refuses an authority status it does not recognise", () => {
    expect(() => parseDirectory(withPath(directoryPayload(), "authority.operations", "probably")))
      .toThrow(/invalid authority status/);
    expect(() => parseDirectory(withPath(directoryPayload(), "authority", { inventory: "verified" })))
      .toThrow(/authority has unexpected keys/);
  });

  it("accepts an empty page past the end without inventing rows", () => {
    const empty = directoryPayload({ offset: 20, rows: [] });
    const snapshot = parseDirectory(empty, { offset: 20 });
    expect(snapshot.rows).toHaveLength(0);
    expect(snapshot.counts.matching).toBe("3");
  });
});

// ── person parser ─────────────────────────────────────────────────────────────────────────────

describe("the person 360 parser", () => {
  it("reads a coherent person file", () => {
    const snapshot = parsePerson(personPayload());
    expect(snapshot).not.toBeNull();
    expect(snapshot!.person.name).toBe("قائد الوردية");
    expect(snapshot!.operations.total).toBe("3");
    expect(snapshot!.operations.openTotal).toBe("2");
    expect(snapshot!.operations.rows).toHaveLength(2);
    expect(snapshot!.operations.rows[1].isLead).toBe(true);
    expect(snapshot!.performedEvents.total).toBe("1");
    expect(snapshot!.assignedEvents.openTotal).toBe("1");
    expect(snapshot!.directReports.activeTotal).toBe("1");
  });

  it("reads a missing or foreign person as not found, never as an empty person", () => {
    expect(parsePersonSnapshot(null, PERSON_EXPECTATION)).toBeNull();
  });

  it("refuses a payload bound to another person, organization or request", () => {
    expect(() => parsePerson(withPath(personPayload(), "person_id", WORKER)))
      .toThrow(/person mismatch/);
    expect(() => parsePerson(withPath(personPayload(), "org_id", OTHER_ORG)))
      .toThrow(/organization mismatch/);
    expect(() => parsePerson(withPath(personPayload(), "limits.operations", 5)))
      .toThrow(/request arguments mismatch/);
  });

  it("refuses an unexpected or missing key at any nesting level", () => {
    expect(() => parsePerson(withPath(personPayload(), "person.extra", 1)))
      .toThrow(/person has unexpected keys/);
    expect(() => parsePerson(withPath(personPayload(), "operations.rows.0.extra", 1)))
      .toThrow(/operation row has unexpected keys/);
    expect(() => parsePerson(withPath(personPayload(), "performed_events.open_total", "0")))
      .toThrow(/performed_events has unexpected keys/);
    expect(() => parsePerson(withoutKey(personPayload(), "assigned_events.open_total")))
      .toThrow(/open_total must be text/);
    expect(() => parsePerson(withoutKey(personPayload(), "direct_reports.active_total")))
      .toThrow(/active_total must be text/);
  });

  it("refuses a terminal operation inside the OPEN workload sample", () => {
    expect(() => parsePerson(withPath(personPayload(), "operations.rows.0.status", "done")))
      .toThrow(/terminal operation appears in the open workload sample/);
    expect(() => parsePerson(withPath(personPayload(), "operations.rows.0.status", "invented")))
      .toThrow(/unknown recorded operation status/);
  });

  it("reconciles the operation sample against its OPEN total, never the all-time total", () => {
    // Fewer open operations than the sample shows: the sample is not the set its total describes.
    expect(() => parsePerson(withPath(personPayload(), "operations.open_total", "1")))
      .toThrow(/does not match its exact open total and limit/);
    // More open than linked at all is incoherent whatever the sample looks like.
    expect(() => parsePerson(withPath(personPayload(), "operations.total", "1")))
      .toThrow(/more operations are open than are linked at all/);
    // A tighter bound legitimately shortens the sample while the exact total is unchanged.
    const bounded = withPath(withPath(personPayload(), "limits.operations", 1), "operations.rows",
      [(personPayload().operations as Row).rows as Row[]].flat().slice(0, 1));
    const snapshot = parsePerson(bounded, { operationLimit: 1 });
    expect(snapshot!.operations.rows).toHaveLength(1);
    expect(snapshot!.operations.openTotal).toBe("2");
  });

  it("refuses an operation sample that is not ordered earliest-planned first", () => {
    const swapped = structuredClone(personPayload()) as Row;
    const operations = swapped.operations as Row;
    operations.rows = [(operations.rows as Row[])[1], (operations.rows as Row[])[0]];
    expect(() => parsePerson(swapped)).toThrow(/a scheduled operation follows an unscheduled one/);
  });

  it("refuses a link flag that is unknown rather than true or false", () => {
    // An operation with no recorded responsible person must publish `false`, not JSON null: SQL's
    // `responsible_person_id = p_person` is NULL there, and a null would be a fact the reader cannot
    // render. The database coalesces it; this refuses the payload if it ever stops.
    expect(() => parsePerson(withPath(personPayload(), "operations.rows.0.is_responsible", null)))
      .toThrow(/is_responsible must be a boolean/);
    expect(() => parsePerson(withPath(personPayload(), "operations.rows.0.is_lead", null)))
      .toThrow(/is_lead must be a boolean/);
  });

  it("refuses an operation that ends before it starts", () => {
    expect(() => parsePerson(withPath(personPayload(), "operations.rows.0.ends_on", "2026-08-01")))
      .toThrow(/ends before it starts/);
    expect(() => parsePerson(withPath(personPayload(), "operations.rows.0.planned_at", "2026-08-32")))
      .toThrow(/must be a calendar date/);
  });

  it("reconciles each event sample against its own exact total and its own bound", () => {
    expect(() => parsePerson(withPath(personPayload(), "performed_events.total", "0")))
      .toThrow(/performed_events sample does not match/);
    expect(() => parsePerson(withPath(personPayload(), "assigned_events.open_total", "5")))
      .toThrow(/more open events than events/);
    expect(() => parsePerson(withPath(personPayload(), "assigned_events.rows.0.status", "approved")))
      .toThrow(/unknown recorded event status/);
    expect(() => parsePerson(withPath(personPayload(), "performed_events.rows.0.occurred_at", "not a time")))
      .toThrow(/parseable timestamp/);
  });

  it("refuses recorded activity that is not newest first", () => {
    const swapped = structuredClone(personPayload()) as Row;
    const assigned = swapped.assigned_events as Row;
    assigned.rows = [(assigned.rows as Row[])[1], (assigned.rows as Row[])[0]];
    expect(() => parsePerson(swapped)).toThrow(/assigned_events is not ordered newest first/);
  });

  it("uses the farm-event composite key rather than rejecting a repeated id at another time", () => {
    const repeatedId = structuredClone(personPayload()) as Row;
    const assigned = repeatedId.assigned_events as Row;
    (assigned.rows as Row[])[1].event_id = EVENT_B;
    expect(parsePerson(repeatedId)?.assignedEvents.rows).toHaveLength(2);

    (assigned.rows as Row[])[1].occurred_at = (assigned.rows as Row[])[0].occurred_at;
    expect(() => parsePerson(repeatedId)).toThrow(/assigned_events rows must not repeat a row/);
  });

  it("reconciles the direct team sample and keeps it active first", () => {
    expect(() => parsePerson(withPath(personPayload(), "direct_reports.active_total", "3")))
      .toThrow(/more direct reports are active than exist/);
    expect(() => parsePerson(withPath(personPayload(), "direct_reports.total", "9")))
      .toThrow(/direct report sample does not match/);
    const swapped = structuredClone(personPayload()) as Row;
    const reports = swapped.direct_reports as Row;
    reports.rows = [(reports.rows as Row[])[1], (reports.rows as Row[])[0]];
    expect(() => parsePerson(swapped)).toThrow(/direct report sample is not ordered active first/);
  });

  it("refuses a self-referential hierarchy in either direction", () => {
    expect(() => parsePerson(withPath(personPayload(), "person.manager_id", LEAD)))
      .toThrow(/cannot be their own manager/);
    expect(() => parsePerson(withPath(personPayload(), "direct_reports.rows.0.person_id", LEAD)))
      .toThrow(/cannot report to themselves/);
  });

  it("refuses contact PII, an auth identity, a wage or a money key however deeply nested", () => {
    for (const [path, value] of [
      ["person.phone", "01000000000"],
      ["person.email", "x@example.test"],
      ["person.user_id", LEAD],
      ["operations.rows.0.est_cost", "500"],
      ["performed_events.rows.0.created_by", LEAD],
      ["direct_reports.rows.0.rate", "80"],
    ] as const) {
      expect(() => parsePerson(withPath(personPayload(), path, value)), path)
        .toThrow(/the payload carries/);
    }
  });
});
