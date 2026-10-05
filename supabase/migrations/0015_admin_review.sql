-- ============================================================
-- 0015: administrative review (Phase 3 M4).
-- Run once in Supabase -> SQL Editor -> New query -> Run.
-- REQUIRES 0012 and 0013 (and Supabase Auth's auth.users). It does NOT
-- depend on 0014 (the cutover): numbering is not an application order.
-- Additive: no existing column, row, policy or grant changes, nothing here
-- is reachable by anon or authenticated, and nothing is public.
--
-- What it adds
--   1. Roles. staff_members maps a Supabase Auth user to 'administrator'
--      or 'volunteer'. The table is written only by service-role functions
--      and by the one-time bootstrap function (owner only), never from a
--      claim in a token. Volunteers must acknowledge the current
--      confidentiality text (recorded with version, hash and date) and be
--      assigned a submission before they can see anything of it.
--   2. Institutions and academic units, with aliases and provenance. Only
--      University of Khartoum is seeded, and it is the only eligible one,
--      with the 21 faculties and schools of its official directory (see the
--      note at the seed for the source and how it was obtained).
--   3. Review: one paper_reviews row per paper (status, institution
--      mapping, legacy permission determination, authority verification,
--      withdrawal and embargo restrictions), private notes, review issues,
--      document versions (originals and dissemination copies, with
--      provenance and hashes), immutable approval records, and an
--      append-only audit log.
--   4. One shared eligibility rule, publication_eligibility(paper), for
--      the public routes M5 will add. Approval is a review decision;
--      institution eligibility, withdrawal, embargo and the full-text legal
--      restriction are separate facts the rule combines.
--
-- Every function is SECURITY DEFINER, pins search_path, takes the acting
-- user as p_actor (verified by the application against Supabase Auth
-- before the call), re-checks that actor's role and assignment itself, and
-- is executable by service_role only.
--
-- Rollback: see the bottom of this file.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- Text normalization shared by institution matching and duplicate hints.
-- Modest and deterministic: lower case, Arabic alef/ya/ta-marbuta forms
-- folded, diacritics and tatweel removed, punctuation to spaces.
-- ------------------------------------------------------------
create or replace function normalize_name_text(p text)
returns text
language sql
immutable
set search_path = public
as $fn$
  select nullif(btrim(regexp_replace(
    regexp_replace(
      regexp_replace(translate(lower(coalesce(p, '')), 'أإآٱىةـ', 'اااايه'), '[ً-ٰٟ]', '', 'g'),
      '[\s.,;:!?()\[\]{}"''“”‘’«»\-_/\\|@#$%^&*+=<>~`،؛؟\u2010-\u2015\u2026\u00b7\u00a0\u200e\u200f]+', ' ', 'g'),
    '\s+', ' ', 'g')), '')
$fn$;

create or replace function token_jaccard(a text[], b text[])
returns numeric
language sql
immutable
set search_path = public
as $fn$
  select case
    when coalesce(cardinality(a), 0) = 0 or coalesce(cardinality(b), 0) = 0 then 0
    else (select count(*) from (select unnest(a) intersect select unnest(b)) i)::numeric
       / (select count(*) from (select unnest(a) union select unnest(b)) u)
  end
$fn$;

-- ------------------------------------------------------------
-- Append-only audit log. No update, delete or truncate, by anyone.
-- ------------------------------------------------------------
create table if not exists admin_audit_events (
  id bigint generated always as identity primary key,
  paper_id uuid references papers(id),
  actor_id uuid,
  actor_role text,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists admin_audit_events_paper on admin_audit_events (paper_id, id);
alter table admin_audit_events enable row level security;
revoke all on table admin_audit_events from anon, authenticated;

create or replace function refuse_change()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  raise exception '% is append-only', tg_table_name;
end;
$fn$;

drop trigger if exists admin_audit_events_no_change on admin_audit_events;
create trigger admin_audit_events_no_change
  before update or delete on admin_audit_events
  for each row execute function refuse_change();
drop trigger if exists admin_audit_events_no_truncate on admin_audit_events;
create trigger admin_audit_events_no_truncate
  before truncate on admin_audit_events
  for each statement execute function refuse_change();

-- Who is acting. Functions set it for the transaction; a manual SQL edit
-- leaves it null and is recorded as the database role.
create or replace function admin_log(p_paper uuid, p_actor uuid, p_role text, p_action text, p_detail jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = public
as $fn$
  insert into admin_audit_events (paper_id, actor_id, actor_role, action, detail)
  values (p_paper, p_actor, p_role, p_action, coalesce(p_detail, '{}'::jsonb));
$fn$;

-- ------------------------------------------------------------
-- Roles.
-- ------------------------------------------------------------
create table if not exists staff_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('administrator', 'volunteer')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  deactivated_at timestamptz,
  deactivated_by uuid
);
alter table staff_members enable row level security;
revoke all on table staff_members from anon, authenticated;

-- Confidentiality: which text, and who acknowledged it.
create table if not exists confidentiality_versions (
  id text primary key,
  version_label text not null,
  version_date date not null,
  sha256_en text not null check (sha256_en ~ '^[0-9a-f]{64}$'),
  sha256_ar text not null check (sha256_ar ~ '^[0-9a-f]{64}$'),
  active boolean not null default false,
  created_at timestamptz not null default now()
);
alter table confidentiality_versions enable row level security;
revoke all on table confidentiality_versions from anon, authenticated;

create table if not exists confidentiality_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  version_id text not null references confidentiality_versions(id),
  language text not null check (language in ('en', 'ar')),
  text_sha256 text not null check (text_sha256 ~ '^[0-9a-f]{64}$'),
  acknowledged_at timestamptz not null default now(),
  unique (user_id, version_id)
);
alter table confidentiality_acknowledgements enable row level security;
revoke all on table confidentiality_acknowledgements from anon, authenticated;
drop trigger if exists confidentiality_acknowledgements_no_change on confidentiality_acknowledgements;
create trigger confidentiality_acknowledgements_no_change
  before update or delete on confidentiality_acknowledgements
  for each row execute function refuse_change();

-- The text is a DRAFT for the founder to review (docs/legal/README.md).
-- Seeded inactive, like the submission agreement: until a version is
-- active, no volunteer can acknowledge it, so none can open a submission.
insert into confidentiality_versions (id, version_label, version_date, sha256_en, sha256_ar, active)
values ('volunteer-confidentiality-2026-09-29', 'Draft 1', '2026-09-29',
        '32a2b2348fb2fcd7988acb959a3b1bcf194b1ba96c0b262edd18908da0731f8f', '02c7d379e6e49483799882a0fd60c302bba95dac7a255fb686e96fd662b89f33', false)
on conflict (id) do nothing;

create table if not exists review_assignments (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null references papers(id),
  volunteer_id uuid not null references staff_members(user_id),
  assigned_by uuid not null,
  assigned_at timestamptz not null default now(),
  ended_at timestamptz,
  ended_by uuid
);
create unique index if not exists review_assignments_active
  on review_assignments (paper_id, volunteer_id) where ended_at is null;
alter table review_assignments enable row level security;
revoke all on table review_assignments from anon, authenticated;

-- Changes to staff, made by a function or by hand in the SQL editor, are
-- always audited.
create or replace function audit_staff_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_actor uuid := nullif(current_setting('app.actor', true), '')::uuid;
begin
  insert into admin_audit_events (actor_id, actor_role, action, detail)
  values (v_actor, case when v_actor is null then 'database:' || current_user else 'administrator' end,
          'staff_' || lower(tg_op),
          jsonb_build_object('user_id', coalesce(new.user_id, old.user_id),
                             'role', coalesce(new.role, old.role),
                             'active', coalesce(new.active, old.active),
                             'was_role', old.role, 'was_active', old.active));
  return coalesce(new, old);
end;
$fn$;
drop trigger if exists staff_members_audit on staff_members;
create trigger staff_members_audit
  after insert or update or delete on staff_members
  for each row execute function audit_staff_change();

-- ------------------------------------------------------------
-- Institutions and academic units.
-- ------------------------------------------------------------
create table if not exists institutions (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,60}$'),
  name_en text not null,
  name_ar text,
  kind text not null default 'university'
    check (kind in ('university', 'research_center', 'agency', 'other')),
  country text not null default 'SD',
  -- Whether this institution's approved records may join the public
  -- collection. A property of the institution, separate from every
  -- record's own review. Making it true never publishes anything.
  public_collection_eligible boolean not null default false,
  eligibility_note text,
  eligibility_changed_at timestamptz,
  eligibility_changed_by uuid,
  source_kind text not null check (source_kind in ('founder_document', 'official_directory', 'reviewer_entered')),
  source_url text,
  source_retrieved_on date,
  source_note text,
  created_at timestamptz not null default now(),
  created_by uuid
);
alter table institutions enable row level security;
revoke all on table institutions from anon, authenticated;

create table if not exists institution_aliases (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references institutions(id),
  alias text not null,
  alias_normalized text not null,
  language text not null default 'other' check (language in ('en', 'ar', 'other')),
  source_kind text not null check (source_kind in ('founder_document', 'official_directory', 'reviewer_entered')),
  source_url text,
  source_note text,
  created_at timestamptz not null default now(),
  unique (institution_id, alias_normalized)
);
create index if not exists institution_aliases_norm on institution_aliases (alias_normalized);
alter table institution_aliases enable row level security;
revoke all on table institution_aliases from anon, authenticated;

create table if not exists academic_units (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references institutions(id),
  parent_unit_id uuid references academic_units(id),
  kind text not null default 'faculty'
    check (kind in ('faculty', 'school', 'institute', 'college', 'department', 'center', 'other')),
  name_en text,
  name_ar text,
  -- 'verified' only after someone compared the name with the source page
  -- and recorded that page and the date. Nothing is auto-matched to a unit
  -- that is not verified.
  verification text not null default 'unverified' check (verification in ('unverified', 'verified')),
  source_kind text not null check (source_kind in ('founder_document', 'official_directory', 'reviewer_entered')),
  source_url text,
  source_retrieved_on date,
  source_note text,
  verified_by uuid,
  verified_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  unique (id, institution_id),
  check (name_en is not null or name_ar is not null),
  check (verification <> 'verified' or (source_url is not null and source_retrieved_on is not null))
);
alter table academic_units enable row level security;
revoke all on table academic_units from anon, authenticated;

create table if not exists academic_unit_aliases (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references academic_units(id),
  alias text not null,
  alias_normalized text not null,
  language text not null default 'other' check (language in ('en', 'ar', 'other')),
  source_note text,
  created_at timestamptz not null default now(),
  unique (unit_id, alias_normalized)
);
alter table academic_unit_aliases enable row level security;
revoke all on table academic_unit_aliases from anon, authenticated;

-- Eligibility changes are audited whoever makes them.
create or replace function audit_institution_eligibility()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_actor uuid := nullif(current_setting('app.actor', true), '')::uuid;
begin
  if tg_op = 'INSERT' or new.public_collection_eligible is distinct from old.public_collection_eligible then
    insert into admin_audit_events (actor_id, actor_role, action, detail)
    values (v_actor, case when v_actor is null then 'database:' || current_user else 'administrator' end,
            'institution_eligibility',
            jsonb_build_object('institution_id', new.id, 'slug', new.slug,
                               'eligible', new.public_collection_eligible,
                               'was_eligible', case when tg_op = 'UPDATE' then old.public_collection_eligible end,
                               'note', new.eligibility_note));
  end if;
  return new;
end;
$fn$;
drop trigger if exists institutions_eligibility_audit on institutions;
create trigger institutions_eligibility_audit
  after insert or update on institutions
  for each row execute function audit_institution_eligibility();

-- The only institution seeded. Its name and its Arabic name come from the
-- founder's own agreement (docs/legal/submission-terms.*.md); eligibility
-- is the founder's decision of 2026-09-26 (PHASE_3_PLAN.md section 1).
--
-- Its faculties and schools are seeded below, after the aliases.
insert into institutions (slug, name_en, name_ar, kind, public_collection_eligible, eligibility_note,
                          source_kind, source_url, source_note)
values ('university-of-khartoum', 'University of Khartoum', 'جامعة الخرطوم', 'university', true,
        'Founder decision 2026-09-26: the first eligible public collection (PHASE_3_PLAN.md section 1).',
        'founder_document', 'https://www.uofk.edu/',
        'Names as written in docs/legal/submission-terms.en.md and .ar.md. Site address as listed by the university''s own web results; the site itself was not opened.')
on conflict (slug) do nothing;

insert into institution_aliases (institution_id, alias, alias_normalized, language, source_kind, source_note)
select i.id, a.alias, normalize_name_text(a.alias), a.language, 'founder_document', a.note
from institutions i
cross join (values
  ('University of Khartoum', 'en', 'docs/legal/submission-terms.en.md'),
  ('جامعة الخرطوم', 'ar', 'docs/legal/submission-terms.ar.md'),
  ('UofK', 'en', 'short form used throughout the founder''s planning documents'),
  ('U of K', 'en', 'common written variant of the short form')
) as a(alias, language, note)
where i.slug = 'university-of-khartoum'
on conflict (institution_id, alias_normalized) do nothing;

-- University of Khartoum academic units: the 21 units listed on the
-- university's official directory, https://uofk.edu/index.php/faculties,
-- as retrieved during the founder's review of this milestone on 2026-09-30.
-- The environment that built this could NOT open that page; the roster is
-- the one recorded in that review, copied exactly (English names only: the
-- review recorded no Arabic headings, and none is invented). Nothing was
-- added to reach any headline count.
-- Repeatable: a unit is inserted only if UofK has no unit with the same
-- normalized English name, so a rerun adds nothing and an existing row
-- (including one entered or mapped by hand) is never changed. Seeded as
-- verified, so an exact normalized match of a submitted faculty name maps
-- automatically; anything else stays for a reviewer. Papers already
-- mapped by a reviewer are untouched (admin_ensure_review never overwrites
-- a reviewer's choice).
insert into academic_units (institution_id, kind, name_en, verification, source_kind, source_url, source_retrieved_on, source_note)
select i.id, u.kind, u.name_en, 'verified', 'official_directory', 'https://uofk.edu/index.php/faculties', date '2026-09-30',
       'Retrieved during the founder''s review on 2026-09-30 (not fetched by the build environment). English heading as listed; no Arabic name recorded.'
from institutions i
cross join (values
  ('faculty', 'Faculty of Arts'),
  ('faculty', 'Faculty of Law'),
  ('faculty', 'Faculty of Science'),
  ('faculty', 'Faculty of Nursing Sciences'),
  ('faculty', 'Faculty of Medicine'),
  ('faculty', 'Faculty of Medical Laboratory Sciences'),
  ('faculty', 'Faculty of Pharmacy'),
  ('faculty', 'Faculty of Dentistry'),
  ('faculty', 'Faculty of Engineering'),
  ('faculty', 'Faculty of Architecture'),
  ('faculty', 'Faculty of Mathematical Sciences'),
  ('school',  'School of Management Studies'),
  ('faculty', 'Faculty of Economic and Social Studies'),
  ('faculty', 'Faculty of Education'),
  ('faculty', 'Faculty of Agriculture'),
  ('faculty', 'Faculty of Forestry'),
  ('faculty', 'Faculty of Animal Production'),
  ('faculty', 'Faculty of Veterinary Medicine'),
  ('faculty', 'Faculty of Geographical and Environmental Sciences'),
  ('faculty', 'Faculty of Technological and Developmental Studies'),
  ('faculty', 'Faculty of Public and Environmental Health')
) as u(kind, name_en)
where i.slug = 'university-of-khartoum'
  and not exists (select 1 from academic_units x
                  where x.institution_id = i.id and normalize_name_text(x.name_en) = normalize_name_text(u.name_en));

-- ------------------------------------------------------------
-- Global release restrictions. Separate from any review decision.
-- ------------------------------------------------------------
create table if not exists release_restrictions (
  key text primary key,
  active boolean not null,
  note text not null,
  changed_at timestamptz not null default now(),
  changed_by text not null
);
alter table release_restrictions enable row level security;
revoke all on table release_restrictions from anon, authenticated;

-- Public FULL-TEXT release stays restricted until the founder records that
-- the legal condition in docs/legal/README.md is met (Sudan-qualified
-- advice on whether checkbox-only acceptance suffices, Copyright Act 2013
-- Art. 8(2)). There is no application path to lift it: it is a deliberate
-- edit in the SQL editor (docs/admin-review.md), audited by the trigger
-- below. Approving a record never lifts it.
insert into release_restrictions (key, active, note, changed_by)
values ('fulltext_legal_advice', true,
        'Public full-text release waits for Sudan-qualified legal advice on checkbox-only authorization (docs/legal/README.md).',
        'founder decision 2026-09-26')
on conflict (key) do nothing;

create or replace function audit_release_restriction()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  insert into admin_audit_events (actor_role, action, detail)
  values ('database:' || current_user, 'release_restriction_' || lower(tg_op),
          jsonb_build_object('key', coalesce(new.key, old.key), 'active', new.active, 'was_active', old.active,
                             'note', new.note, 'changed_by', new.changed_by));
  return coalesce(new, old);
end;
$fn$;
drop trigger if exists release_restrictions_audit on release_restrictions;
create trigger release_restrictions_audit
  after insert or update or delete on release_restrictions
  for each row execute function audit_release_restriction();

-- ------------------------------------------------------------
-- Review records.
-- ------------------------------------------------------------
create table if not exists paper_reviews (
  paper_id uuid primary key references papers(id),
  -- The latest review decision. 'reviewed' means checked and held
  -- privately; 'approved' means approved for publication.
  status text not null default 'pending'
    check (status in ('pending', 'needs_changes', 'reviewed', 'approved', 'declined', 'withdrawn')),
  status_reason text,
  status_changed_at timestamptz,
  status_changed_by uuid,

  institution_id uuid references institutions(id),
  academic_unit_id uuid,
  institution_basis text check (institution_basis in ('alias_exact', 'reviewer', 'reviewer_none')),
  institution_set_at timestamptz,
  institution_set_by uuid,
  foreign key (academic_unit_id, institution_id) references academic_units(id, institution_id),
  check (academic_unit_id is null or institution_id is not null),

  -- Records from before the acceptance flow: what an administrator
  -- determined their old consent covers. Null = undetermined = held.
  legacy_setting text check (legacy_setting in ('record_abstract', 'record_abstract_fulltext', 'hold')),
  legacy_note text,
  legacy_set_at timestamptz,
  legacy_set_by uuid,

  -- The submitter's claimed identity and authority are never verified by
  -- acceptance. A reviewer may record that they verified authority.
  authority_verified_at timestamptz,
  authority_verified_by uuid,
  authority_note text,

  -- Restrictions, separate from the decision.
  withdrawn_at timestamptz,
  withdrawn_reason text,
  embargo_until date,
  embargo_note text,

  -- The content fingerprint last seen by staff, so a later change by the
  -- submitter is noticed and logged once (review_log_material_change).
  content_fingerprint_seen text,

  created_at timestamptz not null default now()
);
alter table paper_reviews enable row level security;
revoke all on table paper_reviews from anon, authenticated;

create table if not exists review_notes (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null references papers(id),
  author_id uuid not null,
  author_role text not null,
  body text not null check (length(body) between 1 and 5000),
  created_at timestamptz not null default now()
);
create index if not exists review_notes_paper on review_notes (paper_id, created_at);
alter table review_notes enable row level security;
revoke all on table review_notes from anon, authenticated;
drop trigger if exists review_notes_no_change on review_notes;
create trigger review_notes_no_change
  before update or delete on review_notes
  for each row execute function refuse_change();

create table if not exists review_issues (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null references papers(id),
  kind text not null check (kind in ('metadata', 'rights', 'duplicate', 'document', 'privacy', 'other')),
  description text not null check (length(description) between 1 and 2000),
  blocking boolean not null default true,
  state text not null default 'open' check (state in ('open', 'resolved')),
  raised_by uuid not null,
  raised_at timestamptz not null default now(),
  resolved_by uuid,
  resolved_at timestamptz,
  resolution text
);
create index if not exists review_issues_paper on review_issues (paper_id);
alter table review_issues enable row level security;
revoke all on table review_issues from anon, authenticated;

create table if not exists document_versions (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null references papers(id),
  kind text not null check (kind in ('original', 'dissemination')),
  origin text not null check (origin in ('submitted_file', 'original_reviewed', 'redacted_copy')),
  storage_path text not null unique,
  file_extension text not null check (file_extension in ('pdf', 'docx')),
  declared_size bigint check (declared_size is null or (declared_size > 0 and declared_size <= 20971520)),
  size_bytes bigint,
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  derived_from uuid references document_versions(id),
  provenance_note text,
  redaction_note text,
  state text not null default 'pending_upload'
    check (state in ('pending_upload', 'recorded', 'proposed', 'approved', 'superseded', 'withdrawn')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  uploaded_at timestamptz,
  approved_by uuid,
  approved_at timestamptz,
  check (kind <> 'dissemination' or origin in ('original_reviewed', 'redacted_copy')),
  check (kind <> 'original' or origin = 'submitted_file'),
  check (state in ('pending_upload', 'withdrawn') or sha256 is not null)
);
create index if not exists document_versions_paper on document_versions (paper_id);
alter table document_versions enable row level security;
revoke all on table document_versions from anon, authenticated;

-- Immutable: what was approved, and against exactly what. A later decision
-- changes the paper's status, never these rows.
create table if not exists review_approvals (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null references papers(id),
  approved_by uuid not null,
  approved_at timestamptz not null default now(),
  content_fingerprint text not null,
  revision text not null,
  institution_id uuid not null references institutions(id),
  academic_unit_id uuid,
  publication_setting text not null check (publication_setting in ('record_abstract', 'record_abstract_fulltext')),
  setting_basis text not null check (setting_basis in ('acceptance', 'legacy_determination')),
  acceptance_id uuid,
  authority_verified boolean not null,
  dissemination_version_id uuid references document_versions(id),
  dissemination_sha256 text,
  snapshot jsonb not null
);
-- A blocking issue raised while an approval is in force records that
-- approval here. The approval is then permanently superseded: resolving the
-- issue does not revive it, a fresh administrator approval is required, and
-- the earlier approval row stays as evidence (review_approvals is
-- append-only). Set once, at insert, under the paper lock.
alter table review_issues add column if not exists suspends_approval_id uuid references review_approvals(id);
create index if not exists review_approvals_paper on review_approvals (paper_id, approved_at);
alter table review_approvals enable row level security;
revoke all on table review_approvals from anon, authenticated;
drop trigger if exists review_approvals_no_change on review_approvals;
create trigger review_approvals_no_change
  before update or delete on review_approvals
  for each row execute function refuse_change();

-- ------------------------------------------------------------
-- Access rules: one place, used by every function below.
-- ------------------------------------------------------------
create or replace function admin_actor_role(p_actor uuid)
returns text
language sql
stable
security definer
set search_path = public
as $fn$
  select role from staff_members where user_id = p_actor and active
$fn$;

create or replace function admin_active_confidentiality()
returns text
language sql
stable
security definer
set search_path = public
as $fn$
  select id from confidentiality_versions where active order by version_date desc, id desc limit 1
$fn$;

-- False when no version is active: nobody can open a submission as a
-- volunteer before the founder activates a text.
create or replace function admin_has_acknowledged(p_actor uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from confidentiality_acknowledgements a
    where a.user_id = p_actor and a.version_id = admin_active_confidentiality())
$fn$;

create or replace function admin_require_role(p_actor uuid, p_roles text[])
returns text
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_role text := admin_actor_role(p_actor);
begin
  if v_role is null or not (v_role = any(p_roles)) then
    raise exception 'admin:forbidden';
  end if;
  return v_role;
end;
$fn$;

-- Administrators: any submission. Volunteers: only an assigned one, and
-- only after acknowledging the current confidentiality text. For a
-- volunteer, an unassigned and a nonexistent submission look the same.
create or replace function admin_require_access(p_actor uuid, p_paper uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_role text := admin_actor_role(p_actor);
begin
  if v_role is null then
    raise exception 'admin:forbidden';
  end if;
  if v_role = 'administrator' then
    if not exists (select 1 from papers where id = p_paper) then
      raise exception 'admin:not_found';
    end if;
    return v_role;
  end if;
  if not exists (select 1 from review_assignments
                 where paper_id = p_paper and volunteer_id = p_actor and ended_at is null) then
    raise exception 'admin:forbidden';
  end if;
  if not admin_has_acknowledged(p_actor) then
    raise exception 'admin:confidentiality_required';
  end if;
  return v_role;
end;
$fn$;

-- ------------------------------------------------------------
-- What a review is about. The content fingerprint covers everything a
-- submitter can change that matters to a publication decision; the
-- revision adds the review-owned facts. An approval names both.
-- ------------------------------------------------------------
create or replace function review_content_fingerprint(p_paper uuid)
returns text
language sql
stable
security definer
set search_path = public, extensions
as $fn$
  select encode(digest(jsonb_build_object(
    'title', p.title, 'title_ar', p.title_ar,
    'abstract', p.abstract, 'abstract_ar', p.abstract_ar,
    'supervisor', p.supervisor_name, 'university', p.university, 'faculty', p.faculty,
    'degree', p.degree_type, 'year', p.year, 'document_type', p.document_type,
    'setting', p.publication_setting, 'scope', to_jsonb(p.publication_scope),
    'file', coalesce(p.file_sha256, p.file_path),
    'authors', coalesce((
      select jsonb_agg(jsonb_build_object('name', r.full_name, 'order', pr.author_order)
                       order by pr.author_order nulls last, r.full_name, r.id)
      from paper_researchers pr join researchers r on r.id = pr.researcher_id
      where pr.paper_id = p.id), '[]'::jsonb)
  )::text, 'sha256'), 'hex')
  from papers p where p.id = p_paper
$fn$;

create or replace function review_revision(p_paper uuid)
returns text
language sql
stable
security definer
set search_path = public, extensions
as $fn$
  select encode(digest(jsonb_build_object(
    'content', review_content_fingerprint(p_paper),
    'status', r.status, 'status_at', r.status_changed_at,
    'institution', r.institution_id, 'unit', r.academic_unit_id, 'basis', r.institution_basis,
    'legacy', r.legacy_setting, 'authority', r.authority_verified_at,
    'withdrawn', r.withdrawn_at, 'embargo', r.embargo_until,
    'issues', coalesce((select jsonb_agg(i.id::text || ':' || i.state order by i.id)
                        from review_issues i where i.paper_id = p_paper), '[]'::jsonb),
    'documents', coalesce((select jsonb_agg(d.id::text || ':' || d.state order by d.id)
                           from document_versions d where d.paper_id = p_paper), '[]'::jsonb)
  )::text, 'sha256'), 'hex')
  from paper_reviews r where r.paper_id = p_paper
$fn$;

-- ------------------------------------------------------------
-- Institution matching. Exact normalized alias, and only when exactly one
-- institution has it. Anything else is left for a reviewer.
-- ------------------------------------------------------------
create or replace function review_match_institution(p_paper uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $fn$
  select (array_agg(distinct a.institution_id))[1]
  from papers p
  join institution_aliases a on a.alias_normalized = normalize_name_text(p.university)
  where p.id = p_paper
  having count(distinct a.institution_id) = 1
$fn$;

-- Only VERIFIED units are ever matched automatically.
create or replace function review_match_unit(p_paper uuid, p_institution uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $fn$
  select (array_agg(distinct u.id))[1]
  from papers p
  join academic_units u on u.institution_id = p_institution and u.active and u.verification = 'verified'
  where p.id = p_paper and normalize_name_text(p.faculty) is not null
    and (normalize_name_text(u.name_en) = normalize_name_text(p.faculty)
         or normalize_name_text(u.name_ar) = normalize_name_text(p.faculty)
         or exists (select 1 from academic_unit_aliases x
                    where x.unit_id = u.id and x.alias_normalized = normalize_name_text(p.faculty)))
  having count(distinct u.id) = 1
$fn$;

create or replace function admin_ensure_review(p_paper uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_inst uuid;
  v_unit uuid;
begin
  insert into paper_reviews (paper_id) values (p_paper) on conflict (paper_id) do nothing;
  v_inst := review_match_institution(p_paper);
  if v_inst is not null then
    update paper_reviews set institution_id = v_inst, institution_basis = 'alias_exact', institution_set_at = now()
    where paper_id = p_paper and institution_basis is null;
  end if;
  select institution_id into v_inst from paper_reviews where paper_id = p_paper and institution_basis = 'alias_exact' and academic_unit_id is null;
  if v_inst is not null then
    v_unit := review_match_unit(p_paper, v_inst);
    if v_unit is not null then
      update paper_reviews set academic_unit_id = v_unit where paper_id = p_paper and institution_basis = 'alias_exact';
    end if;
  end if;
end;
$fn$;

-- ------------------------------------------------------------
-- Checks. Advisory aids for the reviewer, except where a rule below
-- says it blocks approval.
-- ------------------------------------------------------------
-- The agreed minimum metadata, stated once. A publishable record needs:
--   * confirmation by the submitter;
--   * a title in AT LEAST ONE language (Arabic and English are never both
--     required, and nothing is filled in);
--   * at least one named author;
--   * a year between 1900 and 2100;
--   * an abstract in AT LEAST ONE language;
--   * a document not classified as not_research.
-- Supervisor, degree, university, faculty and document type are advisory.
create or replace function review_metadata_check(p_paper uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  p papers%rowtype;
  v_missing text[] := '{}';
  v_advisory text[] := '{}';
  v_authors int;
begin
  select * into p from papers where id = p_paper;
  if not found then
    return null;
  end if;
  if p.metadata_confirmed_at is null then v_missing := array_append(v_missing, 'confirmed'); end if;
  if nullif(btrim(coalesce(p.title, '')), '') is null and nullif(btrim(coalesce(p.title_ar, '')), '') is null then
    v_missing := array_append(v_missing, 'title');
  end if;
  select count(*) into v_authors
  from paper_researchers pr join researchers r on r.id = pr.researcher_id
  where pr.paper_id = p_paper and nullif(btrim(r.full_name), '') is not null;
  if v_authors = 0 then v_missing := array_append(v_missing, 'authors'); end if;
  if p.year is null or p.year < 1900 or p.year > 2100 then v_missing := array_append(v_missing, 'year'); end if;
  if nullif(btrim(coalesce(p.abstract, '')), '') is null and nullif(btrim(coalesce(p.abstract_ar, '')), '') is null then
    v_missing := array_append(v_missing, 'abstract');
  end if;
  if p.document_type = 'not_research' then v_missing := array_append(v_missing, 'document_type_not_research'); end if;

  if p.document_type is null then v_advisory := array_append(v_advisory, 'document_type'); end if;
  if p.document_type = 'thesis' and nullif(btrim(coalesce(p.supervisor_name, '')), '') is null then v_advisory := array_append(v_advisory, 'supervisor_name'); end if;
  if p.document_type = 'thesis' and nullif(btrim(coalesce(p.degree_type, '')), '') is null then v_advisory := array_append(v_advisory, 'degree_type'); end if;
  if nullif(btrim(coalesce(p.university, '')), '') is null then v_advisory := array_append(v_advisory, 'university'); end if;
  if nullif(btrim(coalesce(p.faculty, '')), '') is null then v_advisory := array_append(v_advisory, 'faculty'); end if;

  return jsonb_build_object('ok', cardinality(v_missing) = 0, 'missing', to_jsonb(v_missing), 'advisory', to_jsonb(v_advisory));
end;
$fn$;

-- What supports the publication setting. The acceptance record is a
-- CLAIM by the submitter, recorded by the server: it never verifies
-- identity or authority. Legacy rows get no acceptance and no new setting;
-- an administrator may determine, within what the old checkboxes covered,
-- what the old consent supports, and anything undetermined is held.
create or replace function review_permission_evidence(p_paper uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  p papers%rowtype;
  a submission_acceptances%rowtype;
  r paper_reviews%rowtype;
  v_problems text[] := '{}';
  v_setting text;
  v_basis text;
begin
  select * into p from papers where id = p_paper;
  if not found then
    return null;
  end if;
  select * into r from paper_reviews where paper_id = p_paper;
  if p.submission_acceptance_id is not null then
    v_basis := 'acceptance';
    select * into a from submission_acceptances where id = p.submission_acceptance_id;
    if not found or a.status <> 'finalized' or a.paper_id is distinct from p.id then
      v_problems := array_append(v_problems, 'acceptance_record_missing');
    else
      v_setting := a.publication_setting;
      if p.publication_setting is distinct from a.publication_setting then v_problems := array_append(v_problems, 'setting_mismatch'); end if;
      if not exists (select 1 from agreement_versions v where v.id = a.agreement_version_id and v.content_sha256 = a.agreement_sha256) then
        v_problems := array_append(v_problems, 'agreement_unrecognised');
      end if;
    end if;
  else
    v_basis := 'legacy';
    if r.legacy_setting is null then
      v_problems := array_append(v_problems, 'legacy_permission_undetermined');
    elsif r.legacy_setting = 'hold' then
      v_problems := array_append(v_problems, 'legacy_held_for_authorization');
    else
      v_setting := r.legacy_setting;
      if v_setting = 'record_abstract_fulltext' and not ('full_paper' = any(p.publication_scope)) then
        v_problems := array_append(v_problems, 'legacy_grant_does_not_cover_full_text');
      end if;
      if v_setting = 'record_abstract' and cardinality(p.publication_scope) = 0 then
        v_problems := array_append(v_problems, 'legacy_grant_empty');
      end if;
    end if;
  end if;
  return jsonb_build_object(
    'ok', cardinality(v_problems) = 0 and v_setting is not null,
    'basis', v_basis, 'setting', v_setting, 'problems', to_jsonb(v_problems),
    'claimed_role', a.claimed_role,
    'claimed_identity_verified_by_acceptance', coalesce(a.identity_verified, false),
    'authority_verified_by_reviewer', r.authority_verified_at is not null,
    'legacy_scope', case when v_basis = 'legacy' then to_jsonb(p.publication_scope) end);
end;
$fn$;

create or replace function review_institution_state(p_paper uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
  select jsonb_build_object(
    'institution_id', r.institution_id, 'basis', r.institution_basis,
    'name_en', i.name_en, 'name_ar', i.name_ar, 'eligible', coalesce(i.public_collection_eligible, false),
    'unit_id', r.academic_unit_id, 'unit_name_en', u.name_en, 'unit_name_ar', u.name_ar,
    'unit_verification', u.verification,
    'submitted_university', p.university, 'submitted_faculty', p.faculty)
  from papers p
  left join paper_reviews r on r.paper_id = p.id
  left join institutions i on i.id = r.institution_id
  left join academic_units u on u.id = r.academic_unit_id
  where p.id = p_paper
$fn$;

create or replace function title_tokens(p text)
returns text[]
language sql
immutable
set search_path = public
as $fn$
  select case when normalize_name_text(p) is null then '{}'::text[]
              else regexp_split_to_array(normalize_name_text(p), ' ') end
$fn$;

-- Advisory only. An exact file hash, or a normalized title that is nearly
-- the same in a nearby year. Never merges, hides, rejects or labels
-- anything; the reviewer decides what a match means.
create or replace function review_duplicates(p_paper uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  me papers%rowtype;
  rec record;
  v_score numeric;
  v_exact boolean;
  v_out jsonb := '[]'::jsonb;
begin
  select * into me from papers where id = p_paper;
  if not found then
    return v_out;
  end if;
  for rec in
    select o.id, o.title, o.title_ar, o.year, o.file_sha256, o.created_at, coalesce(rv.status, 'pending') as status
    from papers o left join paper_reviews rv on rv.paper_id = o.id
    where o.id <> p_paper
  loop
    v_exact := me.file_sha256 is not null and rec.file_sha256 = me.file_sha256;
    v_score := greatest(
      token_jaccard(title_tokens(me.title), title_tokens(rec.title)),
      token_jaccard(title_tokens(me.title_ar), title_tokens(rec.title_ar)),
      token_jaccard(title_tokens(me.title), title_tokens(rec.title_ar)),
      token_jaccard(title_tokens(me.title_ar), title_tokens(rec.title)));
    if v_exact or (v_score >= 0.75 and (me.year is null or rec.year is null or abs(me.year - rec.year) <= 1)) then
      v_out := v_out || jsonb_build_object(
        'paper_id', rec.id, 'kind', case when v_exact then 'same_file' else 'similar_title' end,
        'score', round(case when v_exact then 1 else v_score end, 2),
        'title', coalesce(rec.title, rec.title_ar), 'year', rec.year, 'status', rec.status,
        'submitted_at', rec.created_at);
    end if;
  end loop;
  return v_out;
end;
$fn$;

-- ------------------------------------------------------------
-- The shared publication rule. M5's public routes call this, server-side,
-- for every public path (page, file, search, sitemap, export, counts).
-- It combines the review decision with facts that are NOT the decision:
-- the institution's eligibility, withdrawal, embargo, and the full-text
-- legal restriction. Nothing here publishes anything by itself.
-- ------------------------------------------------------------
create or replace function publication_eligibility(p_paper uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $fn$
declare
  p papers%rowtype;
  r paper_reviews%rowtype;
  a review_approvals%rowtype;
  inst institutions%rowtype;
  d document_versions%rowtype;
  v_reasons text[] := '{}';
  v_full_reasons text[] := '{}';
  v_valid boolean := false;
  v_meta jsonb;
  v_evi jsonb;
  v_embargo_active boolean := false;
  v_record boolean;
  v_full boolean := false;
  v_restricted boolean;
begin
  select * into p from papers where id = p_paper;
  if not found then
    return jsonb_build_object('paper_id', p_paper, 'exists', false, 'review_approved', false,
      'record_public', false, 'abstract_public', false, 'fulltext_public', false,
      'reasons', jsonb_build_array('not_found'), 'fulltext_reasons', jsonb_build_array('not_found'));
  end if;
  select * into r from paper_reviews where paper_id = p_paper;
  v_restricted := coalesce((select active from release_restrictions where key = 'fulltext_legal_advice'), true);

  if r.paper_id is null or r.status <> 'approved' then
    v_reasons := array_append(v_reasons, 'not_approved');
  else
    select * into a from review_approvals where paper_id = p_paper order by approved_at desc, id desc limit 1;
    if not found then
      v_reasons := array_append(v_reasons, 'no_approval_record');
    else
      v_valid := true;
      if a.content_fingerprint is distinct from review_content_fingerprint(p_paper) then
        v_valid := false; v_reasons := array_append(v_reasons, 'content_changed_since_approval');
      end if;
      if a.institution_id is distinct from r.institution_id or a.academic_unit_id is distinct from r.academic_unit_id then
        v_valid := false; v_reasons := array_append(v_reasons, 'institution_mapping_changed_since_approval');
      end if;
      v_meta := review_metadata_check(p_paper);
      if not (v_meta->>'ok')::boolean then
        v_valid := false; v_reasons := array_append(v_reasons, 'metadata_incomplete');
      end if;
      v_evi := review_permission_evidence(p_paper);
      if not (v_evi->>'ok')::boolean or v_evi->>'setting' is distinct from a.publication_setting then
        v_valid := false; v_reasons := array_append(v_reasons, 'permission_evidence_changed');
      end if;
      if v_evi->>'claimed_role' = 'authorized_depositor' and r.authority_verified_at is null then
        v_valid := false; v_reasons := array_append(v_reasons, 'authority_unverified');
      end if;
      if exists (select 1 from review_issues i where i.suspends_approval_id = a.id and i.blocking) then
        v_valid := false; v_reasons := array_append(v_reasons, 'blocking_issue_since_approval');
      end if;
    end if;
  end if;
  -- Any open blocking issue refuses every public use, whatever the approval.
  if exists (select 1 from review_issues i where i.paper_id = p_paper and i.state = 'open' and i.blocking) then
    v_reasons := array_append(v_reasons, 'blocking_issue_open');
  end if;

  if a.id is not null then
    select * into inst from institutions where id = a.institution_id;
    if not coalesce(inst.public_collection_eligible, false) then v_reasons := array_append(v_reasons, 'institution_not_eligible'); end if;
  elsif r.institution_id is not null then
    select * into inst from institutions where id = r.institution_id;
  end if;
  if r.withdrawn_at is not null then v_reasons := array_append(v_reasons, 'withdrawn'); end if;
  v_embargo_active := r.embargo_until is not null and r.embargo_until > current_date;
  if v_embargo_active then v_reasons := array_append(v_reasons, 'embargo'); end if;

  v_record := v_valid and cardinality(v_reasons) = 0;

  if not v_record then
    v_full_reasons := v_reasons;
  elsif a.publication_setting <> 'record_abstract_fulltext' then
    v_full_reasons := array_append(v_full_reasons, 'setting_is_record_abstract');
  else
    select * into d from document_versions where id = a.dissemination_version_id;
    if not found or d.state <> 'approved' or d.sha256 is distinct from a.dissemination_sha256 then
      v_full_reasons := array_append(v_full_reasons, 'dissemination_copy_not_approved');
    end if;
    if v_restricted then v_full_reasons := array_append(v_full_reasons, 'fulltext_legal_condition_pending'); end if;
    v_full := cardinality(v_full_reasons) = 0;
  end if;

  return jsonb_build_object(
    'paper_id', p_paper, 'exists', true,
    'review_approved', v_valid,
    'record_public', v_record, 'abstract_public', v_record, 'fulltext_public', v_full,
    'reasons', to_jsonb(v_reasons), 'fulltext_reasons', to_jsonb(v_full_reasons),
    'setting', a.publication_setting, 'approval_id', a.id,
    'dissemination_version_id', case when v_full then a.dissemination_version_id end,
    'restrictions', jsonb_build_object(
      'institution_eligible', coalesce(inst.public_collection_eligible, false),
      'withdrawn', r.withdrawn_at is not null,
      'embargo_until', r.embargo_until, 'embargo_active', v_embargo_active,
      'fulltext_legal_condition_active', v_restricted));
end;
$fn$;

-- A material change by the submitter after staff last saw the record is
-- logged once, when next noticed. The blocking effect does not depend on
-- this log: publication_eligibility compares fingerprints every time.
create or replace function review_log_material_change(p_paper uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  r paper_reviews%rowtype;
  a review_approvals%rowtype;
  v_cur text := review_content_fingerprint(p_paper);
  v_fields text[] := '{}';
  v_key text;
  v_now jsonb;
begin
  select * into r from paper_reviews where paper_id = p_paper for update;
  if not found then
    return;
  end if;
  if r.content_fingerprint_seen is null then
    update paper_reviews set content_fingerprint_seen = v_cur where paper_id = p_paper;
    return;
  end if;
  if r.content_fingerprint_seen = v_cur then
    return;
  end if;
  select * into a from review_approvals where paper_id = p_paper order by approved_at desc, id desc limit 1;
  if found then
    select to_jsonb(x) into v_now from (
      select title, title_ar, abstract, abstract_ar, supervisor_name, year, university, faculty, degree_type, document_type
      from papers where id = p_paper) x;
    for v_key in select jsonb_object_keys(v_now) loop
      if (a.snapshot->'metadata'->v_key) is distinct from (v_now->v_key) then v_fields := v_fields || v_key; end if;
    end loop;
    if (a.snapshot->'authors') is distinct from (select coalesce(jsonb_agg(jsonb_build_object('name', rr.full_name, 'order', pr.author_order)
                                      order by pr.author_order nulls last, rr.full_name), '[]'::jsonb)
                                      from paper_researchers pr join researchers rr on rr.id = pr.researcher_id where pr.paper_id = p_paper) then
      v_fields := array_append(v_fields, 'authors');
    end if;
  end if;
  insert into admin_audit_events (paper_id, actor_role, action, detail)
  values (p_paper, 'submitter', 'content_changed',
          jsonb_build_object('previous_fingerprint', r.content_fingerprint_seen, 'current_fingerprint', v_cur,
                             'status_at_detection', r.status, 'since_approval_id', a.id,
                             'fields_changed_since_approval', to_jsonb(v_fields),
                             'approval_still_valid', a.id is not null and r.status = 'approved' and a.content_fingerprint = v_cur));
  update paper_reviews set content_fingerprint_seen = v_cur where paper_id = p_paper;
end;
$fn$;

-- ------------------------------------------------------------
-- Who am I, and confidentiality.
-- ------------------------------------------------------------
create or replace function admin_context(p_actor uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_role text := admin_actor_role(p_actor);
  v_ver text := admin_active_confidentiality();
begin
  if v_role is null then
    raise exception 'admin:forbidden';
  end if;
  return jsonb_build_object(
    'user_id', p_actor, 'role', v_role,
    'confidentiality_version_id', v_ver,
    'confidentiality_required', v_role = 'volunteer',
    'acknowledged', admin_has_acknowledged(p_actor),
    'acknowledged_at', (select a.acknowledged_at from confidentiality_acknowledgements a where a.user_id = p_actor and a.version_id = v_ver));
end;
$fn$;

create or replace function admin_acknowledge_confidentiality(p_actor uuid, p_language text, p_sha256 text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_role text := admin_require_role(p_actor, array['administrator', 'volunteer']);
  v confidentiality_versions%rowtype;
  v_expected text;
begin
  select * into v from confidentiality_versions where id = admin_active_confidentiality();
  if not found then
    return jsonb_build_object('ok', false, 'error', 'no_active_version');
  end if;
  v_expected := case when p_language = 'en' then v.sha256_en when p_language = 'ar' then v.sha256_ar end;
  if v_expected is null or p_sha256 is distinct from v_expected then
    return jsonb_build_object('ok', false, 'error', 'text_mismatch');
  end if;
  insert into confidentiality_acknowledgements (user_id, version_id, language, text_sha256)
  values (p_actor, v.id, p_language, p_sha256)
  on conflict (user_id, version_id) do nothing;
  perform admin_log(null, p_actor, v_role, 'confidentiality_acknowledged',
                    jsonb_build_object('version_id', v.id, 'version_label', v.version_label, 'language', p_language));
  return jsonb_build_object('ok', true, 'version_id', v.id);
end;
$fn$;

-- ------------------------------------------------------------
-- Staff. Only an administrator, only for an existing, email-confirmed
-- Auth user, and never leaving the system without an active administrator.
-- ------------------------------------------------------------
create or replace function admin_set_staff(p_actor uuid, p_user uuid, p_role text, p_active boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_confirmed timestamptz;
  v_exists boolean;
begin
  perform admin_require_role(p_actor, array['administrator']);
  if p_role not in ('administrator', 'volunteer') then
    raise exception 'admin:invalid_input';
  end if;
  select true, email_confirmed_at into v_exists, v_confirmed from auth.users where id = p_user;
  if v_exists is not true then
    raise exception 'admin:user_not_found';
  end if;
  if v_confirmed is null then
    raise exception 'admin:user_unconfirmed';
  end if;
  perform set_config('app.actor', p_actor::text, true);
  insert into staff_members (user_id, role, active, created_by)
  values (p_user, p_role, coalesce(p_active, true), p_actor)
  on conflict (user_id) do update
    set role = excluded.role, active = excluded.active,
        deactivated_at = case when excluded.active then null else now() end,
        deactivated_by = case when excluded.active then null else p_actor end;
  if not exists (select 1 from staff_members where role = 'administrator' and active) then
    raise exception 'admin:last_administrator';
  end if;
  return jsonb_build_object('ok', true, 'user_id', p_user, 'role', p_role, 'active', coalesce(p_active, true));
end;
$fn$;

create or replace function admin_list_staff(p_actor uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
begin
  perform admin_require_role(p_actor, array['administrator']);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id', s.user_id, 'email', u.email, 'role', s.role, 'active', s.active,
      'acknowledged', exists (select 1 from confidentiality_acknowledgements a where a.user_id = s.user_id and a.version_id = admin_active_confidentiality()),
      'acknowledged_at', (select a.acknowledged_at from confidentiality_acknowledgements a where a.user_id = s.user_id and a.version_id = admin_active_confidentiality()),
      'created_at', s.created_at) order by s.role, u.email)
    from staff_members s join auth.users u on u.id = s.user_id), '[]'::jsonb);
end;
$fn$;

-- The one-time first administrator. NOT executable by anon, authenticated
-- or service_role: only the database owner can run it, from the SQL editor
-- (docs/admin-review.md). It refuses once any active administrator exists,
-- and never trusts an email address: the Auth user id is given explicitly
-- and must belong to a confirmed account.
create or replace function bootstrap_first_administrator(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if exists (select 1 from staff_members where role = 'administrator' and active) then
    raise exception 'an active administrator already exists; use the application to manage staff';
  end if;
  if not exists (select 1 from auth.users where id = p_user_id and email_confirmed_at is not null) then
    raise exception 'no confirmed Supabase Auth user has that id';
  end if;
  insert into staff_members (user_id, role, active, created_by)
  values (p_user_id, 'administrator', true, null)
  on conflict (user_id) do update set role = 'administrator', active = true, deactivated_at = null, deactivated_by = null;
end;
$fn$;

-- ------------------------------------------------------------
-- Assignments.
-- ------------------------------------------------------------
create or replace function admin_assign(p_actor uuid, p_paper uuid, p_volunteer uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
begin
  perform admin_require_role(p_actor, array['administrator']);
  if not exists (select 1 from papers where id = p_paper) then
    raise exception 'admin:not_found';
  end if;
  if not exists (select 1 from staff_members where user_id = p_volunteer and role = 'volunteer' and active) then
    raise exception 'admin:invalid_input';
  end if;
  perform admin_ensure_review(p_paper);
  insert into review_assignments (paper_id, volunteer_id, assigned_by)
  values (p_paper, p_volunteer, p_actor)
  on conflict (paper_id, volunteer_id) where ended_at is null do nothing;
  perform admin_log(p_paper, p_actor, 'administrator', 'volunteer_assigned', jsonb_build_object('volunteer_id', p_volunteer));
  return jsonb_build_object('ok', true);
end;
$fn$;

create or replace function admin_unassign(p_actor uuid, p_paper uuid, p_volunteer uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
begin
  perform admin_require_role(p_actor, array['administrator']);
  update review_assignments set ended_at = now(), ended_by = p_actor
  where paper_id = p_paper and volunteer_id = p_volunteer and ended_at is null;
  perform admin_log(p_paper, p_actor, 'administrator', 'volunteer_unassigned', jsonb_build_object('volunteer_id', p_volunteer));
  return jsonb_build_object('ok', true);
end;
$fn$;

-- ------------------------------------------------------------
-- Approval preconditions, stated once. Used to refuse an approval and to
-- show a reviewer what still blocks it.
-- ------------------------------------------------------------
create or replace function review_approval_preconditions(p_paper uuid, p_dissemination uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  r paper_reviews%rowtype;
  v_meta jsonb := review_metadata_check(p_paper);
  v_evi jsonb := review_permission_evidence(p_paper);
  v_inst institutions%rowtype;
  v_fail jsonb := '[]'::jsonb;
  v_missing jsonb;
  v_open int;
  d document_versions%rowtype;
begin
  select * into r from paper_reviews where paper_id = p_paper;
  if (v_meta->'missing') ? 'confirmed' then
    v_fail := v_fail || jsonb_build_object('code', 'metadata_not_confirmed');
  end if;
  select coalesce(jsonb_agg(m), '[]'::jsonb) into v_missing from jsonb_array_elements_text(v_meta->'missing') m where m <> 'confirmed';
  if jsonb_array_length(v_missing) > 0 then
    v_fail := v_fail || jsonb_build_object('code', 'metadata_incomplete', 'detail', v_missing);
  end if;
  if r.institution_id is null then
    v_fail := v_fail || jsonb_build_object('code', 'institution_unresolved');
  else
    select * into v_inst from institutions where id = r.institution_id;
    if not v_inst.public_collection_eligible then
      v_fail := v_fail || jsonb_build_object('code', 'institution_not_eligible', 'detail', v_inst.name_en);
    end if;
  end if;
  if not (v_evi->>'ok')::boolean then
    v_fail := v_fail || jsonb_build_object('code', 'permission_not_supported', 'detail', v_evi->'problems');
  end if;
  if v_evi->>'claimed_role' = 'authorized_depositor' and r.authority_verified_at is null then
    v_fail := v_fail || jsonb_build_object('code', 'authority_unverified');
  end if;
  select count(*) into v_open from review_issues where paper_id = p_paper and state = 'open' and blocking;
  if v_open > 0 then
    v_fail := v_fail || jsonb_build_object('code', 'blocking_issue_open', 'detail', v_open);
  end if;
  if r.withdrawn_at is not null then
    v_fail := v_fail || jsonb_build_object('code', 'withdrawn_reopen_first');
  end if;
  if v_evi->>'setting' = 'record_abstract_fulltext' then
    if p_dissemination is null then
      v_fail := v_fail || jsonb_build_object('code', 'dissemination_copy_required');
    else
      select * into d from document_versions where id = p_dissemination;
      if not found or d.paper_id <> p_paper or d.kind <> 'dissemination' or d.state not in ('proposed', 'approved') or d.sha256 is null then
        v_fail := v_fail || jsonb_build_object('code', 'dissemination_copy_invalid');
      end if;
    end if;
  elsif p_dissemination is not null then
    v_fail := v_fail || jsonb_build_object('code', 'dissemination_copy_not_applicable');
  end if;
  return jsonb_build_object('ok', jsonb_array_length(v_fail) = 0, 'failures', v_fail);
end;
$fn$;

-- ------------------------------------------------------------
-- The decision. Administrators only. Locks the paper and its review, and
-- refuses when the screen it was made on is out of date, so a decision can
-- never land on a revision the reviewer did not see.
-- ------------------------------------------------------------
create or replace function admin_decide(
  p_actor uuid, p_paper uuid, p_decision text, p_reason text,
  p_expected_revision text, p_dissemination uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  r paper_reviews%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_rev text;
  v_pre jsonb;
  v_evi jsonb;
  v_meta jsonb;
  v_approval uuid;
  v_snapshot jsonb;
  v_from text;
  d document_versions%rowtype;
begin
  perform admin_require_role(p_actor, array['administrator']);
  if p_decision not in ('needs_changes', 'reviewed', 'approved', 'declined', 'withdrawn', 'reopen') then
    raise exception 'admin:invalid_input';
  end if;
  if length(coalesce(v_reason, '')) > 2000 then
    raise exception 'admin:invalid_input';
  end if;
  perform 1 from papers where id = p_paper for update;
  if not found then
    raise exception 'admin:not_found';
  end if;
  perform admin_ensure_review(p_paper);
  select * into r from paper_reviews where paper_id = p_paper for update;
  perform review_log_material_change(p_paper);
  v_rev := review_revision(p_paper);
  v_from := r.status;

  -- Withdrawal must always be possible, even from a stale screen.
  if p_decision <> 'withdrawn' and p_expected_revision is distinct from v_rev then
    return jsonb_build_object('ok', false, 'error', 'stale_revision', 'revision', v_rev);
  end if;
  if p_decision in ('needs_changes', 'declined', 'withdrawn') and v_reason is null then
    return jsonb_build_object('ok', false, 'error', 'reason_required');
  end if;
  if p_decision = 'reopen' and r.status = 'pending' then
    return jsonb_build_object('ok', false, 'error', 'already_pending');
  end if;

  if p_decision = 'approved' then
    v_pre := review_approval_preconditions(p_paper, p_dissemination);
    if not (v_pre->>'ok')::boolean then
      return jsonb_build_object('ok', false, 'error', 'preconditions_failed', 'failures', v_pre->'failures');
    end if;
    v_evi := review_permission_evidence(p_paper);
    v_meta := review_metadata_check(p_paper);
    if p_dissemination is not null then
      select * into d from document_versions where id = p_dissemination;
    end if;
    select jsonb_build_object(
      'metadata', (select to_jsonb(x) from (select title, title_ar, abstract, abstract_ar, supervisor_name, year, university, faculty, degree_type, document_type
                                            from papers where id = p_paper) x),
      'authors', (select coalesce(jsonb_agg(jsonb_build_object('name', rr.full_name, 'order', pr.author_order)
                                            order by pr.author_order nulls last, rr.full_name), '[]'::jsonb)
                  from paper_researchers pr join researchers rr on rr.id = pr.researcher_id where pr.paper_id = p_paper),
      'file', (select coalesce(file_sha256, file_path) from papers where id = p_paper),
      'institution', review_institution_state(p_paper),
      'evidence', v_evi, 'metadata_check', v_meta,
      'reviewer_reason', v_reason,
      'dissemination', case when d.id is not null then jsonb_build_object('id', d.id, 'origin', d.origin, 'sha256', d.sha256, 'derived_from', d.derived_from) end)
    into v_snapshot;
    insert into review_approvals (
      paper_id, approved_by, content_fingerprint, revision, institution_id, academic_unit_id,
      publication_setting, setting_basis, acceptance_id, authority_verified,
      dissemination_version_id, dissemination_sha256, snapshot)
    values (
      p_paper, p_actor, review_content_fingerprint(p_paper), v_rev, r.institution_id, r.academic_unit_id,
      v_evi->>'setting', case v_evi->>'basis' when 'acceptance' then 'acceptance' else 'legacy_determination' end,
      (select submission_acceptance_id from papers where id = p_paper), r.authority_verified_at is not null,
      d.id, d.sha256, v_snapshot)
    returning id into v_approval;
    if d.id is not null then
      update document_versions set state = 'superseded'
      where paper_id = p_paper and kind = 'dissemination' and state = 'approved' and id <> d.id;
      update document_versions set state = 'approved', approved_by = p_actor, approved_at = now() where id = d.id;
    end if;
  end if;

  update paper_reviews set
    status = case p_decision when 'reopen' then 'pending' else p_decision end,
    status_reason = v_reason, status_changed_at = now(), status_changed_by = p_actor,
    withdrawn_at = case p_decision when 'withdrawn' then now() when 'reopen' then null else withdrawn_at end,
    withdrawn_reason = case p_decision when 'withdrawn' then v_reason when 'reopen' then null else withdrawn_reason end
  where paper_id = p_paper;

  perform admin_log(p_paper, p_actor, 'administrator', 'decision:' || p_decision,
    jsonb_build_object('decision', p_decision, 'reason', v_reason, 'from_status', v_from,
                       'revision', v_rev, 'content_fingerprint', review_content_fingerprint(p_paper),
                       'approval_id', v_approval, 'dissemination_version_id', p_dissemination,
                       'submitter_notified', false));
  return jsonb_build_object('ok', true, 'status', case p_decision when 'reopen' then 'pending' else p_decision end,
                            'approval_id', v_approval, 'revision', review_revision(p_paper));
end;
$fn$;

-- ------------------------------------------------------------
-- Notes, recommendations, issues. Administrators, and volunteers on an
-- assigned submission (after the confidentiality acknowledgement).
-- ------------------------------------------------------------
create or replace function admin_add_note(p_actor uuid, p_paper uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_role text := admin_require_access(p_actor, p_paper);
  v_id uuid;
begin
  if nullif(btrim(coalesce(p_body, '')), '') is null or length(p_body) > 5000 then
    raise exception 'admin:invalid_input';
  end if;
  perform admin_ensure_review(p_paper);
  insert into review_notes (paper_id, author_id, author_role, body) values (p_paper, p_actor, v_role, btrim(p_body))
  returning id into v_id;
  -- The note text stays in review_notes; the log only says one was added.
  perform admin_log(p_paper, p_actor, v_role, 'note_added', jsonb_build_object('note_id', v_id));
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$fn$;

create or replace function admin_recommend(p_actor uuid, p_paper uuid, p_recommendation text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_role text := admin_require_access(p_actor, p_paper);
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if p_recommendation not in ('approve', 'needs_changes', 'decline', 'hold') or v_reason is null or length(v_reason) > 2000 then
    raise exception 'admin:invalid_input';
  end if;
  perform admin_ensure_review(p_paper);
  -- A recommendation never changes the review status.
  perform admin_log(p_paper, p_actor, v_role, 'recommendation',
                    jsonb_build_object('recommendation', p_recommendation, 'reason', v_reason,
                                       'revision', review_revision(p_paper)));
  return jsonb_build_object('ok', true);
end;
$fn$;

create or replace function admin_raise_issue(p_actor uuid, p_paper uuid, p_kind text, p_description text, p_blocking boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_role text := admin_require_access(p_actor, p_paper);
  v_id uuid;
  v_suspends uuid;
begin
  if p_kind not in ('metadata', 'rights', 'duplicate', 'document', 'privacy', 'other')
     or nullif(btrim(coalesce(p_description, '')), '') is null or length(p_description) > 2000 then
    raise exception 'admin:invalid_input';
  end if;
  -- The same row lock admin_decide takes, so an issue raised during an
  -- approval is either seen by it (approval refused) or sees the approval
  -- it then suspends. Neither can overlook the other.
  perform 1 from papers where id = p_paper for update;
  perform admin_ensure_review(p_paper);
  if coalesce(p_blocking, true) then
    select a.id into v_suspends
    from paper_reviews r join review_approvals a on a.paper_id = r.paper_id
    where r.paper_id = p_paper and r.status = 'approved'
    order by a.approved_at desc, a.id desc limit 1;
  end if;
  insert into review_issues (paper_id, kind, description, blocking, raised_by, suspends_approval_id)
  values (p_paper, p_kind, btrim(p_description), coalesce(p_blocking, true), p_actor, v_suspends)
  returning id into v_id;
  perform admin_log(p_paper, p_actor, v_role, 'issue_raised', jsonb_build_object('issue_id', v_id, 'kind', p_kind,
    'blocking', coalesce(p_blocking, true), 'suspends_approval_id', v_suspends));
  return jsonb_build_object('ok', true, 'id', v_id, 'suspends_approval_id', v_suspends);
end;
$fn$;

create or replace function admin_resolve_issue(p_actor uuid, p_paper uuid, p_issue uuid, p_resolution text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
begin
  perform admin_require_role(p_actor, array['administrator']);
  if nullif(btrim(coalesce(p_resolution, '')), '') is null or length(p_resolution) > 2000 then
    raise exception 'admin:invalid_input';
  end if;
  perform 1 from papers where id = p_paper for update;
  update review_issues set state = 'resolved', resolved_by = p_actor, resolved_at = now(), resolution = btrim(p_resolution)
  where id = p_issue and paper_id = p_paper and state = 'open';
  if not found then
    raise exception 'admin:not_found';
  end if;
  perform admin_log(p_paper, p_actor, 'administrator', 'issue_resolved', jsonb_build_object('issue_id', p_issue));
  return jsonb_build_object('ok', true);
end;
$fn$;

-- ------------------------------------------------------------
-- Review-owned facts: institution mapping, legacy permission, authority,
-- embargo. Administrators only.
-- ------------------------------------------------------------
create or replace function admin_set_paper_institution(p_actor uuid, p_paper uuid, p_institution uuid, p_unit uuid, p_none boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
begin
  perform admin_require_role(p_actor, array['administrator']);
  if not exists (select 1 from papers where id = p_paper) then
    raise exception 'admin:not_found';
  end if;
  perform admin_ensure_review(p_paper);
  if coalesce(p_none, false) then
    update paper_reviews set institution_id = null, academic_unit_id = null, institution_basis = 'reviewer_none',
      institution_set_at = now(), institution_set_by = p_actor where paper_id = p_paper;
  else
    if not exists (select 1 from institutions where id = p_institution) then
      raise exception 'admin:invalid_input';
    end if;
    if p_unit is not null and not exists (select 1 from academic_units where id = p_unit and institution_id = p_institution and active) then
      raise exception 'admin:invalid_input';
    end if;
    update paper_reviews set institution_id = p_institution, academic_unit_id = p_unit, institution_basis = 'reviewer',
      institution_set_at = now(), institution_set_by = p_actor where paper_id = p_paper;
  end if;
  perform admin_log(p_paper, p_actor, 'administrator', 'institution_mapped',
                    jsonb_build_object('institution_id', p_institution, 'unit_id', p_unit, 'none', coalesce(p_none, false)));
  return jsonb_build_object('ok', true, 'revision', review_revision(p_paper));
end;
$fn$;

-- What an old (pre-acceptance) consent supports. Capped by what the old
-- checkboxes actually covered; never expands them.
create or replace function admin_set_legacy_setting(p_actor uuid, p_paper uuid, p_setting text, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  p papers%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  perform admin_require_role(p_actor, array['administrator']);
  select * into p from papers where id = p_paper;
  if not found then
    raise exception 'admin:not_found';
  end if;
  if p.submission_acceptance_id is not null then
    return jsonb_build_object('ok', false, 'error', 'not_a_legacy_record');
  end if;
  if p_setting not in ('record_abstract', 'record_abstract_fulltext', 'hold') or v_note is null or length(v_note) > 2000 then
    raise exception 'admin:invalid_input';
  end if;
  if p_setting = 'record_abstract_fulltext' and not ('full_paper' = any(p.publication_scope)) then
    return jsonb_build_object('ok', false, 'error', 'legacy_grant_does_not_cover_full_text');
  end if;
  if p_setting = 'record_abstract' and cardinality(p.publication_scope) = 0 then
    return jsonb_build_object('ok', false, 'error', 'legacy_grant_empty');
  end if;
  perform admin_ensure_review(p_paper);
  update paper_reviews set legacy_setting = p_setting, legacy_note = v_note, legacy_set_at = now(), legacy_set_by = p_actor where paper_id = p_paper;
  perform admin_log(p_paper, p_actor, 'administrator', 'legacy_permission_determined',
                    jsonb_build_object('setting', p_setting, 'legacy_scope', to_jsonb(p.publication_scope)));
  return jsonb_build_object('ok', true, 'revision', review_revision(p_paper));
end;
$fn$;

create or replace function admin_record_authority(p_actor uuid, p_paper uuid, p_verified boolean, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  perform admin_require_role(p_actor, array['administrator']);
  if not exists (select 1 from papers where id = p_paper) then
    raise exception 'admin:not_found';
  end if;
  if coalesce(p_verified, false) and (v_note is null or length(v_note) > 2000) then
    raise exception 'admin:invalid_input';
  end if;
  perform admin_ensure_review(p_paper);
  update paper_reviews set
    authority_verified_at = case when coalesce(p_verified, false) then now() end,
    authority_verified_by = case when coalesce(p_verified, false) then p_actor end,
    authority_note = v_note
  where paper_id = p_paper;
  perform admin_log(p_paper, p_actor, 'administrator', case when coalesce(p_verified, false) then 'authority_verified' else 'authority_verification_cleared' end,
                    jsonb_build_object('note_recorded', v_note is not null));
  return jsonb_build_object('ok', true, 'revision', review_revision(p_paper));
end;
$fn$;

create or replace function admin_set_embargo(p_actor uuid, p_paper uuid, p_until date, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
begin
  perform admin_require_role(p_actor, array['administrator']);
  if not exists (select 1 from papers where id = p_paper) then
    raise exception 'admin:not_found';
  end if;
  if p_until is not null and nullif(btrim(coalesce(p_note, '')), '') is null then
    raise exception 'admin:invalid_input';
  end if;
  perform admin_ensure_review(p_paper);
  update paper_reviews set embargo_until = p_until, embargo_note = nullif(btrim(coalesce(p_note, '')), '') where paper_id = p_paper;
  perform admin_log(p_paper, p_actor, 'administrator', 'embargo_set', jsonb_build_object('until', p_until));
  return jsonb_build_object('ok', true, 'revision', review_revision(p_paper));
end;
$fn$;

-- ------------------------------------------------------------
-- Institutions and units. Administrators write; both roles read.
-- ------------------------------------------------------------
create or replace function admin_list_institutions(p_actor uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
begin
  perform admin_require_role(p_actor, array['administrator', 'volunteer']);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', i.id, 'slug', i.slug, 'name_en', i.name_en, 'name_ar', i.name_ar, 'kind', i.kind,
      'public_collection_eligible', i.public_collection_eligible, 'eligibility_note', i.eligibility_note,
      'source_kind', i.source_kind, 'source_url', i.source_url, 'source_retrieved_on', i.source_retrieved_on,
      'aliases', coalesce((select jsonb_agg(jsonb_build_object('alias', a.alias, 'language', a.language, 'source_kind', a.source_kind)
                                            order by a.alias) from institution_aliases a where a.institution_id = i.id), '[]'::jsonb),
      'units', coalesce((select jsonb_agg(jsonb_build_object(
                 'id', u.id, 'kind', u.kind, 'name_en', u.name_en, 'name_ar', u.name_ar, 'verification', u.verification,
                 'source_url', u.source_url, 'source_retrieved_on', u.source_retrieved_on, 'active', u.active)
               order by u.name_en, u.name_ar) from academic_units u where u.institution_id = i.id), '[]'::jsonb))
      order by i.public_collection_eligible desc, i.name_en)
    from institutions i), '[]'::jsonb);
end;
$fn$;

create or replace function admin_create_institution(p_actor uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_id uuid;
  v_ar text := nullif(btrim(coalesce(p->>'name_ar', '')), '');
begin
  perform admin_require_role(p_actor, array['administrator']);
  if coalesce(p->>'slug', '') !~ '^[a-z0-9-]{2,60}$' or nullif(btrim(coalesce(p->>'name_en', '')), '') is null
     or coalesce(p->>'kind', 'university') not in ('university', 'research_center', 'agency', 'other') then
    raise exception 'admin:invalid_input';
  end if;
  perform set_config('app.actor', p_actor::text, true);
  -- A new institution is never eligible: eligibility is a separate, audited decision.
  insert into institutions (slug, name_en, name_ar, kind, country, source_kind, source_url, source_retrieved_on, source_note, created_by)
  values (p->>'slug', btrim(p->>'name_en'), v_ar, coalesce(p->>'kind', 'university'), coalesce(nullif(p->>'country', ''), 'SD'),
          'reviewer_entered', nullif(p->>'source_url', ''), nullif(p->>'source_retrieved_on', '')::date, nullif(p->>'source_note', ''), p_actor)
  returning id into v_id;
  insert into institution_aliases (institution_id, alias, alias_normalized, language, source_kind)
  values (v_id, btrim(p->>'name_en'), normalize_name_text(p->>'name_en'), 'en', 'reviewer_entered');
  if v_ar is not null then
    insert into institution_aliases (institution_id, alias, alias_normalized, language, source_kind)
    values (v_id, v_ar, normalize_name_text(v_ar), 'ar', 'reviewer_entered')
    on conflict (institution_id, alias_normalized) do nothing;
  end if;
  perform admin_log(null, p_actor, 'administrator', 'institution_created', jsonb_build_object('institution_id', v_id, 'slug', p->>'slug'));
  return jsonb_build_object('ok', true, 'id', v_id);
exception when unique_violation then
  raise exception 'admin:conflict';
end;
$fn$;

create or replace function admin_set_institution_eligibility(p_actor uuid, p_institution uuid, p_eligible boolean, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  perform admin_require_role(p_actor, array['administrator']);
  if p_eligible is null or v_note is null or length(v_note) > 2000 then
    raise exception 'admin:invalid_input';
  end if;
  perform set_config('app.actor', p_actor::text, true);
  update institutions set public_collection_eligible = p_eligible, eligibility_note = v_note,
    eligibility_changed_at = now(), eligibility_changed_by = p_actor
  where id = p_institution;
  if not found then
    raise exception 'admin:not_found';
  end if;
  -- Changing eligibility never publishes or approves any record.
  return jsonb_build_object('ok', true);
end;
$fn$;

create or replace function admin_add_institution_alias(p_actor uuid, p_institution uuid, p_alias text, p_language text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
begin
  perform admin_require_role(p_actor, array['administrator']);
  if normalize_name_text(p_alias) is null or length(p_alias) > 300 or coalesce(p_language, 'other') not in ('en', 'ar', 'other') then
    raise exception 'admin:invalid_input';
  end if;
  if not exists (select 1 from institutions where id = p_institution) then
    raise exception 'admin:not_found';
  end if;
  insert into institution_aliases (institution_id, alias, alias_normalized, language, source_kind)
  values (p_institution, btrim(p_alias), normalize_name_text(p_alias), coalesce(p_language, 'other'), 'reviewer_entered')
  on conflict (institution_id, alias_normalized) do nothing;
  perform admin_log(null, p_actor, 'administrator', 'institution_alias_added', jsonb_build_object('institution_id', p_institution));
  return jsonb_build_object('ok', true);
end;
$fn$;

-- Units are entered by a person from the official page. They start
-- unverified; verification records the page and the date it was read.
create or replace function admin_add_unit(p_actor uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_id uuid;
begin
  perform admin_require_role(p_actor, array['administrator']);
  if not exists (select 1 from institutions where id = (p->>'institution_id')::uuid)
     or coalesce(p->>'kind', 'faculty') not in ('faculty', 'school', 'institute', 'college', 'department', 'center', 'other')
     or (nullif(btrim(coalesce(p->>'name_en', '')), '') is null and nullif(btrim(coalesce(p->>'name_ar', '')), '') is null) then
    raise exception 'admin:invalid_input';
  end if;
  insert into academic_units (institution_id, parent_unit_id, kind, name_en, name_ar, source_kind, source_url, source_retrieved_on, source_note, created_by)
  values ((p->>'institution_id')::uuid, nullif(p->>'parent_unit_id', '')::uuid, coalesce(p->>'kind', 'faculty'),
          nullif(btrim(coalesce(p->>'name_en', '')), ''), nullif(btrim(coalesce(p->>'name_ar', '')), ''),
          'reviewer_entered', nullif(p->>'source_url', ''), nullif(p->>'source_retrieved_on', '')::date, nullif(p->>'source_note', ''), p_actor)
  returning id into v_id;
  perform admin_log(null, p_actor, 'administrator', 'unit_added', jsonb_build_object('unit_id', v_id, 'institution_id', p->>'institution_id'));
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$fn$;

create or replace function admin_verify_unit(p_actor uuid, p_unit uuid, p_source_url text, p_retrieved_on date, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
begin
  perform admin_require_role(p_actor, array['administrator']);
  if coalesce(p_source_url, '') !~ '^https://[^\s]+$' or p_retrieved_on is null or p_retrieved_on > current_date then
    raise exception 'admin:invalid_input';
  end if;
  update academic_units set verification = 'verified', source_kind = 'official_directory', source_url = p_source_url,
    source_retrieved_on = p_retrieved_on, source_note = nullif(btrim(coalesce(p_note, '')), ''),
    verified_by = p_actor, verified_at = now()
  where id = p_unit;
  if not found then
    raise exception 'admin:not_found';
  end if;
  perform admin_log(null, p_actor, 'administrator', 'unit_verified', jsonb_build_object('unit_id', p_unit, 'source_url', p_source_url, 'retrieved_on', p_retrieved_on));
  return jsonb_build_object('ok', true);
end;
$fn$;

create or replace function admin_add_unit_alias(p_actor uuid, p_unit uuid, p_alias text, p_language text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
begin
  perform admin_require_role(p_actor, array['administrator']);
  if normalize_name_text(p_alias) is null or length(p_alias) > 300 or coalesce(p_language, 'other') not in ('en', 'ar', 'other') then
    raise exception 'admin:invalid_input';
  end if;
  if not exists (select 1 from academic_units where id = p_unit) then
    raise exception 'admin:not_found';
  end if;
  insert into academic_unit_aliases (unit_id, alias, alias_normalized, language)
  values (p_unit, btrim(p_alias), normalize_name_text(p_alias), coalesce(p_language, 'other'))
  on conflict (unit_id, alias_normalized) do nothing;
  perform admin_log(null, p_actor, 'administrator', 'unit_alias_added', jsonb_build_object('unit_id', p_unit));
  return jsonb_build_object('ok', true);
end;
$fn$;

-- ------------------------------------------------------------
-- Document versions. Originals stay where they were uploaded; a
-- dissemination copy is its own private object at a server-chosen path,
-- with its provenance and hash. Administrators, and volunteers on an
-- assigned submission, may prepare one; only an approval makes it approved.
-- ------------------------------------------------------------
create or replace function admin_register_original(p_actor uuid, p_paper uuid, p_sha256 text, p_size bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  p papers%rowtype;
  v_ext text;
  v_id uuid;
begin
  perform admin_require_access(p_actor, p_paper);
  select * into p from papers where id = p_paper;
  v_ext := lower((regexp_match(p.file_path, '\.(pdf|docx)$', 'i'))[1]);
  if v_ext is null or coalesce(p_sha256, '') !~ '^[0-9a-f]{64}$' or coalesce(p_size, 0) <= 0 then
    raise exception 'admin:invalid_input';
  end if;
  if p.file_sha256 is not null and p.file_sha256 <> p_sha256 then
    return jsonb_build_object('ok', false, 'error', 'hash_mismatch');
  end if;
  select id into v_id from document_versions where storage_path = p.file_path;
  if v_id is null then
    insert into document_versions (paper_id, kind, origin, storage_path, file_extension, size_bytes, sha256, state, created_by, provenance_note)
    values (p_paper, 'original', 'submitted_file', p.file_path, v_ext, p_size, p_sha256, 'recorded', p_actor, 'the file as submitted')
    returning id into v_id;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$fn$;

create or replace function admin_prepare_document(
  p_actor uuid, p_paper uuid, p_origin text, p_extension text, p_declared_size bigint, p_note text, p_redaction_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  o document_versions%rowtype;
  v_id uuid := gen_random_uuid();
  v_path text;
  v_red text := nullif(btrim(coalesce(p_redaction_note, '')), '');
begin
  perform admin_require_access(p_actor, p_paper);
  if p_origin not in ('original_reviewed', 'redacted_copy') or p_extension not in ('pdf', 'docx') then
    raise exception 'admin:invalid_input';
  end if;
  select * into o from document_versions where paper_id = p_paper and kind = 'original' order by created_at limit 1;
  if not found then
    raise exception 'admin:original_not_registered';
  end if;
  if p_origin = 'original_reviewed' and p_extension <> o.file_extension then
    raise exception 'admin:invalid_input';
  end if;
  if p_origin = 'redacted_copy' and (v_red is null or coalesce(p_declared_size, 0) <= 0 or p_declared_size > 20971520) then
    raise exception 'admin:invalid_input';
  end if;
  v_path := 'dissemination/' || p_paper::text || '/' || v_id::text || '.' || p_extension;
  insert into document_versions (id, paper_id, kind, origin, storage_path, file_extension, declared_size, derived_from,
                                 provenance_note, redaction_note, state, created_by)
  values (v_id, p_paper, 'dissemination', p_origin, v_path, p_extension,
          case p_origin when 'original_reviewed' then o.size_bytes else p_declared_size end, o.id,
          coalesce(nullif(btrim(coalesce(p_note, '')), ''), case p_origin when 'original_reviewed' then 'the original, reviewed and designated without change' end),
          v_red, 'pending_upload', p_actor);
  perform admin_log(p_paper, p_actor, admin_actor_role(p_actor), 'document_version_created',
                    jsonb_build_object('version_id', v_id, 'origin', p_origin, 'derived_from', o.id));
  return jsonb_build_object('ok', true, 'id', v_id, 'storage_path', v_path,
                            'original_storage_path', o.storage_path, 'original_sha256', o.sha256, 'declared_size', case p_origin when 'original_reviewed' then o.size_bytes else p_declared_size end);
end;
$fn$;

create or replace function admin_finalize_document(p_actor uuid, p_version uuid, p_sha256 text, p_size bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  d document_versions%rowtype;
  o document_versions%rowtype;
begin
  select * into d from document_versions where id = p_version for update;
  if not found then
    raise exception 'admin:forbidden';
  end if;
  perform admin_require_access(p_actor, d.paper_id);
  if d.kind <> 'dissemination' then
    raise exception 'admin:invalid_input';
  end if;
  if d.state <> 'pending_upload' then
    -- Retried finalization: the same result, changing nothing.
    if d.sha256 = p_sha256 and d.state <> 'withdrawn' then
      return jsonb_build_object('ok', true, 'id', d.id, 'already', true);
    end if;
    return jsonb_build_object('ok', false, 'error', 'not_pending');
  end if;
  if coalesce(p_sha256, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'admin:invalid_input';
  end if;
  if d.declared_size is distinct from p_size then
    return jsonb_build_object('ok', false, 'error', 'size_mismatch');
  end if;
  if d.origin = 'original_reviewed' then
    select * into o from document_versions where id = d.derived_from;
    if o.sha256 is distinct from p_sha256 then
      return jsonb_build_object('ok', false, 'error', 'hash_mismatch');
    end if;
  end if;
  update document_versions set state = 'proposed', sha256 = p_sha256, size_bytes = p_size, uploaded_at = now() where id = d.id;
  perform admin_log(d.paper_id, p_actor, admin_actor_role(p_actor), 'document_version_proposed',
                    jsonb_build_object('version_id', d.id, 'origin', d.origin, 'sha256', p_sha256, 'size', p_size));
  return jsonb_build_object('ok', true, 'id', d.id);
end;
$fn$;

create or replace function admin_withdraw_document(p_actor uuid, p_version uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  d document_versions%rowtype;
begin
  perform admin_require_role(p_actor, array['administrator']);
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'admin:invalid_input';
  end if;
  update document_versions set state = 'withdrawn' where id = p_version and kind = 'dissemination' returning * into d;
  if not found then
    raise exception 'admin:not_found';
  end if;
  perform admin_log(d.paper_id, p_actor, 'administrator', 'document_version_withdrawn', jsonb_build_object('version_id', d.id, 'reason', btrim(p_reason)));
  return jsonb_build_object('ok', true);
end;
$fn$;

-- What the server needs to prepare or finish a document version, without
-- showing anyone a file (so it is not a logged file access). Same access
-- rules as everything else; an unknown version looks like a forbidden one.
create or replace function admin_original_info(p_actor uuid, p_paper uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
begin
  perform admin_require_access(p_actor, p_paper);
  return (select jsonb_build_object(
    'storage_path', p.file_path, 'sha256', p.file_sha256, 'size', p.file_size,
    'registered_id', (select d.id from document_versions d where d.paper_id = p_paper and d.kind = 'original' limit 1))
    from papers p where p.id = p_paper);
end;
$fn$;

create or replace function admin_document_upload_info(p_actor uuid, p_version uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  d document_versions%rowtype;
begin
  select * into d from document_versions where id = p_version;
  if not found then
    raise exception 'admin:forbidden';
  end if;
  perform admin_require_access(p_actor, d.paper_id);
  return jsonb_build_object('paper_id', d.paper_id, 'storage_path', d.storage_path, 'file_extension', d.file_extension,
                            'declared_size', d.declared_size, 'state', d.state, 'origin', d.origin, 'kind', d.kind);
end;
$fn$;

-- The only way to learn a private file's path. The path comes from the
-- database, never from the caller, and every request is logged.
create or replace function admin_document_access(p_actor uuid, p_paper uuid, p_version uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_role text := admin_require_access(p_actor, p_paper);
  p papers%rowtype;
  d document_versions%rowtype;
begin
  select * into p from papers where id = p_paper;
  if p_version is null then
    perform admin_log(p_paper, p_actor, v_role, 'file_accessed', jsonb_build_object('kind', 'original', 'sha256', p.file_sha256));
    return jsonb_build_object('ok', true, 'storage_path', p.file_path);
  end if;
  select * into d from document_versions where id = p_version and paper_id = p_paper and state in ('recorded', 'proposed', 'approved', 'superseded');
  if not found then
    raise exception 'admin:not_found';
  end if;
  perform admin_log(p_paper, p_actor, v_role, 'file_accessed',
                    jsonb_build_object('kind', d.kind, 'version_id', d.id, 'origin', d.origin, 'sha256', d.sha256));
  return jsonb_build_object('ok', true, 'storage_path', d.storage_path);
end;
$fn$;

-- ------------------------------------------------------------
-- The queue and the detail view.
-- ------------------------------------------------------------
create or replace function admin_queue(p_actor uuid, p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_role text := admin_actor_role(p_actor);
  v_status text := coalesce(nullif(p_filters->>'status', ''), 'any');
  v_inst text := coalesce(nullif(p_filters->>'institution', ''), 'any');
  v_conf text := coalesce(nullif(p_filters->>'confirmed', ''), 'any');
  v_mine boolean := coalesce((p_filters->>'mine')::boolean, false);
  v_q text := nullif(btrim(coalesce(p_filters->>'q', '')), '');
  v_limit int := least(greatest(coalesce((p_filters->>'limit')::int, 50), 1), 100);
  v_offset int := greatest(coalesce((p_filters->>'offset')::int, 0), 0);
  v_total int;
  v_items jsonb;
  v_ids uuid[];
  v_id uuid;
begin
  if v_role is null then
    raise exception 'admin:forbidden';
  end if;
  if v_status not in ('any', 'pending', 'needs_changes', 'reviewed', 'approved', 'declined', 'withdrawn')
     or v_conf not in ('any', 'yes', 'no') then
    raise exception 'admin:invalid_input';
  end if;
  if v_role = 'volunteer' then
    if not admin_has_acknowledged(p_actor) then
      raise exception 'admin:confidentiality_required';
    end if;
    v_mine := true;
  else
    insert into paper_reviews (paper_id) select p.id from papers p where not exists (select 1 from paper_reviews r where r.paper_id = p.id);
    for v_id in select paper_id from paper_reviews where institution_basis is null loop
      perform admin_ensure_review(v_id);
    end loop;
    for v_id in select paper_id from paper_reviews where status = 'approved' loop
      perform review_log_material_change(v_id);
    end loop;
  end if;

  select coalesce(array_agg(p.id order by p.created_at desc, p.id), '{}'::uuid[]) into v_ids
  from papers p join paper_reviews r on r.paper_id = p.id
  where (v_status = 'any' or r.status = v_status)
    and (v_conf = 'any' or (v_conf = 'yes') = (p.metadata_confirmed_at is not null))
    and (v_inst = 'any'
         or (v_inst = 'unresolved' and r.institution_id is null)
         or r.institution_id::text = v_inst)
    and (not v_mine or exists (select 1 from review_assignments a where a.paper_id = p.id and a.volunteer_id = p_actor and a.ended_at is null))
    and (v_q is null or coalesce(p.title, '') ilike '%' || v_q || '%' or coalesce(p.title_ar, '') ilike '%' || v_q || '%');
  v_total := cardinality(v_ids);

  select coalesce(jsonb_agg(jsonb_build_object(
    'paper_id', p.id, 'submitted_at', p.created_at, 'title', p.title, 'title_ar', p.title_ar, 'year', p.year,
    'university', p.university, 'document_type', p.document_type,
    'states', jsonb_build_object(
      'submitted', true, 'confirmed', p.metadata_confirmed_at is not null, 'reviewed', r.status <> 'pending',
      'publication_approved', coalesce((publication_eligibility(p.id)->>'review_approved')::boolean, false)),
    'status', r.status,
    'institution', jsonb_build_object('id', r.institution_id, 'name_en', i.name_en, 'name_ar', i.name_ar,
                                      'eligible', coalesce(i.public_collection_eligible, false), 'basis', r.institution_basis),
    'evidence_basis', review_permission_evidence(p.id)->>'basis',
    'setting', review_permission_evidence(p.id)->>'setting',
    'claimed_role', review_permission_evidence(p.id)->>'claimed_role',
    'missing_count', jsonb_array_length(review_metadata_check(p.id)->'missing'),
    'exact_duplicates', (select count(*) from papers o where o.id <> p.id and p.file_sha256 is not null and o.file_sha256 = p.file_sha256),
    'assigned', (select count(*) from review_assignments a where a.paper_id = p.id and a.ended_at is null),
    'withdrawn', r.withdrawn_at is not null, 'embargo_until', r.embargo_until
  ) order by pg.ord), '[]'::jsonb)
  into v_items
  from unnest(v_ids[v_offset + 1 : v_offset + v_limit]) with ordinality as pg(paper_id, ord)
  join papers p on p.id = pg.paper_id
  join paper_reviews r on r.paper_id = p.id
  left join institutions i on i.id = r.institution_id;

  return jsonb_build_object('total', v_total, 'limit', v_limit, 'offset', v_offset, 'items', v_items, 'role', v_role);
end;
$fn$;

create or replace function admin_review_detail(p_actor uuid, p_paper uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_role text := admin_require_access(p_actor, p_paper);
  p papers%rowtype;
  r paper_reviews%rowtype;
  a submission_acceptances%rowtype;
  s researchers%rowtype;
  v_dups jsonb := '[]'::jsonb;
  v_hidden int := 0;
  e jsonb;
begin
  perform admin_ensure_review(p_paper);
  perform review_log_material_change(p_paper);
  select * into p from papers where id = p_paper;
  select * into r from paper_reviews where paper_id = p_paper;
  if p.submission_acceptance_id is not null then
    select * into a from submission_acceptances where id = p.submission_acceptance_id;
  end if;
  select * into s from researchers where id = p.submitted_by;

  -- Possible duplicates name other submissions. A volunteer is shown only
  -- those on submissions also assigned to them; the rest are counted.
  for e in select value from jsonb_array_elements(review_duplicates(p_paper)) loop
    if v_role = 'administrator'
       or exists (select 1 from review_assignments x where x.paper_id = (e->>'paper_id')::uuid and x.volunteer_id = p_actor and x.ended_at is null) then
      v_dups := v_dups || e;
    else
      v_hidden := v_hidden + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'revision', review_revision(p_paper),
    'viewer_role', v_role,
    'paper', jsonb_build_object(
      'id', p.id, 'submitted_at', p.created_at, 'title', p.title, 'title_ar', p.title_ar,
      'abstract', p.abstract, 'abstract_ar', p.abstract_ar, 'supervisor_name', p.supervisor_name,
      'year', p.year, 'university', p.university, 'faculty', p.faculty, 'degree_type', p.degree_type,
      'document_type', p.document_type, 'extraction_status', p.extraction_status,
      'manual_entry_source', p.manual_entry_source, 'publication_setting', p.publication_setting,
      'legacy_publication_scope', case when p.submission_acceptance_id is null then to_jsonb(p.publication_scope) end,
      'file_sha256', p.file_sha256, 'file_size', p.file_size),
    'authors', coalesce((select jsonb_agg(jsonb_build_object('name', rr.full_name, 'order', pr.author_order, 'is_submitter', rr.id = p.submitted_by)
                                          order by pr.author_order nulls last, rr.full_name)
                         from paper_researchers pr join researchers rr on rr.id = pr.researcher_id where pr.paper_id = p_paper), '[]'::jsonb),
    'states', jsonb_build_object(
      'submitted', true, 'confirmed', p.metadata_confirmed_at is not null, 'confirmed_at', p.metadata_confirmed_at,
      'reviewed', r.status <> 'pending',
      'approval_recorded', r.status = 'approved' and exists (select 1 from review_approvals x where x.paper_id = p_paper),
      'publication_approved', coalesce((publication_eligibility(p_paper)->>'review_approved')::boolean, false)),
    -- Every approval ever recorded (append-only evidence), newest first, and
    -- whether a blocking issue has since suspended it. Whether the latest
    -- one is still in force is 'eligibility', not this list.
    'approvals', coalesce((select jsonb_agg(jsonb_build_object(
      'id', x.id, 'approved_at', x.approved_at, 'publication_setting', x.publication_setting,
      'dissemination_version_id', x.dissemination_version_id,
      'suspended_by_issue', exists (select 1 from review_issues i where i.suspends_approval_id = x.id and i.blocking))
      order by x.approved_at desc, x.id desc) from review_approvals x where x.paper_id = p_paper), '[]'::jsonb),
    'review', jsonb_build_object(
      'status', r.status, 'status_reason', r.status_reason, 'status_changed_at', r.status_changed_at,
      'withdrawn_at', r.withdrawn_at, 'withdrawn_reason', r.withdrawn_reason,
      'embargo_until', r.embargo_until, 'embargo_note', r.embargo_note,
      'legacy_setting', r.legacy_setting, 'legacy_note', r.legacy_note,
      'authority_verified_at', r.authority_verified_at, 'authority_note', r.authority_note),
    'submitter', jsonb_build_object(
      'claimed_role', a.claimed_role, 'identity_verified_by_acceptance', coalesce(a.identity_verified, false),
      'name', case when v_role = 'administrator' then s.full_name end,
      'email', case when v_role = 'administrator' then s.email end,
      'whatsapp_number', case when v_role = 'administrator' then s.whatsapp_number end),
    'acceptance', case when a.id is not null then jsonb_build_object(
      'id', a.id, 'accepted_at', a.accepted_at, 'agreement_version_id', a.agreement_version_id,
      'agreement_language', a.agreement_language, 'agreement_sha256', a.agreement_sha256,
      'publication_setting', a.publication_setting, 'processing_decision', a.processing_decision,
      'processing_offer_decision', a.processing_offer_decision, 'declared_authors', a.declared_authors)
      else jsonb_build_object('legacy', true, 'permission_to_process', p.permission_to_process,
                              'publication_scope', to_jsonb(p.publication_scope)) end,
    'evidence', review_permission_evidence(p_paper),
    'metadata_check', review_metadata_check(p_paper),
    'institution', review_institution_state(p_paper),
    'preconditions', review_approval_preconditions(p_paper, null),
    'eligibility', publication_eligibility(p_paper),
    'duplicates', jsonb_build_object('items', v_dups, 'hidden_count', v_hidden),
    'documents', jsonb_build_object(
      'original', jsonb_build_object('sha256', p.file_sha256, 'size', p.file_size,
        'registered_id', (select d.id from document_versions d where d.paper_id = p_paper and d.kind = 'original' limit 1)),
      'versions', coalesce((select jsonb_agg(jsonb_build_object(
        'id', d.id, 'origin', d.origin, 'state', d.state, 'sha256', d.sha256, 'size', d.size_bytes,
        'file_extension', d.file_extension, 'derived_from', d.derived_from, 'provenance_note', d.provenance_note,
        'redaction_note', d.redaction_note, 'created_at', d.created_at, 'approved_at', d.approved_at) order by d.created_at)
        from document_versions d where d.paper_id = p_paper and d.kind = 'dissemination'), '[]'::jsonb)),
    'issues', coalesce((select jsonb_agg(jsonb_build_object(
      'id', i.id, 'kind', i.kind, 'description', i.description, 'blocking', i.blocking, 'state', i.state,
      'raised_at', i.raised_at, 'resolution', i.resolution, 'suspends_approval_id', i.suspends_approval_id) order by i.raised_at) from review_issues i where i.paper_id = p_paper), '[]'::jsonb),
    'notes', coalesce((select jsonb_agg(jsonb_build_object(
      'id', n.id, 'author_role', n.author_role, 'author_id', n.author_id, 'body', n.body, 'created_at', n.created_at)
      order by n.created_at desc) from review_notes n where n.paper_id = p_paper), '[]'::jsonb),
    'assignments', case when v_role = 'administrator' then coalesce((
      select jsonb_agg(jsonb_build_object('volunteer_id', x.volunteer_id, 'email', u.email, 'assigned_at', x.assigned_at))
      from review_assignments x join auth.users u on u.id = x.volunteer_id
      where x.paper_id = p_paper and x.ended_at is null), '[]'::jsonb) end,
    'events', coalesce((select jsonb_agg(jsonb_build_object(
      'id', ev.id, 'at', ev.created_at, 'action', ev.action, 'actor_role', ev.actor_role, 'actor_id', ev.actor_id,
      'actor_email', case when v_role = 'administrator' then (select u.email from auth.users u where u.id = ev.actor_id) end,
      'detail', ev.detail) order by ev.id desc)
      from (select * from admin_audit_events where paper_id = p_paper order by id desc limit 200) ev), '[]'::jsonb));
end;
$fn$;

-- An administrator's preview of the shared publication rule.
create or replace function admin_eligibility_preview(p_actor uuid, p_paper uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $fn$
begin
  perform admin_require_role(p_actor, array['administrator']);
  return publication_eligibility(p_paper);
end;
$fn$;

-- ------------------------------------------------------------
-- Grants. By NAME, so a signature can never drift from a grant. Supabase
-- grants new functions to anon/authenticated/service_role by default: all
-- of that is removed first. Only the API functions below reach
-- service_role. bootstrap_first_administrator reaches nobody but the
-- database owner.
-- ------------------------------------------------------------
do $grants$
declare
  r record;
  v_api text[] := array[
    'admin_context', 'admin_acknowledge_confidentiality', 'admin_set_staff', 'admin_list_staff',
    'admin_assign', 'admin_unassign', 'admin_decide', 'admin_add_note', 'admin_recommend',
    'admin_raise_issue', 'admin_resolve_issue', 'admin_set_paper_institution', 'admin_set_legacy_setting',
    'admin_record_authority', 'admin_set_embargo', 'admin_list_institutions', 'admin_create_institution',
    'admin_set_institution_eligibility', 'admin_add_institution_alias', 'admin_add_unit', 'admin_verify_unit',
    'admin_add_unit_alias', 'admin_register_original', 'admin_prepare_document', 'admin_finalize_document',
    'admin_withdraw_document', 'admin_document_access', 'admin_original_info', 'admin_document_upload_info', 'admin_queue', 'admin_review_detail',
    'admin_eligibility_preview', 'publication_eligibility'];
  v_all text[] := v_api || array[
    'normalize_name_text', 'token_jaccard', 'title_tokens', 'refuse_change', 'admin_log', 'audit_staff_change',
    'audit_institution_eligibility', 'audit_release_restriction', 'admin_actor_role', 'admin_active_confidentiality',
    'admin_has_acknowledged', 'admin_require_role', 'admin_require_access', 'review_content_fingerprint',
    'review_revision', 'review_match_institution', 'review_match_unit', 'admin_ensure_review',
    'review_metadata_check', 'review_permission_evidence', 'review_institution_state', 'review_duplicates',
    'review_log_material_change', 'review_approval_preconditions', 'bootstrap_first_administrator'];
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any(v_all)
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', r.sig);
    if r.proname = any(v_api) then
      execute format('grant execute on function %s to service_role', r.sig);
    end if;
  end loop;
end $grants$;

commit;

-- ------------------------------------------------------------
-- Rollback (only while no review record matters; the audit log, approval
-- records and acknowledgements are evidence, so fix forward once real
-- reviews exist):
--   begin;
--   drop function if exists <every function above, by name>;   -- see the grants block for the list
--   drop table if exists review_approvals, document_versions, review_issues, review_notes, paper_reviews,
--     release_restrictions, academic_unit_aliases, academic_units, institution_aliases, institutions,
--     review_assignments, confidentiality_acknowledgements, confidentiality_versions, staff_members,
--     admin_audit_events;
--   commit;
-- ------------------------------------------------------------
