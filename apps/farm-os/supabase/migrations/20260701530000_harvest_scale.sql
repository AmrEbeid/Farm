-- SPEC-0027 H-A — شاشة الميزان (the scale-house event): the physical front-end of delivery-before-price.
--
-- A scale delivery = crates counted → gross weighed → tare deducted → NET kg → a PENDING-price sale
-- (S-10) + a serialized delivery note (بون تسليم) that ends the "التاجر يقول استلم أقل" dispute. The
-- note number is per-org sequential and unique; the sale posts NOTHING to the ledger until its price is
-- finalized (honest-null #1 — bulk deliveries can never fabricate revenue).
--
-- Write gate: budget.write (owner/accountant — the same gate as fn_save_sale; the scale phone runs the
-- accountant's login for the pilot. Widening to a field role is an authorize() decision deliberately NOT
-- taken here — NO authorize() change). SECURITY DEFINER + search_path='' + EXECUTE-locked. The serial is
-- allocated under a per-org advisory xact lock (two scale phones can't mint the same بون).
begin;

-- ── 1) scale columns on sales ──────────────────────────────────────────────────────────────────────────
alter table public.sales add column if not exists crates numeric check (crates is null or crates > 0);
alter table public.sales add column if not exists gross_kg numeric check (gross_kg is null or gross_kg > 0);
alter table public.sales add column if not exists tare_kg numeric check (tare_kg is null or tare_kg >= 0);
alter table public.sales add column if not exists delivery_note_no int;
create unique index if not exists sales_delivery_note_uq
  on public.sales(org_id, delivery_note_no) where delivery_note_no is not null;

-- ── 2) fn_record_scale_delivery — one call = the whole scale event ────────────────────────────────────
create or replace function public.fn_record_scale_delivery(
  p_org uuid, p_crop text, p_crates numeric, p_gross_kg numeric, p_tare_per_crate numeric,
  p_buyer_id uuid default null, p_cost_center_id uuid default null,
  p_sale_date date default current_date, p_notes text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_tare numeric; v_net numeric; v_serial int; v_sale jsonb; v_sale_id uuid;
begin
  if p_crates is null or p_crates <= 0 then raise exception 'crates must be positive' using errcode = '22023'; end if;
  if p_gross_kg is null or p_gross_kg <= 0 then raise exception 'gross weight must be positive' using errcode = '22023'; end if;
  if p_tare_per_crate is null or p_tare_per_crate < 0 then raise exception 'tare per crate must be non-negative' using errcode = '22023'; end if;
  v_tare := round(p_crates * p_tare_per_crate, 2);
  v_net  := round(p_gross_kg - v_tare, 2);
  if v_net <= 0 then raise exception 'net weight must be positive (gross % − tare %)', p_gross_kg, v_tare using errcode = '22023'; end if;

  -- All org/buyer/center/authorize guards live in fn_save_sale — one write path, one rulebook.
  v_sale := public.fn_save_sale(
    null, p_org, coalesce(p_sale_date, current_date), p_crop,
    p_buyer_id, p_cost_center_id, null, null, null,
    to_char(coalesce(p_sale_date, current_date), 'YYYY'), v_net, 'كجم',
    coalesce(p_sale_date, current_date), p_notes);
  v_sale_id := (v_sale ->> 'id')::uuid;

  -- Per-org serial under an advisory xact lock: concurrent scale phones cannot mint the same بون.
  perform pg_advisory_xact_lock(hashtext('scale-note-' || p_org::text));
  select coalesce(max(delivery_note_no), 0) + 1 into v_serial from public.sales where org_id = p_org;

  update public.sales
     set crates = p_crates, gross_kg = p_gross_kg, tare_kg = v_tare, delivery_note_no = v_serial
   where id = v_sale_id;

  return jsonb_build_object('id', v_sale_id, 'delivery_note_no', v_serial, 'net_kg', v_net, 'tare_kg', v_tare);
end $$;
revoke execute on function public.fn_record_scale_delivery(uuid, text, numeric, numeric, numeric, uuid, uuid, date, text) from public, anon, authenticated;
grant  execute on function public.fn_record_scale_delivery(uuid, text, numeric, numeric, numeric, uuid, uuid, date, text) to authenticated;

commit;
