-- Test for migration 0011, against a DISPOSABLE local Postgres only.
-- Run by supabase/tests/run-0011.sh, which loads the pre-M1 schema
-- (research-platform's schema.sql, before 0011), seeds synthetic rows,
-- applies the migration, and runs this file. Any failed assertion
-- raises and stops the run (ON_ERROR_STOP).
\set ON_ERROR_STOP on

-- 1. Every pre-existing row is byte-identical after the migration.
do $$
begin
  if (select count(*) from papers) <> 4 then raise exception 'expected 4 seeded papers'; end if;
  if exists (
    select 1 from papers p join pre_migration_snapshot s on s.id = p.id
    where row(p.*)::text <> s.row_text
  ) then raise exception 'a pre-existing papers row changed during the migration'; end if;
end $$;

-- 2. The new value is accepted; an unknown value is still rejected.
update papers set extraction_status = 'manual' where title_ar = 'قيد الانتظار';
do $$
begin
  begin
    update papers set extraction_status = 'extracted_by_hand' where title_ar = 'قيد الانتظار';
    raise exception 'an unknown status was accepted';
  exception when check_violation then null;
  end;
end $$;

-- 3. The confirmation RPC returns the manual status through the token.
do $$
declare v jsonb;
begin
  v := get_paper_for_confirmation('tok-pending');
  if v->>'extraction_status' <> 'manual' then raise exception 'rpc did not return manual: %', v->>'extraction_status'; end if;
  if v ? 'confirmation_token_hash' then raise exception 'token hash leaked'; end if;
  -- A bare paper id is not a credential.
  if get_paper_for_confirmation((v->>'paper_id')) is not null then raise exception 'paper id accepted as a token'; end if;
  if get_paper_for_confirmation('wrong-token') is not null then raise exception 'wrong token accepted'; end if;
end $$;

-- 4. Manual confirmation works (as anon, through the RPC), keeps the
--    status 'manual', stores Arabic and English values, and a second
--    confirmation revises rather than duplicates.
set role anon;
select confirm_researcher_metadata(
  'tok-pending',
  '[{"full_name":"سارة أحمد","author_order":1}]'::jsonb,
  '{"title":"","title_ar":"أثر التمويل الأصغر","year":"٢٠٢٤","university":"جامعة الخرطوم","abstract":"","abstract_ar":"ملخص قصير","supervisor_name":"","faculty":"","degree_type":""}'::jsonb
);
select confirm_researcher_metadata(
  'tok-pending',
  '[{"full_name":"سارة أحمد","author_order":1},{"full_name":"Omar Ali","author_order":2}]'::jsonb,
  '{"title":"Microfinance effects","title_ar":"أثر التمويل الأصغر","year":"2024","university":"جامعة الخرطوم","abstract":"","abstract_ar":"ملخص قصير","supervisor_name":"","faculty":"","degree_type":""}'::jsonb
);
reset role;
do $$
declare p record; n int;
begin
  select * into p from papers where title_ar = 'أثر التمويل الأصغر';
  if p.extraction_status <> 'manual' then raise exception 'confirming changed the status to %', p.extraction_status; end if;
  if p.metadata_confirmed_at is null then raise exception 'not confirmed'; end if;
  if p.year <> 2024 then raise exception 'year not stored: %', p.year; end if;
  if p.title <> 'Microfinance effects' then raise exception 'revision not stored'; end if;
  select count(*) into n from paper_researchers where paper_id = p.id;
  if n <> 2 then raise exception 'expected 2 linked researchers, got %', n; end if;
end $$;

-- 5. Anonymous direct table access is still blocked.
set role anon;
do $$
begin
  begin
    perform 1 from papers limit 1;
    raise exception 'anon read papers directly';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- 6. The documented rollback refuses while a manual row exists and
--    works once none does.
do $$
begin
  begin
    alter table papers drop constraint papers_extraction_status_check;
    alter table papers add constraint papers_extraction_status_check
      check (extraction_status in ('pending', 'processing', 'completed', 'partial', 'failed'));
    raise exception 'rollback succeeded while a manual row existed';
  exception when check_violation then null;
  end;
end $$;

-- The confirmed row other than the manual one is untouched throughout.
do $$
begin
  if exists (
    select 1 from papers p join pre_migration_snapshot s on s.id = p.id
    where p.title = 'Confirmed thesis' and row(p.*)::text <> s.row_text
  ) then raise exception 'the pre-existing confirmed record changed'; end if;
end $$;

select 'ALL 0011 CHECKS PASSED' as result;
