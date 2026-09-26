-- Assertions for migration 0011, against a DISPOSABLE local Postgres only.
-- Run by supabase/tests/run-0011.sh after it loads the pre-M1 schema,
-- seeds synthetic rows and applies the migration (twice). Any failed
-- assertion raises and stops the run (ON_ERROR_STOP).
\set ON_ERROR_STOP on

-- 1. Every pre-existing row is unchanged, apart from two new null columns.
do $$
begin
  if (select count(*) from papers) <> 4 then raise exception 'expected 4 seeded papers'; end if;
  if exists (
    select 1 from papers p join pre_migration_snapshot s on s.id = p.id
    where (to_jsonb(p) - 'manual_entry_at' - 'manual_entry_source') <> s.row_json
       or p.manual_entry_at is not null or p.manual_entry_source is not null
  ) then raise exception 'a pre-existing papers row changed during the migration'; end if;
  if (select count(*) from ai_generations) <> 1 then raise exception 'history rows changed'; end if;
end $$;

-- 2. Constraints: only the two sources, and recorded as a pair.
do $$
begin
  begin
    update papers set manual_entry_at = now(), manual_entry_source = 'someone' where title_ar = 'قيد الانتظار';
    raise exception 'an unknown source was accepted';
  exception when check_violation then null;
  end;
  begin
    update papers set manual_entry_at = now() where title_ar = 'قيد الانتظار';
    raise exception 'a timestamp without a source was accepted';
  exception when check_violation then null;
  end;
  begin
    update papers set manual_entry_source = 'mode' where title_ar = 'قيد الانتظار';
    raise exception 'a source without a timestamp was accepted';
  exception when check_violation then null;
  end;
  -- The status CHECK is unchanged: no 'manual' status exists.
  begin
    update papers set extraction_status = 'manual' where title_ar = 'قيد الانتظار';
    raise exception 'a manual extraction_status was accepted';
  exception when check_violation then null;
  end;
end $$;

-- 3. Record a researcher's decision on the FAILED paper: its failure
--    history stays, and the RPC returns the decision through the token.
update papers set manual_entry_at = now(), manual_entry_source = 'researcher' where title = 'Failed';
do $$
declare v jsonb;
begin
  v := get_paper_for_confirmation('tok-failed');
  if v->>'manual_entry_source' <> 'researcher' then raise exception 'rpc did not return the decision: %', v; end if;
  if v->>'extraction_status' <> 'failed' or v->>'failure_code' <> 'timeout' then raise exception 'history was relabelled'; end if;
  if v ? 'confirmation_token_hash' then raise exception 'token hash leaked'; end if;
  if get_paper_for_confirmation(v->>'paper_id') is not null then raise exception 'paper id accepted as a token'; end if;
  if get_paper_for_confirmation('wrong-token') is not null then raise exception 'wrong token accepted'; end if;
  v := get_paper_for_confirmation('tok-pending');
  if not (v ? 'manual_entry_source') or v->>'manual_entry_source' is not null then raise exception 'undecided paper should return a null decision'; end if;
end $$;

-- 4. Manual confirmation through the RPC, as anon, in EN and AR.
set role anon;
select confirm_researcher_metadata(
  'tok-failed',
  '[{"full_name":"سارة أحمد","author_order":1},{"full_name":"Omar Ali","author_order":2}]'::jsonb,
  '{"title":"Microfinance effects","title_ar":"أثر التمويل الأصغر","year":"٢٠٢٤","university":"جامعة الخرطوم","abstract":"","abstract_ar":"","supervisor_name":"","faculty":"","degree_type":""}'::jsonb
);
reset role;
do $$
declare p record; n int;
begin
  select * into p from papers where title = 'Microfinance effects';
  if p.metadata_confirmed_at is null then raise exception 'not confirmed'; end if;
  if p.year <> 2024 or p.title_ar <> 'أثر التمويل الأصغر' then raise exception 'values not stored'; end if;
  if p.extraction_status <> 'failed' or p.manual_entry_source <> 'researcher' then raise exception 'history or decision lost'; end if;
  select count(*) into n from paper_researchers where paper_id = p.id;
  if n <> 2 then raise exception 'expected 2 researchers, got %', n; end if;
end $$;

-- 5. Anonymous direct table access is still blocked, including the new columns.
set role anon;
do $$
begin
  begin
    perform manual_entry_source from papers limit 1;
    raise exception 'anon read papers directly';
  exception when insufficient_privilege then null;
  end;
  begin
    update papers set manual_entry_at = now(), manual_entry_source = 'researcher';
    raise exception 'anon wrote papers directly';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- 6. The confirmed record that existed before is untouched throughout.
do $$
begin
  if exists (
    select 1 from papers p join pre_migration_snapshot s on s.id = p.id
    where p.title = 'Confirmed thesis' and (to_jsonb(p) - 'manual_entry_at' - 'manual_entry_source') <> s.row_json
  ) then raise exception 'the pre-existing confirmed record changed'; end if;
end $$;

select 'ALL 0011 SQL CHECKS PASSED' as result;
