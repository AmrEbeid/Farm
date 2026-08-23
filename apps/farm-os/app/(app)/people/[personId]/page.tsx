// SPEC-0033 R4c — «ملف الزميل 360». ONE exact, bounded, active-organisation snapshot per page view.
// Nothing on this route reads a table directly any more.
//
// WHAT REPLACED WHAT. The old page issued five parallel PostgREST reads and then two more, one of
// which was the WHOLE `people` table just to resolve a single manager name and the direct reports.
// It de-duplicated the legacy responsible-person link against the assignee link in JavaScript, and
// then rendered `array.length` of each capped read as a KPI — «أنشطة مسندة ١٢» on a `.limit(12)`
// read means "at least 12", never "12". It also selected `est_cost` on every operation, publishing
// planned money to a surface with no reason to carry it. All of that is now one RPC: the union is
// de-duplicated in SQL, every exact total is published separately from its own independently
// bounded sample, and no money key is built at all.
//
// NOT FOUND MEANS NOT FOUND. `fn_person_snapshot` returns SQL NULL for a person outside the active
// organisation — deliberately the SAME answer as an id that does not exist anywhere — so the 404
// below can never be read as "this person exists, but not for you". A malformed uuid collapses to
// the same answer.
//
// THE RETURN LINK IS REBUILT, NOT ECHOED. `?from=` is parsed, restricted to the people directory
// path and REBUILT from validated parts before it is ever rendered as a link
// (lib/people-directory-context) — the caller's bytes never reach an href.

import { notFound, redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  PERSON_ASSIGNED_EVENT_SAMPLE,
  PERSON_DIRECT_REPORT_SAMPLE,
  PERSON_OPERATION_SAMPLE,
  PERSON_PERFORMED_EVENT_SAMPLE,
  parsePersonSnapshot,
} from "@/lib/people-snapshot-reads";
import { personHref, readPersonRequest } from "@/lib/people-directory-context";
import { Person360View } from "./person-360-view";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function Person360Page({
  params,
  searchParams,
}: {
  params: Promise<{ personId: string }>;
  searchParams: Promise<{ tab?: string; from?: string }>;
}) {
  const membership = await requireRole(["owner", "farm_manager", "agri_engineer", "accountant"]);
  const { personId } = await params;
  // A route segment that is not a uuid is a 404, not a database error: `p_person uuid` would raise
  // 22P02 and reach the segment error boundary as a server fault instead of a missing page.
  if (!UUID.test(personId)) notFound();

  const canonicalPersonId = personId.toLowerCase();
  const { tab, from, redirectTo } = readPersonRequest(canonicalPersonId, await searchParams);
  if (personId !== canonicalPersonId || redirectTo) {
    redirect(redirectTo ?? personHref(canonicalPersonId, tab, from));
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_person_snapshot", {
    p_org: membership.orgId,
    p_person: canonicalPersonId,
    p_operation_limit: PERSON_OPERATION_SAMPLE,
    p_performed_limit: PERSON_PERFORMED_EVENT_SAMPLE,
    p_assigned_limit: PERSON_ASSIGNED_EVENT_SAMPLE,
    p_report_limit: PERSON_DIRECT_REPORT_SAMPLE,
  });
  if (error) throw error;
  if (data === null) notFound();

  const snapshot = parsePersonSnapshot(data, {
    orgId: membership.orgId,
    personId: canonicalPersonId,
    operationLimit: PERSON_OPERATION_SAMPLE,
    performedLimit: PERSON_PERFORMED_EVENT_SAMPLE,
    assignedLimit: PERSON_ASSIGNED_EVENT_SAMPLE,
    reportLimit: PERSON_DIRECT_REPORT_SAMPLE,
  });
  if (snapshot === null) notFound();

  return <Person360View snapshot={snapshot} tab={tab} returnTo={from} />;
}
