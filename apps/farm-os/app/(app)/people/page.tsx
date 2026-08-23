// SPEC-0033 R4c — «الفريق». ONE exact, bounded, active-organisation snapshot per page view.
// Nothing on this route reads a table directly any more.
//
// WHAT REPLACED WHAT. The old page selected EVERY `people` row, then EVERY assignee row of every
// operation whose status was the literal string `planned`, and grouped/searched/filtered/counted/
// exported the whole set in the browser. Three things were wrong at once: an operation already
// `in_progress` counted as NO open work, the legacy `plan_operations.responsible_person_id` link was
// ignored entirely, and the three KPI figures were `array.length` on an unbounded client array. All
// of that is now decided in PostgreSQL: open means NONTERMINAL, both link kinds are UNIONed and
// de-duplicated in SQL, and this is a real limit/offset page whose exact totals are published
// separately from it.
//
// THE ROLE GATE IS ENFORCED TWICE, ON PURPOSE. `requireRole` keeps the redirect behaviour this route
// has always had, and `fn_people_directory_snapshot` re-checks the SAME four roles from the caller's
// real membership row — so reaching the data without the redirect is refused with 42501 rather than
// answered.

import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  PEOPLE_DIRECTORY_PAGE_SIZE,
  canWritePeople,
  parsePeopleDirectorySnapshot,
} from "@/lib/people-snapshot-reads";
import {
  peopleDirectoryHref,
  peopleDirectoryOffset,
  peoplePageCount,
  readPeopleDirectoryRequest,
} from "@/lib/people-directory-context";
import { PeopleDirectoryView } from "./people-directory-view";

export default async function PeopleDirectoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filter?: string; page?: string }>;
}) {
  const membership = await requireRole(["owner", "farm_manager", "agri_engineer", "accountant"]);
  // The url is normalised to exactly one spelling of this directory state before anything is read,
  // so a hostile or stale parameter (`?page=0`, `?filter=nonsense`, control characters in `q`) can
  // never be echoed back into a link. `redirect` throws, so nothing below runs on the discarded one.
  const { context, redirectTo } = readPeopleDirectoryRequest(await searchParams);
  if (redirectTo) redirect(redirectTo);

  const canWrite = canWritePeople(membership.role);
  const offset = peopleDirectoryOffset(context.page);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_people_directory_snapshot", {
    p_org: membership.orgId,
    p_query: context.query === "" ? null : context.query,
    p_filter: context.filter,
    p_limit: PEOPLE_DIRECTORY_PAGE_SIZE,
    p_offset: offset,
  });
  // A read failure reaches the segment error boundary rather than rendering an empty roster.
  if (error) throw error;
  const snapshot = parsePeopleDirectorySnapshot(data, {
    orgId: membership.orgId,
    query: context.query === "" ? null : context.query,
    filter: context.filter,
    limit: PEOPLE_DIRECTORY_PAGE_SIZE,
    offset,
    canWrite,
  });
  const pageCount = peoplePageCount(snapshot.counts.matching, snapshot.limit);
  // A stale bookmark can point beyond the now-smaller exact result set. Canonicalize it to the last
  // real page instead of showing an empty list while claiming matching people exist.
  if (context.page > pageCount) {
    redirect(peopleDirectoryHref({ ...context, page: pageCount }));
  }

  return <PeopleDirectoryView snapshot={snapshot} context={context} />;
}
