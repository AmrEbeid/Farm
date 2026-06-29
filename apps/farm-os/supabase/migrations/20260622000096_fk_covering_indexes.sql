-- Farm OS — #229 (b): add a covering index for every FK that lacks one (Supabase advisor: ~47 unindexed
-- FKs). Unindexed FKs make the referenced-side ON DELETE/UPDATE cascade + joins do sequential scans.
-- The 0036 convention indexes FK columns; this sweeps the rest in one generic, idempotent pass computed
-- from the catalog at apply time (so it also covers any FK a prior migration missed). Safe: only ADDS
-- indexes (create index if not exists), never drops or alters data. NOT CONCURRENTLY — runs in the
-- migration txn (fine for the current data volumes; revisit with CONCURRENTLY if a table grows large).
do $$
declare
  r record;
  v_idx text;
begin
  for r in
    select c.conrelid::regclass as tbl,
           left(c.conname, 56) as base,
           (select string_agg(quote_ident(a.attname), ', ' order by k.ord)
              from unnest(c.conkey) with ordinality k(attnum, ord)
              join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as cols
    from pg_constraint c
    where c.contype = 'f'
      and c.connamespace = 'public'::regnamespace
      and not exists (
        select 1 from pg_index i
        where i.indrelid = c.conrelid
          and (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] = c.conkey
      )
  loop
    v_idx := r.base || '_idx';
    execute format('create index if not exists %I on %s (%s)', v_idx, r.tbl, r.cols);
  end loop;
end $$;
