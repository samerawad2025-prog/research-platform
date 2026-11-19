-- Run only after the V5-compatible application is READY in production.
-- Changes the terms offered to future submissions, never existing records.
begin;
do $activate$
begin
  if (select count(*) from agreement_versions where id in ('submission-terms-2026-11-18-v5-en','submission-terms-2026-11-18-v5-ar')
      and external_ai_processing='gemini_api_unpaid'
      and content_sha256=case language when 'en' then '627189ac3f271af57f08002a8b45b4c7b700729c8c2fd7e40f031faae2d74959' when 'ar' then '7c106bc2e3b8bbd81577a6b6b5765edb316afcce449eb145603cb9951e961f29' end) <> 2 then
    raise exception 'V5 agreements missing or mismatched';
  end if;
  if not exists (select 1 from knowledge_notices where version='submission-v5-2026-11-18'
    and encode(extensions.digest(text_en,'sha256'),'hex')='627189ac3f271af57f08002a8b45b4c7b700729c8c2fd7e40f031faae2d74959'
    and encode(extensions.digest(text_ar,'sha256'),'hex')='7c106bc2e3b8bbd81577a6b6b5765edb316afcce449eb145603cb9951e961f29') then
    raise exception 'V5 permission evidence missing or mismatched';
  end if;
  if not exists (select 1 from pg_trigger where tgname='submission_bundled_knowledge' and tgrelid='public.submission_acceptances'::regclass and tgenabled='O') then
    raise exception 'V5 finalization trigger missing';
  end if;
  update agreement_versions set active=(id in ('submission-terms-2026-11-18-v5-en','submission-terms-2026-11-18-v5-ar'))
  where agreement_key='submission-terms';
end;
$activate$;
select id,active from agreement_versions where agreement_key='submission-terms' and active;
commit;
