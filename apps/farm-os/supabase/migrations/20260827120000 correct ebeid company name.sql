-- Correct the Owner-confirmed English company spelling in the saved public-site content.
-- Fresh databases use the corrected SITE_CONTENT_DEFAULTS and need no data update.
do $$
declare
  v_org constant uuid := '00000000-0000-0000-0000-000000000001';
  v_content jsonb;
  v_registered_name text;
  v_gacc_detail text;
begin
  select content
  into v_content
  from public.site_content
  where org_id = v_org
  for update;

  if not found then
    return;
  end if;

  v_registered_name := v_content #>> '{brand,registeredName,en}';
  v_gacc_detail := v_content #>> '{certifications,items,1,detail,en}';

  if v_registered_name is null or v_registered_name not in (
    'Obaid Company for Dates',
    'Obeid Company for Dates',
    'Ebeid Company for Dates'
  ) then
    raise exception 'Safety stop: unexpected saved English registered company name';
  end if;

  if v_gacc_detail is null or v_gacc_detail not in (
    'Obaid Company for Dates · Reg. QEGY1425102400002 · Code 55.09.30.03.DAF',
    'Obeid Company for Dates · Reg. QEGY1425102400002 · Code 55.09.30.03.DAF',
    'Ebeid Company for Dates · Reg. QEGY1425102400002 · Code 55.09.30.03.DAF'
  ) then
    raise exception 'Safety stop: unexpected saved English GACC company detail';
  end if;

  if v_registered_name = 'Ebeid Company for Dates'
     and v_gacc_detail = 'Ebeid Company for Dates · Reg. QEGY1425102400002 · Code 55.09.30.03.DAF' then
    return;
  end if;

  v_content := jsonb_set(
    v_content,
    '{brand,registeredName,en}',
    to_jsonb('Ebeid Company for Dates'::text)
  );
  v_content := jsonb_set(
    v_content,
    '{certifications,items,1,detail,en}',
    to_jsonb('Ebeid Company for Dates · Reg. QEGY1425102400002 · Code 55.09.30.03.DAF'::text)
  );

  update public.site_content
  set content = v_content,
      updated_at = now()
  where org_id = v_org;
end;
$$;
