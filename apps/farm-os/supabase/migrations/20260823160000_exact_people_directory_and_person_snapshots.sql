-- SPEC-0033 R4c: two exact, bounded, active-organisation snapshots for the PEOPLE DIRECTORY
-- (`/people`) and the PERSON 360 (`/people/[personId]`).
--
-- WHY THIS EXISTS.
--   * `/people` selected EVERY `people` row unbounded, then selected EVERY assignee row of every
--     operation whose status is the literal string `planned`, and then grouped, filtered, searched,
--     counted, printed and CSV-exported the whole set in the browser. Three things were wrong at
--     once. The workload figure counted only `planned` operations, so an operation the crew had
--     already started (`in_progress`), or that was `approved`/`reserved`/`ready` and waiting, was
--     reported as no workload at all — the exact opposite of what «مكلّفون بعمليات مفتوحة» claims.
--     It also ignored `plan_operations.responsible_person_id` entirely, so the person who OWNS an
--     operation read as unassigned unless somebody had also added them as an assignee. And the
--     three KPI numbers at the top of the page were `array.length` on an unbounded client array, so
--     they were only ever as true as the read was complete.
--   * `/people/[personId]` read the WHOLE `people` table a second time just to resolve one manager
--     name and the direct reports, ran five parallel PostgREST reads plus two more, de-duplicated
--     the legacy responsible-person link against the assignee link in JavaScript, then presented
--     `array.length` of each capped sample as if it were the total — «أنشطة مسندة ١٢» on a
--     `.limit(12)` read means "at least 12", never "12". It also selected `est_cost` on every
--     operation, publishing planned money to a surface that has no reason to carry it.
--
-- Both routes now read exactly ONE of the functions below per page view, and every count published
-- is an exact count of RECORDED rows computed in PostgreSQL, separately from the bounded rows.
--
-- THE ROLE CONTRACT IS RE-DECIDED IN POSTGRESQL, NOT ONLY IN REACT. `/people` and
-- `/people/[personId]` are gated in the app by `requireRole(['owner','farm_manager','agri_engineer',
-- 'accountant'])`. That exact set is re-checked here from the caller's real `organization_member`
-- row: a supervisor or a storekeeper is refused with 42501 even if they reach the RPC directly. This
-- preserves today's policy exactly — it neither widens nor narrows it — and moves the enforcement to
-- the boundary where it is a control rather than a redirect.
--
-- WHAT IS NEVER BUILT. Neither payload carries contact PII (`people.phone`/`people.email` are
-- PII-locked at the column-grant layer, migration 20260622000048), `people.user_id` or any other
-- auth identity, any wage/compensation/payroll value (`people_compensation` is payroll.read-gated
-- and is not read here at all), any creator/closer/audit identity (`farm_event.created_by`,
-- `plan_operations.signed_off_by`), or `plan_operations.est_cost` and any other money key. The keys
-- are NOT BUILT, not hidden after the fact: bytes that are never assembled cannot appear in the
-- network tab, the RSC payload or a cache.
--
-- HONESTY CONTRACT (docs/CLAUDE.md #1).
--   * OPEN means NONTERMINAL, and the set is the negative one the execute gate itself uses
--     (`fn_execute_operation`, `isExecutableOpStatus`, migration 20260622000058): anything that is
--     not `done`/`blocked`/`abandoned`/`skipped`. Never the literal `planned` alone.
--   * A person is linked to an operation through `plan_operation_assignees` OR through the legacy
--     `plan_operations.responsible_person_id`. The two are UNIONed and DE-DUPLICATED IN SQL, so a
--     person who is both the responsible person and an assignee counts once, on both surfaces, and
--     the directory's workload figure can never disagree with the person's own file.
--   * Every bounded sample is published beside its own exact total. A sample length is never
--     presented as a total anywhere in either payload.
--   * A manager name is resolved in SQL from the whole organisation, never from the rows of the
--     current page — under paging a client-side lookup would print «—» for a real manager who
--     happens to be on another page.
--   * The full manager option list the onboarding form needs is published SEPARATELY from the page,
--     in full, and fails LOUDLY above a hard ceiling rather than silently offering a truncated list
--     of managers that a writer would read as "these are all the managers".
--
-- BOUNDS. The directory is a real limit/offset page (limit 1-50, offset 0-1,000,000 — the ceilings
-- R4a established) over a deterministic TOTAL order (active first, then name, then id, which is what
-- makes limit/offset paging correct rather than merely plausible). The person 360 bounds its four
-- samples INDEPENDENTLY. Search text is refused above a raw ceiling BEFORE it is trimmed, and its
-- LIKE metacharacters are escaped, so a typed `%` searches for a per-cent sign instead of matching
-- every colleague. Counts leave PostgreSQL as TEXT, because a JS number cannot represent every
-- bigint.
--
-- NOT FOUND MEANS NOT FOUND. `fn_person_snapshot` returns SQL NULL for a person outside the active
-- organisation — deliberately the SAME answer as an id that exists nowhere at all — so the 404 can
-- never be read as "this person exists, but not for you".
--
-- BLANK IS NOT RECORDED, AND WHAT IS STILL NOT GUARDED. Every nullable free-text column published
-- here (`position`, `employment_type`, operation/event `subtype`, event `notes`) is normalised with
-- `nullif(btrim(...), '')`, so a stray empty string reads as "not recorded" rather than failing the
-- strict client parser and blanking a whole page. Two columns cannot be normalised that way and are
-- recorded as residual gaps rather than silently papered over: `people.name` and `farm_event.type`
-- are NOT NULL but carry no non-emptiness constraint, so a corrupt empty value would fail the strict
-- read rather than render a nameless row. This matches the posture R4a recorded for item names and
-- is not newly introduced here; closing it needs a CHECK constraint on those tables, which is a
-- write-path change and belongs to its own slice.
--
-- TIMESTAMPS LEAVE AS ISO-8601. `occurred_at` is published through `jsonb_build_object` rather than
-- `::text`, so it renders as `YYYY-MM-DDTHH:MM:SS+OO:OO` rather than PostgreSQL's space-separated
-- form. `Date.parse` on a non-ISO string is implementation-defined in ECMA-262; an explicit ISO
-- instant is unambiguous in every engine. Counts still leave as TEXT — that is a precision
-- requirement, not a formatting one.
--
-- FAIL CLOSED — ACTIVE-ORGANISATION CHILD CORRUPTION. Both functions are SECURITY INVOKER, so a row
-- belonging to ANOTHER organisation is already invisible to the caller under RLS and no query here
-- could see it; only the FORWARD direction (a child row in THIS organisation whose parent does not
-- resolve in THIS organisation) is checkable, and it is checked explicitly rather than assumed. A
-- dangling manager, an assignee row whose operation or person is foreign, an operation whose plan or
-- responsible person is foreign — each would silently shrink a count or blank a name that the page
-- presents as complete, so the read fails closed (23514) instead.

begin;

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- 1) EXACT PEOPLE DIRECTORY SNAPSHOT — one page of the roster, with exact totals beside it
-- ───────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.fn_people_directory_snapshot(
  p_org uuid,
  p_query text default null,
  p_filter text default 'all',
  p_limit integer default 20,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_active_org uuid;
  v_role text;
  v_can_write boolean;
  v_query text;
  v_pattern text;
  v_manager_options bigint;
  v_result jsonb;
  -- The longest search a person types into a directory search box. Anything longer is not a search.
  v_max_query constant integer := 60;
  -- The raw ceiling, refused before the value is trimmed or escaped, so no unbounded string is ever
  -- processed on behalf of a request that was always going to be refused.
  v_max_raw_query constant integer := 200;
  -- The onboarding form's manager list is published IN FULL or not at all. Above this the optional
  -- list becomes null while the directory remains readable; a partial roster would be misleading.
  v_max_manager_options constant integer := 500;
begin
  if p_org is null then
    raise exception 'organization is required' using errcode = '23502';
  end if;
  if p_filter is null or p_filter not in ('all', 'active', 'assigned') then
    raise exception 'unknown people directory filter' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'people directory limit must be between 1 and 50' using errcode = '22023';
  end if;
  if p_offset is null or p_offset < 0 or p_offset > 1000000 then
    raise exception 'people directory offset is out of range' using errcode = '22023';
  end if;

  begin
    v_active_org := nullif(
      nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb ->> 'active_org_id',
      ''
    )::uuid;
  exception when others then
    raise exception 'forbidden: invalid active organization claim' using errcode = '42501';
  end;

  if v_uid is null or v_active_org is null or v_active_org is distinct from p_org then
    raise exception 'forbidden: the people directory requires the active organization' using errcode = '42501';
  end if;
  select m.role into v_role
    from public.organization_member m
   where m.user_id = v_uid and m.org_id = p_org;
  if v_role is null then
    raise exception 'forbidden: organization membership is required' using errcode = '42501';
  end if;
  if p_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: organization is outside the active scope' using errcode = '42501';
  end if;
  -- EXACTLY the role set `/people` is gated to today. Re-checked here so the gate is a control at
  -- the data boundary, not only a redirect in React.
  if v_role not in ('owner', 'farm_manager', 'agri_engineer', 'accountant') then
    raise exception 'forbidden: the people directory is limited to owner, farm manager, agronomist and accountant'
      using errcode = '42501';
  end if;

  -- The onboarding form is gated on people.write (owner/farm_manager, migration 20260701300000).
  -- Its manager options are only BUILT for a caller who can actually use them.
  v_can_write := public.authorize('people.write', p_org);

  -- Bounded BEFORE any string work touches it: the raw length is refused first, the trimmed length
  -- second.
  if p_query is not null and pg_catalog.length(p_query) > v_max_raw_query then
    raise exception 'people search text is too long' using errcode = '22023';
  end if;
  v_query := nullif(pg_catalog.btrim(coalesce(p_query, '')), '');
  if v_query is not null and pg_catalog.length(v_query) > v_max_query then
    raise exception 'people search text is too long' using errcode = '22023';
  end if;
  -- LIKE metacharacters are escaped so a typed '%' searches for a per-cent sign rather than matching
  -- every colleague. The value is a bound parameter throughout: never concatenated into SQL text.
  v_pattern := case
    when v_query is null then null
    else '%' || pg_catalog.replace(
                  pg_catalog.replace(
                    pg_catalog.replace(v_query, '\', '\\'), '%', '\%'), '_', '\_') || '%'
  end;

  -- Active-organisation relationship integrity, forward direction only — see the header. Each of
  -- these would quietly change a number or a name this page presents as complete.
  if exists (
    select 1 from public.people p
    left join public.people mgr on mgr.id = p.reports_to_person_id and mgr.org_id = p_org
    where p.org_id = p_org and p.reports_to_person_id is not null and mgr.id is null
  ) or exists (
    select 1 from public.plan_operation_assignees a
    left join public.plan_operations o on o.id = a.plan_op_id and o.org_id = p_org
    left join public.people pe on pe.id = a.person_id and pe.org_id = p_org
    where a.org_id = p_org and (o.id is null or pe.id is null)
  ) or exists (
    select 1 from public.plan_operations o
    left join public.people pe on pe.id = o.responsible_person_id and pe.org_id = p_org
    where o.org_id = p_org and o.responsible_person_id is not null and pe.id is null
  ) then
    raise exception 'people directory organization relationship mismatch' using errcode = '23514';
  end if;

  if v_can_write then
    select pg_catalog.count(*)::bigint into v_manager_options
      from public.people p
     where p.org_id = p_org and p.active;
  end if;

  with
  base as materialized (
    -- A blank recorded free-text value is not a recorded value: `''` becomes NULL here, so the page
    -- says «غير مسجلة» instead of failing the strict read on an empty string.
    select p.id, p.name,
           nullif(pg_catalog.btrim(p.position), '') as position,
           nullif(pg_catalog.btrim(p.employment_type), '') as employment_type,
           p.active, p.reports_to_person_id
      from public.people p
     where p.org_id = p_org
  ),
  -- OPEN is the NONTERMINAL set the execute gate itself uses, never the literal 'planned'.
  open_ops as materialized (
    select o.id, o.responsible_person_id
      from public.plan_operations o
     where o.org_id = p_org
       and coalesce(o.status, 'planned') not in ('done', 'blocked', 'abandoned', 'skipped')
  ),
  -- The two ways a person is linked to an operation, DE-DUPLICATED here: `union` (not `union all`)
  -- so being both the responsible person and an assignee counts once.
  open_links as materialized (
    select a.person_id, a.plan_op_id
      from public.plan_operation_assignees a
      join open_ops o on o.id = a.plan_op_id
     where a.org_id = p_org
    union
    select o.responsible_person_id as person_id, o.id as plan_op_id
      from open_ops o
     where o.responsible_person_id is not null
  ),
  open_counts as (
    select person_id, pg_catalog.count(*)::bigint as open_operations
      from open_links
     group by person_id
  ),
  matched as materialized (
    select b.*
      from base b
     where v_pattern is null
        or b.name ilike v_pattern escape '\'
        or coalesce(b.position, '') ilike v_pattern escape '\'
  ),
  enriched as materialized (
    select m.id, m.name, m.position, m.employment_type, m.active,
           m.reports_to_person_id as manager_id,
           mgr.name as manager_name,
           coalesce(c.open_operations, 0) as open_operations
      from matched m
      left join open_counts c on c.person_id = m.id
      left join base mgr on mgr.id = m.reports_to_person_id
  ),
  totals as (
    select (select pg_catalog.count(*)::bigint from base) as total_people,
           pg_catalog.count(*)::bigint as query_total,
           pg_catalog.count(*) filter (where active)::bigint as active_count,
           pg_catalog.count(*) filter (where not active)::bigint as inactive_count,
           pg_catalog.count(*) filter (where open_operations > 0)::bigint as assigned_count
      from enriched
  ),
  filtered as materialized (
    select e.*
      from enriched e
     where p_filter = 'all'
        or (p_filter = 'active' and e.active)
        or (p_filter = 'assigned' and e.open_operations > 0)
  ),
  -- Deterministic TOTAL order: the people who can be given work first, then Arabic name, then id as
  -- the final tiebreak.
  page as materialized (
    select f.*
      from filtered f
     order by f.active desc, f.name, f.id
     limit p_limit offset p_offset
  ),
  manager_option_rows as (
    select b.id, b.name
      from base b
     where v_can_write and v_manager_options <= v_max_manager_options and b.active
     order by b.name, b.id
  ),
  authority as (
    select jsonb_object_agg(a.domain, a.status) as statuses
      from public.data_authority_status a
     where a.org_id = p_org and a.domain = 'operations'
  )
  select jsonb_build_object(
    'version', 'farm-os.people-directory.v1',
    'org_id', p_org,
    'query', v_query,
    'filter', p_filter,
    'limit', p_limit,
    'offset', p_offset,
    'can_write', v_can_write,
    'authority', coalesce((select statuses from authority), '{}'::jsonb),
    -- Exact recorded totals, kept strictly separate from the bounded page below.
    'counts', jsonb_build_object(
      'total_people', (select total_people::text from totals),
      'query_total', (select query_total::text from totals),
      'matching', (select
        case p_filter
          when 'active' then active_count
          when 'assigned' then assigned_count
          else query_total
        end::text from totals),
      'active', (select active_count::text from totals),
      'inactive', (select inactive_count::text from totals),
      'assigned', (select assigned_count::text from totals)
    ),
    'rows', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'person_id', pg.id::text,
          'name', pg.name,
          'position', pg.position,
          'employment_type', pg.employment_type,
          'active', pg.active,
          'manager_id', pg.manager_id::text,
          'manager_name', pg.manager_name,
          'open_operations', pg.open_operations::text
        )
        order by pg.active desc, pg.name, pg.id
      ) from page pg
    ), '[]'::jsonb)
  ) || case when v_can_write then jsonb_build_object(
    -- Published IN FULL beside the page, never derived from it: a manager who is not on the current
    -- page must still be selectable, and a truncated list would read as the whole roster.
    'manager_options', case when v_manager_options <= v_max_manager_options then coalesce((
        select jsonb_agg(jsonb_build_object('person_id', mo.id::text, 'name', mo.name)
               order by mo.name, mo.id)
          from manager_option_rows mo
      ), '[]'::jsonb)
      else 'null'::jsonb
    end
  ) else '{}'::jsonb end
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.fn_people_directory_snapshot(uuid, text, text, integer, integer) from public;
revoke all on function public.fn_people_directory_snapshot(uuid, text, text, integer, integer) from anon;
grant execute on function public.fn_people_directory_snapshot(uuid, text, text, integer, integer) to authenticated;

comment on function public.fn_people_directory_snapshot(uuid, text, text, integer, integer) is
  'Exact bounded people directory for the active organization (owner/farm_manager/agri_engineer/accountant only, re-checked in SQL): exact organization, search and filter totals published separately from one deterministically ordered limit/offset page, plus — for people.write callers only — the full manager option list when it is at most 500 rows; above that limit the optional list is null and the directory remains readable. Open workload is the NONTERMINAL operation set (never the literal planned) counted over the de-duplicated union of plan_operation_assignees and the legacy responsible_person_id. Publishes no contact PII, no auth id, no wage and no money key. Fails closed (23514) on a dangling manager or a cross-org assignee/responsible-person reference.';

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- 2) EXACT PERSON 360 SNAPSHOT — one person's file, four independently bounded samples
-- ───────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.fn_person_snapshot(
  p_org uuid,
  p_person uuid,
  p_operation_limit integer default 10,
  p_performed_limit integer default 8,
  p_assigned_limit integer default 8,
  p_report_limit integer default 10
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_active_org uuid;
  v_role text;
  v_person record;
  v_manager_name text;
  v_result jsonb;
begin
  if p_org is null or p_person is null then
    raise exception 'organization and person are required' using errcode = '23502';
  end if;
  -- Four INDEPENDENT bounds. Each sample is a different question with a different natural size, and
  -- each is validated on its own so one over-wide request cannot widen the others.
  if p_operation_limit is null or p_operation_limit < 1 or p_operation_limit > 50 then
    raise exception 'person operation limit must be between 1 and 50' using errcode = '22023';
  end if;
  if p_performed_limit is null or p_performed_limit < 1 or p_performed_limit > 50 then
    raise exception 'person performed-event limit must be between 1 and 50' using errcode = '22023';
  end if;
  if p_assigned_limit is null or p_assigned_limit < 1 or p_assigned_limit > 50 then
    raise exception 'person assigned-event limit must be between 1 and 50' using errcode = '22023';
  end if;
  if p_report_limit is null or p_report_limit < 1 or p_report_limit > 50 then
    raise exception 'person direct-report limit must be between 1 and 50' using errcode = '22023';
  end if;

  begin
    v_active_org := nullif(
      nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb ->> 'active_org_id',
      ''
    )::uuid;
  exception when others then
    raise exception 'forbidden: invalid active organization claim' using errcode = '42501';
  end;

  if v_uid is null or v_active_org is null or v_active_org is distinct from p_org then
    raise exception 'forbidden: the person file requires the active organization' using errcode = '42501';
  end if;
  select m.role into v_role
    from public.organization_member m
   where m.user_id = v_uid and m.org_id = p_org;
  if v_role is null then
    raise exception 'forbidden: organization membership is required' using errcode = '42501';
  end if;
  if p_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: organization is outside the active scope' using errcode = '42501';
  end if;
  if v_role not in ('owner', 'farm_manager', 'agri_engineer', 'accountant') then
    raise exception 'forbidden: the person file is limited to owner, farm manager, agronomist and accountant'
      using errcode = '42501';
  end if;

  -- A person outside the active organisation is NOT FOUND, not forbidden — and a person id that
  -- exists nowhere at all reads exactly the same.
  select p.id, p.name,
         nullif(pg_catalog.btrim(p.position), '') as position,
         nullif(pg_catalog.btrim(p.employment_type), '') as employment_type,
         p.active, p.reports_to_person_id
    into v_person
    from public.people p
   where p.id = p_person and p.org_id = p_org;
  if v_person.id is null then
    return null;
  end if;

  -- Active-organisation relationship integrity, scoped to this one person's own joins. A foreign
  -- manager would blank a real name; a foreign operation, plan or person behind an assignee row
  -- would silently shrink a workload figure this file presents as complete.
  if v_person.reports_to_person_id is not null then
    select m.name into v_manager_name
      from public.people m
     where m.id = v_person.reports_to_person_id and m.org_id = p_org;
    if v_manager_name is null then
      raise exception 'person organization relationship mismatch' using errcode = '23514';
    end if;
  end if;
  if exists (
    select 1 from public.plan_operation_assignees a
    left join public.plan_operations o on o.id = a.plan_op_id and o.org_id = p_org
    where a.org_id = p_org and a.person_id = p_person and o.id is null
  ) or exists (
    select 1 from public.plan_operations o
    left join public.plans pl on pl.id = o.plan_id and pl.org_id = p_org
    where o.org_id = p_org and pl.id is null
      and (
        o.responsible_person_id = p_person
        or exists (
          select 1 from public.plan_operation_assignees a
           where a.plan_op_id = o.id and a.org_id = p_org and a.person_id = p_person
        )
      )
  ) then
    raise exception 'person organization relationship mismatch' using errcode = '23514';
  end if;

  with
  -- Every operation this person is linked to, through EITHER route, DE-DUPLICATED in SQL. `is_lead`
  -- and `is_responsible` say WHICH link exists, so a person who is both is one row that states both.
  linked_ops as materialized (
    select o.id, o.plan_id, nullif(pg_catalog.btrim(o.subtype), '') as subtype,
           o.status, o.planned_at, o.ends_on,
           coalesce(pg_catalog.bool_or(a.is_lead), false) as is_lead,
           -- COALESCED, and not incidentally: on an operation with NO recorded responsible person
           -- `responsible_person_id = p_person` is NULL, not false, and the row would publish a JSON
           -- null for a fact that is simply "no". Both link flags are real booleans, always.
           coalesce(o.responsible_person_id = p_person, false) as is_responsible,
           coalesce(o.status, 'planned') not in ('done', 'blocked', 'abandoned', 'skipped') as is_open
      from public.plan_operations o
      left join public.plan_operation_assignees a
        on a.plan_op_id = o.id and a.org_id = p_org and a.person_id = p_person
     where o.org_id = p_org
       and (o.responsible_person_id = p_person or a.person_id = p_person)
     group by o.id, o.plan_id, o.subtype, o.status, o.planned_at, o.ends_on, o.responsible_person_id
  ),
  operation_totals as (
    select pg_catalog.count(*)::bigint as total,
           pg_catalog.count(*) filter (where is_open)::bigint as open_total
      from linked_ops
  ),
  -- The ACTIONABLE sample: the open operations only, earliest planned date first, unscheduled last,
  -- id as the final tiebreak. Its exact total is published beside it, never inferred from it.
  operation_rows as materialized (
    select *
      from linked_ops
     where is_open
     order by planned_at asc nulls last, id
     limit p_operation_limit
  ),
  performed as materialized (
    select e.id, e.type,
           nullif(pg_catalog.btrim(e.subtype), '') as subtype,
           e.status, e.occurred_at,
           nullif(pg_catalog.btrim(e.notes), '') as notes
      from public.farm_event e
     where e.org_id = p_org and e.performed_by_person_id = p_person
  ),
  performed_rows as materialized (
    select * from performed order by occurred_at desc, id limit p_performed_limit
  ),
  assigned as materialized (
    select e.id, e.type,
           nullif(pg_catalog.btrim(e.subtype), '') as subtype,
           e.status, e.occurred_at,
           nullif(pg_catalog.btrim(e.notes), '') as notes
      from public.farm_event e
     where e.org_id = p_org and e.assigned_to_person_id = p_person
  ),
  assigned_rows as materialized (
    select * from assigned order by occurred_at desc, id limit p_assigned_limit
  ),
  reports as materialized (
    select r.id, r.name,
           nullif(pg_catalog.btrim(r.position), '') as position,
           nullif(pg_catalog.btrim(r.employment_type), '') as employment_type,
           r.active
      from public.people r
     where r.org_id = p_org and r.reports_to_person_id = p_person
  ),
  report_rows as materialized (
    select * from reports order by active desc, name, id limit p_report_limit
  ),
  authority as (
    select jsonb_object_agg(a.domain, a.status) as statuses
      from public.data_authority_status a
     where a.org_id = p_org and a.domain = 'operations'
  )
  select jsonb_build_object(
    'version', 'farm-os.person-360.v1',
    'org_id', p_org,
    'person_id', p_person,
    'limits', jsonb_build_object(
      'operations', p_operation_limit,
      'performed_events', p_performed_limit,
      'assigned_events', p_assigned_limit,
      'direct_reports', p_report_limit
    ),
    'authority', coalesce((select statuses from authority), '{}'::jsonb),
    'person', jsonb_build_object(
      'name', v_person.name,
      'position', v_person.position,
      'employment_type', v_person.employment_type,
      'active', v_person.active,
      'manager_id', v_person.reports_to_person_id::text,
      'manager_name', v_manager_name
    ),
    'operations', jsonb_build_object(
      'total', (select total::text from operation_totals),
      'open_total', (select open_total::text from operation_totals),
      'rows', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'plan_op_id', o.id::text,
            'plan_id', o.plan_id::text,
            'subtype', o.subtype,
            'status', coalesce(o.status, 'planned'),
            'planned_at', o.planned_at::text,
            'ends_on', o.ends_on::text,
            'is_lead', o.is_lead,
            'is_responsible', o.is_responsible
          )
          order by o.planned_at asc nulls last, o.id
        ) from operation_rows o
      ), '[]'::jsonb)
    ),
    'performed_events', jsonb_build_object(
      'total', (select pg_catalog.count(*)::text from performed),
      'rows', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'event_id', e.id::text,
            'type', e.type,
            'subtype', e.subtype,
            'status', e.status,
            'occurred_at', e.occurred_at,
            'notes', e.notes
          )
          order by e.occurred_at desc, e.id
        ) from performed_rows e
      ), '[]'::jsonb)
    ),
    'assigned_events', jsonb_build_object(
      'total', (select pg_catalog.count(*)::text from assigned),
      'open_total', (select pg_catalog.count(*) filter (
        where coalesce(status, 'planned') not in ('done', 'blocked', 'abandoned', 'skipped')
      )::text from assigned),
      'rows', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'event_id', e.id::text,
            'type', e.type,
            'subtype', e.subtype,
            'status', e.status,
            'occurred_at', e.occurred_at,
            'notes', e.notes
          )
          order by e.occurred_at desc, e.id
        ) from assigned_rows e
      ), '[]'::jsonb)
    ),
    'direct_reports', jsonb_build_object(
      'total', (select pg_catalog.count(*)::text from reports),
      'active_total', (select pg_catalog.count(*) filter (where active)::text from reports),
      'rows', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'person_id', r.id::text,
            'name', r.name,
            'position', r.position,
            'employment_type', r.employment_type,
            'active', r.active
          )
          order by r.active desc, r.name, r.id
        ) from report_rows r
      ), '[]'::jsonb)
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.fn_person_snapshot(uuid, uuid, integer, integer, integer, integer) from public;
revoke all on function public.fn_person_snapshot(uuid, uuid, integer, integer, integer, integer) from anon;
grant execute on function public.fn_person_snapshot(uuid, uuid, integer, integer, integer, integer) to authenticated;

comment on function public.fn_person_snapshot(uuid, uuid, integer, integer, integer, integer) is
  'Exact bounded 360 for one person in the active organization (owner/farm_manager/agri_engineer/accountant only, re-checked in SQL): identity, manager, and exact totals for linked operations, performed events, assigned events and direct reports, each published separately from its own INDEPENDENTLY bounded sample. Operations are the de-duplicated union of plan_operation_assignees and the legacy responsible_person_id, and open means NONTERMINAL (never the literal planned). Publishes no contact PII, no auth id, no wage and no est_cost. Returns null when the person is outside the active organization or does not exist, so the two are indistinguishable. Fails closed (23514) on a dangling manager or a cross-org assignee/plan reference.';

commit;
