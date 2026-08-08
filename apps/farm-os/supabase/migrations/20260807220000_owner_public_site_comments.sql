-- Apply the Owner's 2026-08-07 public-site copy to the existing editable content row.
-- Fresh databases without a saved public-site row keep using SITE_CONTENT_DEFAULTS.
do $$
declare
  v_org constant uuid := '00000000-0000-0000-0000-000000000001';
  v_content jsonb;
begin
  select content
  into v_content
  from public.site_content
  where org_id = v_org
  for update;

  if not found then
    return;
  end if;

  if v_content #>> '{stats,0,label,en}' is distinct from 'Feddans'
     or v_content #>> '{stats,1,label,en}' is distinct from 'Barhi Palms'
     or v_content #>> '{stats,3,label,en}' is distinct from 'Production Blocks'
     or v_content #>> '{specs,rows,5,label,en}' is distinct from 'Certified Destinations' then
    raise exception 'Safety stop: public-site content shape does not match the expected editable document';
  end if;

  v_content := jsonb_set(v_content, '{stats,0,value}', '120'::jsonb);
  v_content := jsonb_set(v_content, '{stats,1,value}', '5000'::jsonb);
  v_content := jsonb_set(v_content, '{stats,3,value}', '7'::jsonb);
  v_content := jsonb_set(v_content, '{about,heading,ar}', to_jsonb('من نحن'::text));
  v_content := jsonb_set(v_content, '{about,heading,en}', to_jsonb('About Us'::text));
  v_content := jsonb_set(
    v_content,
    '{about,body,ar}',
    to_jsonb('تأسست المزرعة منذ 10 سنوات على تربة طينية خصبة، وتمت زراعتها بفسائل نسيجية مختارة مستوردة من شركة ساباد بالمملكة العربية السعودية عبر معمل أنسجة فرنسي معتمد، وفقاً لأفضل الممارسات الزراعية الحديثة، مما أنتج تموراً بارحي متميزة في الحجم والتجانس والطعم. تُروى المزرعة بمياه النيل بنظام الري بالتنقيط، وتُدار العمليات الزراعية ببرامج تسميد ومكافحة موثقة وفترات أمان قبل الحصاد، وفق نظم بيئية وصحية تضمن سلامة وجودة الثمار، مع تقارير قياس أسبوعية موثقة لأقطار الثمار في كل قطاع. تمتد المزرعة على 120 فداناً وتضم نحو 5,000 نخلة بارحي موزعة على 7 قطاعات بأعمار متدرجة تضمن إمداداً متصاعداً موسماً بعد موسم. ولدينا خبرة عملية منذ 4 سنوات في التعامل مع شركات التصدير والمستوردين، ندرك من خلالها متطلبات الفرز والتعبئة والتوثيق لكل سوق، كما تتوفر لدى المزرعة فسائل بارحي مختارة.'::text)
  );
  v_content := jsonb_set(
    v_content,
    '{about,body,en}',
    to_jsonb('Established 10 years ago on fertile clay soil, the farm was planted with selected tissue-culture offshoots imported from Sabad in Saudi Arabia through an accredited French tissue laboratory and grown according to modern agricultural practices. This has produced Barhi dates distinguished by their size, uniformity and taste. The farm is irrigated with Nile water through drip irrigation, while documented fertilization and crop-protection programs, pre-harvest safety intervals, environmental and health controls, and weekly fruit-diameter reports support fruit safety and quality in every block. The farm extends across 120 feddans and includes about 5,000 Barhi palms in 7 blocks of staggered ages, providing growing supply season after season. We also bring 4 years of practical experience working with exporters and importers, understand each market''s sorting, packing and documentation requirements, and offer selected Barhi offshoots.'::text)
  );
  v_content := jsonb_set(v_content, '{contact,person,ar}', to_jsonb('مزرعة عبيد للتمور'::text));
  v_content := jsonb_set(v_content, '{contact,person,en}', to_jsonb('Ebeid Farm for Dates'::text));
  v_content := jsonb_set(v_content, '{contact,email}', to_jsonb('ebeidfarm@gmail.com'::text));
  v_content := jsonb_set(
    v_content,
    '{specs,rows,5,value,ar}',
    to_jsonb('الصين · الإمارات · السعودية · الكويت · أوروبا · دول شرق آسيا'::text)
  );
  v_content := jsonb_set(
    v_content,
    '{specs,rows,5,value,en}',
    to_jsonb('China · UAE · Saudi Arabia · Kuwait · EU · East Asian markets'::text)
  );

  update public.site_content
  set content = v_content,
      updated_at = now()
  where org_id = v_org;
end;
$$;
