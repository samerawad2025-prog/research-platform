-- ============================================================
-- Sudanese Research Platform — Core Schema (Step 2, final pass)
-- Run this once in Supabase → SQL Editor → New Query → Run
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- researchers: anyone credited on a paper, including submitters
-- ------------------------------------------------------------
create table researchers (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text,
  -- Private administrative contact only - belongs to whichever
  -- researcher is the submitter, never displayed publicly, never
  -- returned by get_paper_for_confirmation. Same privacy footing as
  -- email, stored the same way, on the same row.
  whatsapp_number text,
  linkedin_url text,
  facebook_url text,
  school text,
  department text,
  graduation_year int,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- papers: the submitted research and its processing/publication state
-- ------------------------------------------------------------
create table papers (
  id uuid primary key default gen_random_uuid(),
  submitted_by uuid not null references researchers(id),
  -- administrative role only — who filled out the form, not a rank

  -- Academic metadata: left empty at submission on purpose.
  -- The document is the source of truth; these are filled in by
  -- AI extraction (Step 3) or by an admin, never typed by the student.
  -- Arabic fields are separate, not translations: many Sudanese
  -- theses genuinely provide both an English and an Arabic version,
  -- and we extract what's actually present, not what we could infer.
  title text,
  title_ar text,
  supervisor_name text,
  year int,
  abstract text,
  abstract_ar text,
  university text,
  faculty text,
  degree_type text,
  document_type text,
  failure_code text,
  themes text[],
  keywords text[],
  methodology text,

  file_path text not null,

  permission_to_process boolean not null default true,
  -- Table-level rule is deliberately looser than what submit_paper()
  -- enforces below: an empty array is a valid, honest state for a
  -- historical or admin-corrected record ("processing permitted,
  -- nothing public permitted"). It is submit_paper() — the only path
  -- an anonymous visitor has — that forbids an empty selection for
  -- new submissions, not this table.
  publication_scope text[] not null
    check (
      publication_scope <@ array['full_paper', 'metadata_and_article', 'abstract_and_citation']
    ),

  -- Extraction state: "is this paper's metadata ready?"
  -- Deliberately separate from ai_generations, which answers
  -- "what did we run, and what did it produce?" — and separate again
  -- from metadata_confirmed_at below, which answers a third, different
  -- question: "has a human actually reviewed this?"
  extraction_status text not null default 'pending'
    check (extraction_status in ('pending', 'processing', 'completed', 'partial', 'failed')),

  -- The decision to enter this paper's details by hand (Phase 3 M1,
  -- migration 0011). 'mode': the server was in EXTRACTION_MODE=manual
  -- when the paper was first handled. 'researcher': the researcher chose
  -- it. Kept apart from extraction_status so an earlier extraction
  -- attempt is never relabelled. Once set, no new provider call starts
  -- for the paper and no late result is applied to its metadata.
  manual_entry_at timestamptz,
  manual_entry_source text
    check (manual_entry_source in ('mode', 'researcher')),

  -- When the extract route CLAIMED this paper, not when it was
  -- submitted. The two are usually seconds apart but not always: the
  -- confirmation page can trigger extraction long after submission.
  -- This is the only honest basis for "has this been running too
  -- long", which is what lets an abandoned extraction be picked back
  -- up instead of being stuck in 'processing' forever.
  -- See BUG_HISTORY.md #27 and migration 0008.
  extraction_started_at timestamptz,

  -- Null until the submitter reviews the extraction and confirms it.
  -- One holistic timestamp for the whole confirmation screen, not
  -- tracked per field — the UI itself doesn't split that finely, so
  -- the data model doesn't either. Once set, automatic extraction may
  -- still run again later, but must never silently overwrite what's
  -- already here (enforced in application logic, not the database,
  -- since the rule is about which code path is allowed to write, not
  -- about the shape of the data itself).
  metadata_confirmed_at timestamptz,

  -- The confirmation screen's access credential. Deliberately NOT the
  -- paper's own id: an id has to be referenced everywhere internally
  -- (foreign keys, future admin views, logs), which makes it a poor
  -- secret. This is a separate random value; only its hash is ever
  -- stored, the raw value is returned to the browser exactly once,
  -- at submission time, by submit_paper() below.
  confirmation_token_hash text,

  -- Points at whichever ai_generations row's result is currently
  -- reflected in the fields above. Nullable, no FK yet — ai_generations
  -- is created further down, and it in turn references papers.
  last_applied_generation_id uuid,

  status text not null default 'submitted'
    check (status in (
      'submitted', 'in_review', 'approved', 'published', 'rejected', 'withdrawn'
    )),

  admin_notes text,
  created_at timestamptz not null default now(),

  -- The processing policy in force when this paper was submitted,
  -- stamped by trigger from extraction_policy and immutable (migration
  -- 0011). Null only on rows older than that migration.
  submission_extraction_policy text
    check (submission_extraction_policy in ('automatic', 'manual')),

  -- The manual-entry decision is recorded as a pair or not at all.
  constraint papers_manual_entry_pair_check
    check ((manual_entry_at is null) = (manual_entry_source is null))
);

-- The processing policy for NEW submissions (Phase 3 M1, migration 0011).
-- One row; starts 'manual'; changed only by an operator. RLS on with no
-- policies, like every table here.
create table extraction_policy (
  id boolean primary key default true check (id),
  mode text not null check (mode in ('automatic', 'manual')),
  changed_at timestamptz not null default now()
);
alter table extraction_policy enable row level security;
insert into extraction_policy (id, mode) values (true, 'manual');

create or replace function stamp_submission_extraction_policy()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if tg_op = 'INSERT' then
    new.submission_extraction_policy :=
      coalesce((select mode from extraction_policy where id), 'manual');
  else
    new.submission_extraction_policy := old.submission_extraction_policy;
  end if;
  return new;
end;
$fn$;
revoke all on function stamp_submission_extraction_policy() from public;

create trigger papers_stamp_extraction_policy
  before insert or update of submission_extraction_policy on papers
  for each row execute function stamp_submission_extraction_policy();

create index papers_confirmation_token_hash_idx on papers (confirmation_token_hash);

-- ------------------------------------------------------------
-- paper_researchers: many-to-many, no hierarchy.
-- author_order preserves how the paper itself lists names —
-- it is positional data, not a rank.
-- ------------------------------------------------------------
create table paper_researchers (
  paper_id uuid not null references papers(id) on delete cascade,
  researcher_id uuid not null references researchers(id) on delete cascade,
  author_order int,
  primary key (paper_id, researcher_id)
);

-- ------------------------------------------------------------
-- articles: one per paper, points at its current + published version.
-- FKs to article_versions are added after that table exists below.
-- ------------------------------------------------------------
create table articles (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null unique references papers(id) on delete cascade,
  current_version_id uuid,
  published_version_id uuid,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- article_versions: every draft, human edit, and regeneration —
-- nothing is ever overwritten, only added.
-- ------------------------------------------------------------
create table article_versions (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references articles(id) on delete cascade,
  version_number int not null,

  created_by text,          -- e.g. 'ai' or an admin's name
  is_ai_generated boolean not null default false,
  status text not null default 'draft'
    check (status in ('draft', 'needs_review', 'approved', 'published')),

  headline text,
  headline_ar text,
  body_en text,
  body_ar text,
  linkedin_post text,
  facebook_post_ar text,
  notes text,

  is_published boolean not null default false,
  created_at timestamptz not null default now(),

  unique (article_id, version_number)
);

-- Only one version per article may be marked published at a time.
create unique index one_published_version_per_article
  on article_versions (article_id)
  where is_published;

-- Now that article_versions exists, wire up the two pointer columns.
alter table articles
  add constraint articles_current_version_fk
    foreign key (current_version_id) references article_versions(id),
  add constraint articles_published_version_fk
    foreign key (published_version_id) references article_versions(id);

-- ------------------------------------------------------------
-- ai_generations: full history of every extraction/generation run.
-- result_data holds the raw structured output of that specific run —
-- re-running extraction adds a new row here, it never touches or
-- destroys a previous one. papers.last_applied_generation_id (above)
-- records which run's data was actually copied into papers' columns.
-- ------------------------------------------------------------
create table ai_generations (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null references papers(id) on delete cascade,
  generation_type text not null,   -- e.g. 'metadata_extraction','article_draft','linkedin_post'
  provider text,                   -- e.g. 'gemini', 'anthropic', 'mock' — which service ran this
  model_used text,                 -- e.g. 'gemini-2.5-flash' — which specific model
  status text not null default 'success' check (status in ('success', 'failed')),
  result_data jsonb,
  result_version_id uuid references article_versions(id),
  notes text,
  created_at timestamptz not null default now()
);

alter table papers
  add constraint papers_last_applied_generation_fk
    foreign key (last_applied_generation_id) references ai_generations(id);

-- ============================================================
-- Row Level Security
-- Every table is fully locked to anonymous users — no insert,
-- no select, nothing. The ONLY way an anonymous visitor can
-- write anything is through submit_paper() below.
-- ============================================================
alter table researchers        enable row level security;
alter table papers             enable row level security;
alter table paper_researchers  enable row level security;
alter table articles           enable row level security;
alter table article_versions   enable row level security;
alter table ai_generations     enable row level security;

-- Deliberately no policies for anon on any table.

-- ============================================================
-- Guard: a version can only be marked published once its paper
-- has actually been through human review. Enforced by the
-- database itself, not by the admin dashboard remembering to check.
-- ============================================================
create or replace function prevent_premature_publish()
returns trigger
language plpgsql
as $$
begin
  if new.is_published then
    if not exists (
      select 1
      from articles a
      join papers p on p.id = a.paper_id
      where a.id = new.article_id
        and p.status in ('approved', 'published')
    ) then
      raise exception 'Cannot publish a version until its paper has been approved.';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_prevent_premature_publish
  before insert or update on article_versions
  for each row execute function prevent_premature_publish();

-- ============================================================
-- submit_paper: the only door anonymous visitors get.
-- ============================================================
create or replace function submit_paper(
  p_full_name text,
  p_email text,
  p_file_path text,
  p_permission_to_process boolean,
  p_publication_scope text[],
  p_whatsapp_number text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_researcher_id uuid;
  v_paper_id uuid;
  v_token text;
begin
  if p_permission_to_process is distinct from true then
    raise exception 'Permission to process is required to submit.';
  end if;

  if p_publication_scope is null or coalesce(array_length(p_publication_scope, 1), 0) = 0 then
    raise exception 'At least one publication preference is required.';
  end if;

  if not (p_publication_scope <@ array['full_paper', 'metadata_and_article', 'abstract_and_citation']) then
    raise exception 'Invalid publication scope value.';
  end if;

  if p_full_name is null or length(trim(p_full_name)) = 0 then
    raise exception 'Submitter name is required.';
  end if;

  if p_file_path is null or length(trim(p_file_path)) = 0 then
    raise exception 'A research file is required.';
  end if;

  -- Loose sanity check only, not a strict phone-format validator:
  -- international numbers vary too much in shape to police tightly.
  -- This just guards against obvious junk in a field meant for a
  -- phone number.
  if p_whatsapp_number is not null and length(trim(p_whatsapp_number)) > 0
     and trim(p_whatsapp_number) !~ '^[+0-9][0-9+\-\s()]{5,24}$' then
    raise exception 'That doesn''t look like a valid WhatsApp number.';
  end if;

  insert into researchers (full_name, email, whatsapp_number)
  values (trim(p_full_name), nullif(trim(p_email), ''), nullif(trim(p_whatsapp_number), ''))
  returning id into v_researcher_id;

  -- A 256-bit random value. This doesn't need slow password-style
  -- hashing (bcrypt etc.) the way a human-chosen password would —
  -- the entropy already comes from the token itself, a fast
  -- cryptographic hash is the correct tool here, not a heavier one.
  v_token := encode(gen_random_bytes(32), 'hex');

  insert into papers (
    submitted_by, file_path, permission_to_process, publication_scope,
    status, extraction_status, confirmation_token_hash
  )
  values (
    v_researcher_id, p_file_path, true, p_publication_scope,
    'submitted', 'pending', encode(digest(v_token, 'sha256'), 'hex')
  )
  returning id into v_paper_id;

  insert into paper_researchers (paper_id, researcher_id, author_order)
  values (v_paper_id, v_researcher_id, 1);

  -- The raw token is handed back exactly once, here. From this point
  -- on only its hash exists anywhere in the system.
  return jsonb_build_object('paper_id', v_paper_id, 'confirmation_token', v_token);
end;
$$;

revoke all on function submit_paper(text, text, text, boolean, text[], text) from public;
grant execute on function submit_paper(text, text, text, boolean, text[], text) to anon;

-- ============================================================
-- get_paper_for_confirmation: the only way an anonymous visitor
-- can READ a paper's extracted data. The token is the credential,
-- not the paper's id — see the note on confirmation_token_hash
-- above for why. Returns null for any invalid token; there is no
-- way to distinguish "wrong token" from "doesn't exist" from the
-- response, nothing to enumerate.
-- ============================================================
create or replace function get_paper_for_confirmation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_paper record;
  v_researchers jsonb;
  v_extraction jsonb;
begin
  if p_token is null or length(p_token) = 0 then
    return null;
  end if;

  select * into v_paper
  from papers
  where confirmation_token_hash = encode(digest(p_token, 'sha256'), 'hex')
  limit 1;

  if not found then
    return null;
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'researcher_id', r.id,
      'full_name', r.full_name,
      'linkedin_url', r.linkedin_url,
      'facebook_url', r.facebook_url,
      'author_order', pr.author_order
    ) order by pr.author_order nulls last, r.full_name
  ), '[]'::jsonb)
  into v_researchers
  from paper_researchers pr
  join researchers r on r.id = pr.researcher_id
  where pr.paper_id = v_paper.id;

  select ag.result_data into v_extraction
  from ai_generations ag
  where ag.id = v_paper.last_applied_generation_id;

  -- Explicit allowlist of fields, not select * — confirmation_token_hash
  -- and admin_notes are structurally impossible to leak here, not just
  -- filtered out by convention.
  return jsonb_build_object(
    'paper_id', v_paper.id,
    'title', v_paper.title,
    'title_ar', v_paper.title_ar,
    'abstract', v_paper.abstract,
    'abstract_ar', v_paper.abstract_ar,
    'supervisor_name', v_paper.supervisor_name,
    'year', v_paper.year,
    'university', v_paper.university,
    'faculty', v_paper.faculty,
    'degree_type', v_paper.degree_type,
    'document_type', v_paper.document_type,
    'failure_code', v_paper.failure_code,
    'publication_scope', v_paper.publication_scope,
    'extraction_status', v_paper.extraction_status,
    'metadata_confirmed_at', v_paper.metadata_confirmed_at,
    -- Phase 3 M1 (migration 0011): whether this submission's details
    -- are being entered by hand, and why ('mode' or 'researcher'), so
    -- the choice survives a refresh or a reopened link.
    'manual_entry_source', v_paper.manual_entry_source,
    'manual_entry_at', v_paper.manual_entry_at,
    'researchers', v_researchers,
    'extraction_detail', v_extraction
  );
end;
$$;

revoke all on function get_paper_for_confirmation(text) from public;
grant execute on function get_paper_for_confirmation(text) to anon;

-- ============================================================
-- ------------------------------------------------------------
-- normalize_year_text: the SQL twin of normalizeYear() in
-- lib/extraction/applyResult.js. Kept deliberately identical in
-- behaviour, because the two run on the same values from opposite
-- ends of the pipeline.
--
-- Folds Arabic-Indic (٠-٩) and Eastern Arabic-Indic / Persian (۰-۹)
-- digits to ASCII, then reads a 4-digit year out of the surrounding
-- text, so '٢٠١٩م' yields 2019. Returns null unless exactly one
-- in-range year is present: a Hijri '١٤٤٥' is a syntactically perfect
-- 1445 and must never be stored as a Gregorian year, and a span like
-- '1995 - 2017' has no single correct answer.
-- ------------------------------------------------------------
create or replace function normalize_year_text(p_value text)
returns int
language plpgsql
immutable
set search_path = public, extensions
as $$
declare
  v_ascii text;
  v_years int[];
begin
  if p_value is null then
    return null;
  end if;

  v_ascii := translate(p_value, '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789');

  select array_agg(distinct m[1]::int)
    into v_years
    from regexp_matches(v_ascii, '(\d{4})', 'g') as m
   where m[1]::int between 1900 and 2100;

  if v_years is null or array_length(v_years, 1) <> 1 then
    return null;
  end if;

  return v_years[1];
end;
$$;

revoke all on function normalize_year_text(text) from public;

-- confirm_researcher_metadata: the only way an anonymous visitor
-- can WRITE confirmed data. Updates an existing researcher's row
-- in place when a researcher_id is supplied and already linked to
-- this paper (this is what keeps the submitter's own email
-- attached rather than silently replacing their row with a fresh,
-- email-less one on every confirmation). Adds new rows for anyone
-- without an id. Removes links for anyone dropped from the list.
-- LinkedIn/Facebook are only ever stored if the paper's own
-- publication_scope includes metadata_and_article — enforced here,
-- not just hidden in the UI. Callable more than once: the
-- submitter revising their own confirmation is expected, not an error.
-- ============================================================
create or replace function confirm_researcher_metadata(
  p_token text,
  p_researchers jsonb,
  p_corrections jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_paper record;
  v_item jsonb;
  v_researcher_id uuid;
  v_allow_social boolean;
  v_order int := 0;
  v_kept_ids uuid[] := '{}';
begin
  select * into v_paper
  from papers
  where confirmation_token_hash = encode(digest(p_token, 'sha256'), 'hex')
  limit 1;

  if not found then
    raise exception 'Invalid or expired confirmation link.';
  end if;

  if p_researchers is null or jsonb_typeof(p_researchers) <> 'array' or jsonb_array_length(p_researchers) = 0 then
    raise exception 'At least one researcher is required.';
  end if;

  v_allow_social := ('metadata_and_article' = any(v_paper.publication_scope));

  for v_item in select * from jsonb_array_elements(p_researchers)
  loop
    v_order := v_order + 1;

    if v_item->>'full_name' is null or length(trim(v_item->>'full_name')) = 0 then
      raise exception 'Each researcher needs a name.';
    end if;

    if (v_item->>'researcher_id') is not null
       and exists (
         select 1 from paper_researchers
         where paper_id = v_paper.id and researcher_id = (v_item->>'researcher_id')::uuid
       )
    then
      v_researcher_id := (v_item->>'researcher_id')::uuid;
      update researchers set
        full_name = trim(v_item->>'full_name'),
        linkedin_url = case when v_allow_social then nullif(v_item->>'linkedin_url', '') else linkedin_url end,
        facebook_url = case when v_allow_social then nullif(v_item->>'facebook_url', '') else facebook_url end
      where id = v_researcher_id;
    else
      insert into researchers (full_name, linkedin_url, facebook_url)
      values (
        trim(v_item->>'full_name'),
        case when v_allow_social then nullif(v_item->>'linkedin_url', '') else null end,
        case when v_allow_social then nullif(v_item->>'facebook_url', '') else null end
      )
      returning id into v_researcher_id;
    end if;

    insert into paper_researchers (paper_id, researcher_id, author_order)
    values (v_paper.id, v_researcher_id, coalesce((v_item->>'author_order')::int, v_order))
    on conflict (paper_id, researcher_id)
    do update set author_order = excluded.author_order;

    v_kept_ids := v_kept_ids || v_researcher_id;
  end loop;

  delete from paper_researchers
  where paper_id = v_paper.id
    and researcher_id <> all(v_kept_ids);

  if p_corrections is not null then
    -- A key present but empty means the submitter cleared the field
    -- deliberately (the extraction was wrong and there is no correct
    -- value). A key absent entirely means they didn't touch it, so
    -- the existing value stands.
    update papers set
      title = case when p_corrections ? 'title' then nullif(trim(p_corrections->>'title'), '') else title end,
      title_ar = case when p_corrections ? 'title_ar' then nullif(trim(p_corrections->>'title_ar'), '') else title_ar end,
      abstract = case when p_corrections ? 'abstract' then nullif(trim(p_corrections->>'abstract'), '') else abstract end,
      abstract_ar = case when p_corrections ? 'abstract_ar' then nullif(trim(p_corrections->>'abstract_ar'), '') else abstract_ar end,
      supervisor_name = case when p_corrections ? 'supervisor_name' then nullif(trim(p_corrections->>'supervisor_name'), '') else supervisor_name end,
      university = case when p_corrections ? 'university' then nullif(trim(p_corrections->>'university'), '') else university end,
      faculty = case when p_corrections ? 'faculty' then nullif(trim(p_corrections->>'faculty'), '') else faculty end,
      degree_type = case when p_corrections ? 'degree_type' then nullif(trim(p_corrections->>'degree_type'), '') else degree_type end,
      -- An unparseable year KEEPS the existing value. Erasing it was
      -- bug O (BUG_HISTORY.md #34): '٢٠١٩م' fails a bare ^[0-9]{4}$
      -- and used to null out a year the submitter had just confirmed.
      -- Accepted forms match lib/extraction/applyResult.js
      -- normalizeYear exactly. An empty string still clears the field,
      -- like every other column here.
      year = case
               when p_corrections ? 'year' then
                 case when nullif(trim(p_corrections->>'year'), '') is null
                      then null
                      else coalesce(normalize_year_text(p_corrections->>'year'), year) end
               else year
             end
    where id = v_paper.id;
  end if;

  update papers set metadata_confirmed_at = now() where id = v_paper.id;

  return jsonb_build_object('paper_id', v_paper.id, 'confirmed_at', now());
end;
$$;

revoke all on function confirm_researcher_metadata(text, jsonb, jsonb) from public;
grant execute on function confirm_researcher_metadata(text, jsonb, jsonb) to anon;

-- ============================================================
-- Storage: bucket + policies for the "papers" bucket.
-- storage.buckets and storage.objects already exist in every
-- Supabase project — this configures them, it doesn't create them.
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'papers',
  'papers',
  false,                                    -- private: never served via a public URL
  20971520,                                 -- 20 MB, enforced by Supabase on every upload
  -- PDF and DOCX only. Legacy .doc has no reliable, dependency-light
  -- extraction path (mammoth handles OOXML .docx, not the old binary
  -- format) - agreed to narrow new submissions to these two and handle
  -- any existing .doc files manually rather than build a shakier parser.
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types,
  public = excluded.public;

-- storage.objects has Row Level Security enabled by default on every
-- Supabase project — you're not allowed to (and don't need to) touch
-- that yourself, so there's nothing to run here.

-- Anonymous visitors may upload into "papers" — nothing else.
-- No SELECT/UPDATE/DELETE policy exists for anon: reading,
-- downloading, listing, overwriting, or removing any file —
-- including their own — is impossible through the API. The
-- unique constraint on (bucket_id, name) means even a guessed
-- path can't silently overwrite an existing file; the upload
-- just fails instead.
create policy "anon can upload research files"
on storage.objects for insert
to anon
with check (bucket_id = 'papers');

-- ============================================================
-- Phase 3 M2A (migration 0012): server-controlled acceptance and upload.
-- Kept verbatim from the migration so the fresh-install end state matches;
-- it redefines stamp_submission_extraction_policy() above with the
-- server-decision rule. See supabase/migrations/0012_submission_acceptance.sql
-- for the full commentary.
-- ============================================================
-- ------------------------------------------------------------
-- Agreement registry: which exact text may be accepted. The hash is of
-- the file in docs/legal/, verified by a repository test. active = false
-- everywhere until the founder activates the agreement.
-- ------------------------------------------------------------
create table if not exists agreement_versions (
  id text primary key,
  agreement_key text not null,
  language text not null check (language in ('en', 'ar')),
  version_label text not null,
  version_date date not null,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  active boolean not null default false,
  unique (agreement_key, language, version_label)
);
alter table agreement_versions enable row level security;
revoke all on table agreement_versions from anon, authenticated;

insert into agreement_versions (id, agreement_key, language, version_label, version_date, content_sha256, active)
values
  ('submission-terms-2026-09-25-en', 'submission-terms', 'en', 'Initial Version', '2026-09-25',
   '77376e5ef87f47395475525dea70a4716b7e9d2a9c4b30003612f2d172e676da', false),
  ('submission-terms-2026-09-25-ar', 'submission-terms', 'ar', 'Initial Version', '2026-09-25',
   '54a78f8441426b5c2dd190235fb57cfaa0ae9e1a956d6aefb64ff0a13208795b', false)
on conflict (id) do nothing;

-- ------------------------------------------------------------
-- Acceptance records ("submission intents"). One row per acceptance.
-- It is the evidence of what was accepted, when, under which processing
-- decision, and - after finalization - for which exact document.
-- Never deleted by the application; an abandoned one is marked expired.
-- ------------------------------------------------------------
create table if not exists submission_acceptances (
  id uuid primary key default gen_random_uuid(),
  intent_token_hash text not null unique,
  status text not null default 'open' check (status in ('open', 'finalized', 'expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,

  agreement_version_id text not null references agreement_versions(id),
  agreement_language text not null check (agreement_language in ('en', 'ar')),
  agreement_sha256 text not null,
  accepted_at timestamptz not null default now(),       -- server time, never the client's
  claimed_role text not null check (claimed_role in ('author', 'coauthor', 'authorized_depositor')),
  identity_verified boolean not null default false,     -- an anonymous declaration, not verification
  publication_setting text not null check (publication_setting in ('record_abstract', 'record_abstract_fulltext')),

  -- Permission snapshot at acceptance. processing_decision is never
  -- broader than processing_offer_decision: what the researcher was shown
  -- (the server-signed offer from /terms) caps what may be recorded.
  processing_decision text not null check (processing_decision in ('automatic', 'manual')),
  processing_offer_decision text not null check (processing_offer_decision in ('automatic', 'manual')),
  offer_issued_at timestamptz not null,
  processing_mode_at_acceptance text not null check (processing_mode_at_acceptance in ('automatic', 'manual')),
  processing_policy_at_acceptance text not null check (processing_policy_at_acceptance in ('automatic', 'manual')),

  full_name text not null,
  email text not null,
  whatsapp_number text,

  -- The one place this acceptance may upload to, chosen by the server.
  object_path text not null unique check (object_path ~ '^intents/[0-9a-f-]{36}/[0-9a-f]{24}\.(pdf|docx)$'),
  file_extension text not null check (file_extension in ('pdf', 'docx')),
  declared_size bigint not null check (declared_size > 0 and declared_size <= 20971520),

  -- When the Storage upload authorization for object_path stops working,
  -- read from the authorization itself. Intent expiry does NOT revoke it,
  -- so cleanup waits for this, not for expires_at.
  upload_authorization_expires_at timestamptz,

  finalized_at timestamptz,
  paper_id uuid unique,
  object_sha256 text,
  object_size bigint,
  object_removed_at timestamptz,

  check (status <> 'finalized' or (paper_id is not null and object_sha256 is not null)),
  check (processing_decision = 'manual' or processing_offer_decision = 'automatic')
);
alter table submission_acceptances enable row level security;
revoke all on table submission_acceptances from anon, authenticated;
create index if not exists submission_acceptances_open_expiry
  on submission_acceptances (expires_at) where status = 'open';

-- ------------------------------------------------------------
-- Papers created by the new path point at their acceptance and record the
-- document they were accepted for.
-- ------------------------------------------------------------
alter table papers add column if not exists submission_acceptance_id uuid unique references submission_acceptances(id);
alter table papers add column if not exists publication_setting text;
alter table papers drop constraint if exists papers_publication_setting_check;
alter table papers add constraint papers_publication_setting_check
  check (publication_setting in ('record_abstract', 'record_abstract_fulltext'));
alter table papers add column if not exists file_sha256 text;
alter table papers add column if not exists file_size bigint;
alter table papers add column if not exists submission_decision_source text;
alter table papers drop constraint if exists papers_submission_decision_source_check;
alter table papers add constraint papers_submission_decision_source_check
  check (submission_decision_source in ('server', 'database_policy'));

alter table submission_acceptances drop constraint if exists submission_acceptances_paper_fk;
alter table submission_acceptances add constraint submission_acceptances_paper_fk
  foreign key (paper_id) references papers(id);

-- ------------------------------------------------------------
-- The 0011 stamp, extended. The least permissive of (a) what the server
-- decided, when the inserting code is the server path, and (b) the policy
-- row now. Immutable afterwards, together with its source.
-- ------------------------------------------------------------
create or replace function stamp_submission_extraction_policy()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_policy text := coalesce((select mode from extraction_policy where id), 'manual');
begin
  if tg_op = 'INSERT' then
    if new.submission_decision_source = 'server' then
      new.submission_extraction_policy :=
        case when new.submission_extraction_policy = 'automatic' and v_policy = 'automatic'
             then 'automatic' else 'manual' end;
    else
      new.submission_extraction_policy := v_policy;
      new.submission_decision_source := 'database_policy';
    end if;
  else
    new.submission_extraction_policy := old.submission_extraction_policy;
    new.submission_decision_source := old.submission_decision_source;
  end if;
  return new;
end;
$fn$;
revoke all on function stamp_submission_extraction_policy() from public;

drop trigger if exists papers_stamp_extraction_policy on papers;
create trigger papers_stamp_extraction_policy
  before insert or update of submission_extraction_policy, submission_decision_source on papers
  for each row execute function stamp_submission_extraction_policy();

-- ------------------------------------------------------------
-- Request limits for the new anonymous endpoints: fixed windows keyed by
-- a salted hash of the client address (the address itself is not stored).
-- ------------------------------------------------------------
create table if not exists submission_rate_limits (
  key text not null,
  window_start timestamptz not null,
  count int not null default 0,
  primary key (key, window_start)
);
alter table submission_rate_limits enable row level security;
revoke all on table submission_rate_limits from anon, authenticated;

create or replace function consume_submission_rate_limit(p_key text, p_limit int, p_window_seconds int)
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_count int;
begin
  insert into submission_rate_limits as r (key, window_start, count)
  values (p_key, v_window, 1)
  on conflict (key, window_start) do update set count = r.count + 1
  returning count into v_count;
  -- Keep the table small; bounded work per call.
  delete from submission_rate_limits
  where ctid in (select ctid from submission_rate_limits where window_start < now() - interval '2 days' limit 50);
  return v_count <= p_limit;
end;
$fn$;

-- ------------------------------------------------------------
-- 1. Record an acceptance. Called only by the server (service role), after
--    it has validated everything it can in code. Re-checks what the
--    database is the authority for: the agreement row, and the policy.
-- ------------------------------------------------------------
create or replace function create_submission_intent(
  p_intent_token_hash text,
  p_agreement_version_id text,
  p_agreement_language text,
  p_agreement_sha256 text,
  p_claimed_role text,
  p_publication_setting text,
  p_processing_mode text,
  p_full_name text,
  p_email text,
  p_whatsapp_number text,
  p_file_extension text,
  p_declared_size bigint,
  p_ttl_seconds int,
  p_offer_decision text,
  p_offer_issued_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_agreement agreement_versions%rowtype;
  v_policy text := coalesce((select mode from extraction_policy where id), 'manual');
  v_mode text := case when p_processing_mode = 'automatic' then 'automatic' else 'manual' end;
  v_decision text;
  v_id uuid := gen_random_uuid();
  v_path text;
  v_row submission_acceptances%rowtype;
begin
  select * into v_agreement from agreement_versions where id = p_agreement_version_id;
  if not found or not v_agreement.active then
    raise exception 'submission:agreement_not_active';
  end if;
  if v_agreement.language <> p_agreement_language or v_agreement.content_sha256 <> p_agreement_sha256 then
    raise exception 'submission:agreement_mismatch';
  end if;

  -- Automatic only when both the running application and the policy row say
  -- so. Anything else - including a value this function does not know -
  -- is manual.
  -- ...and only when the offer the researcher accepted said so. The
  -- application refuses a stale offer that would become broader before
  -- calling this; this cap makes that hold even if something changed in
  -- between. It can only narrow.
  v_decision := case when v_mode = 'automatic' and v_policy = 'automatic' and p_offer_decision = 'automatic'
                     then 'automatic' else 'manual' end;
  v_path := 'intents/' || v_id::text || '/' || encode(gen_random_bytes(12), 'hex') || '.' || p_file_extension;

  insert into submission_acceptances (
    id, intent_token_hash, expires_at,
    agreement_version_id, agreement_language, agreement_sha256,
    claimed_role, publication_setting,
    processing_decision, processing_mode_at_acceptance, processing_policy_at_acceptance,
    processing_offer_decision, offer_issued_at,
    full_name, email, whatsapp_number,
    object_path, file_extension, declared_size
  ) values (
    v_id, p_intent_token_hash, now() + make_interval(secs => p_ttl_seconds),
    v_agreement.id, v_agreement.language, v_agreement.content_sha256,
    p_claimed_role, p_publication_setting,
    v_decision, v_mode, v_policy,
    case when p_offer_decision = 'automatic' then 'automatic' else 'manual' end, p_offer_issued_at,
    trim(p_full_name), trim(p_email), nullif(trim(p_whatsapp_number), ''),
    v_path, p_file_extension, p_declared_size
  )
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id,
    'object_path', v_row.object_path,
    'expires_at', v_row.expires_at,
    'accepted_at', v_row.accepted_at,
    'processing_decision', v_row.processing_decision
  );
end;
$fn$;

-- ------------------------------------------------------------
-- Look up an acceptance for finalization. The intent token is the only
-- credential; a wrong token and an unknown id look identical (null).
-- ------------------------------------------------------------
create or replace function get_submission_intent(p_intent_id uuid, p_intent_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row submission_acceptances%rowtype;
begin
  select * into v_row from submission_acceptances
  where id = p_intent_id and intent_token_hash = p_intent_token_hash;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'id', v_row.id,
    'status', v_row.status,
    'expired', v_row.status = 'open' and v_row.expires_at < now(),
    'object_path', v_row.object_path,
    'file_extension', v_row.file_extension,
    'declared_size', v_row.declared_size,
    'processing_decision', v_row.processing_decision,
    'paper_id', v_row.paper_id
  );
end;
$fn$;

-- ------------------------------------------------------------
-- 3. Finalize: create the paper exactly once. The row lock makes
--    concurrent or repeated calls safe: the first creates the paper, every
--    later call returns that same paper and changes nothing.
-- ------------------------------------------------------------
create or replace function finalize_submission_intent(
  p_intent_id uuid,
  p_intent_token_hash text,
  p_object_size bigint,
  p_object_sha256 text,
  p_confirmation_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_row submission_acceptances%rowtype;
  v_researcher_id uuid;
  v_paper_id uuid;
  v_policy text;
begin
  select * into v_row from submission_acceptances
  where id = p_intent_id and intent_token_hash = p_intent_token_hash
  for update;
  if not found then
    raise exception 'submission:intent_not_found';
  end if;

  if v_row.status = 'finalized' then
    select submission_extraction_policy into v_policy from papers where id = v_row.paper_id;
    return jsonb_build_object('paper_id', v_row.paper_id, 'already_finalized', true, 'processing_decision', v_policy);
  end if;

  -- Returned, not raised: raising would roll the status change back.
  if v_row.status = 'expired' or v_row.expires_at < now() then
    update submission_acceptances set status = 'expired' where id = v_row.id and status = 'open';
    return jsonb_build_object('error', 'intent_expired');
  end if;

  if p_object_size is distinct from v_row.declared_size then
    raise exception 'submission:object_size_mismatch';
  end if;
  if p_object_sha256 !~ '^[0-9a-f]{64}$' or p_confirmation_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'submission:invalid_finalization';
  end if;

  insert into researchers (full_name, email, whatsapp_number)
  values (v_row.full_name, v_row.email, v_row.whatsapp_number)
  returning id into v_researcher_id;

  -- permission_to_process = false: the legacy checkbox was not shown on
  -- this path, and the column must not claim it was. The evidence for this
  -- paper is its acceptance record. publication_scope is the legacy
  -- multi-choice field; empty here, the new publication_setting is the
  -- value in force.
  insert into papers (
    submitted_by, file_path, permission_to_process, publication_scope,
    status, extraction_status, confirmation_token_hash,
    submission_acceptance_id, publication_setting, file_sha256, file_size,
    submission_extraction_policy, submission_decision_source
  ) values (
    v_researcher_id, v_row.object_path, false, '{}',
    'submitted', 'pending', p_confirmation_token_hash,
    v_row.id, v_row.publication_setting, p_object_sha256, p_object_size,
    v_row.processing_decision, 'server'
  )
  returning id, submission_extraction_policy into v_paper_id, v_policy;

  -- The submitter is always recorded (papers.submitted_by, and the
  -- acceptance itself). They are linked as a researcher on the paper only
  -- when they declared authorship, and that declaration is unverified: the
  -- confirmation step, where the real author list is entered and ordered,
  -- can change it. An authorized depositor (a librarian, a volunteer) is
  -- never made an author here. A co-author's position is unknown, so it is
  -- left unset for the confirmation step to fill in.
  if v_row.claimed_role in ('author', 'coauthor') then
    insert into paper_researchers (paper_id, researcher_id, author_order)
    values (v_paper_id, v_researcher_id, case when v_row.claimed_role = 'author' then 1 else null end);
  end if;

  update submission_acceptances
  set status = 'finalized', finalized_at = now(), paper_id = v_paper_id,
      object_sha256 = p_object_sha256, object_size = p_object_size
  where id = v_row.id;

  return jsonb_build_object('paper_id', v_paper_id, 'already_finalized', false, 'processing_decision', v_policy);
end;
$fn$;

-- ------------------------------------------------------------
-- The upload authorization's own expiry, read by the server from the
-- authorization Storage issued. Can only move later, never earlier.
-- ------------------------------------------------------------
create or replace function record_upload_authorization(p_intent_id uuid, p_expires_at timestamptz)
returns void
language sql
security definer
set search_path = public
as $fn$
  update submission_acceptances
  set upload_authorization_expires_at = greatest(coalesce(upload_authorization_expires_at, p_expires_at), p_expires_at)
  where id = p_intent_id;
$fn$;

-- ------------------------------------------------------------
-- Abandoned acceptances: mark expired, and hand back ONLY their own
-- server-chosen object paths for removal. A finalized acceptance, or any
-- object outside intents/<id>/, is never returned.
-- ------------------------------------------------------------
-- Two separate, bounded steps.
--  1. Mark at most p_limit open acceptances whose own expiry has passed as
--     expired (nothing else changes; the evidence row stays).
--  2. Return at most p_limit cleanup candidates: never finalized, and past
--     the point where no upload can still land at their path - the upload
--     authorization's own expiry plus p_margin_seconds for an upload that
--     started just before it. Intent expiry alone never makes an object
--     eligible, because it does not revoke the Storage authorization. An
--     unknown authorization expiry is treated as a full day.
--     A row whose object was already removed comes back only if a check
--     after removal is still due (object_removed_at earlier than that
--     point), so an object that landed late is found and removed again.
create or replace function expire_submission_intents(p_limit int, p_margin_seconds int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_limit int := greatest(0, least(p_limit, 100));
  v_out jsonb;
begin
  update submission_acceptances set status = 'expired'
  where id in (
    select id from submission_acceptances
    where status = 'open' and expires_at < now()
    order by expires_at
    limit v_limit
    for update skip locked
  );

  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'object_path', c.object_path)), '[]'::jsonb)
  into v_out
  from (
    select id, object_path
    from (
      select id, object_path, expires_at, object_removed_at,
             coalesce(upload_authorization_expires_at, created_at + interval '1 day')
               + make_interval(secs => greatest(p_margin_seconds, 0)) as safe_after
      from submission_acceptances
      where status = 'expired' and paper_id is null
    ) e
    where e.safe_after < now()
      and (e.object_removed_at is null or e.object_removed_at < e.safe_after)
    order by e.expires_at
    limit v_limit
  ) c;
  return v_out;
end;
$fn$;

create or replace function mark_submission_object_removed(p_intent_id uuid)
returns void
language sql
security definer
set search_path = public
as $fn$
  update submission_acceptances set object_removed_at = now()
  where id = p_intent_id and status = 'expired' and paper_id is null;
$fn$;

-- Service role only. Nothing here is callable by anon or authenticated.
revoke all on function consume_submission_rate_limit(text, int, int) from public, anon, authenticated;
revoke all on function create_submission_intent(text, text, text, text, text, text, text, text, text, text, text, bigint, int, text, timestamptz) from public, anon, authenticated;
revoke all on function get_submission_intent(uuid, text) from public, anon, authenticated;
revoke all on function finalize_submission_intent(uuid, text, bigint, text, text) from public, anon, authenticated;
revoke all on function expire_submission_intents(int, int) from public, anon, authenticated;
revoke all on function mark_submission_object_removed(uuid) from public, anon, authenticated;
revoke all on function record_upload_authorization(uuid, timestamptz) from public, anon, authenticated;
grant execute on function consume_submission_rate_limit(text, int, int) to service_role;
grant execute on function create_submission_intent(text, text, text, text, text, text, text, text, text, text, text, bigint, int, text, timestamptz) to service_role;
grant execute on function get_submission_intent(uuid, text) to service_role;
grant execute on function finalize_submission_intent(uuid, text, bigint, text, text) to service_role;
grant execute on function expire_submission_intents(int, int) to service_role;
grant execute on function mark_submission_object_removed(uuid) to service_role;
grant execute on function record_upload_authorization(uuid, timestamptz) to service_role;

-- ============================================================
-- Phase 3 M2B/M3 (migration 0013): LinkedIn display choice, Facebook no
-- longer collected, depositor-declared authors, shared researcher rows
-- protected. Kept verbatim from the migration. Migration 0014 (closing the
-- legacy anonymous path) is NOT part of a fresh install until the cutover
-- it belongs to has happened; see docs/submission-flow.md, "Cutover".
-- ============================================================
alter table researchers add column if not exists linkedin_public boolean not null default false;

alter table submission_acceptances add column if not exists declared_authors jsonb;
alter table submission_acceptances drop constraint if exists submission_acceptances_declared_authors_check;
alter table submission_acceptances add constraint submission_acceptances_declared_authors_check
  check (declared_authors is null
         or (jsonb_typeof(declared_authors) = 'array' and jsonb_array_length(declared_authors) between 1 and 50));

-- ------------------------------------------------------------
-- Record the depositor's author list with the acceptance, once, before
-- the server issues any upload authorization. Service role only.
-- ------------------------------------------------------------
create or replace function record_declared_authors(p_intent_id uuid, p_authors jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row submission_acceptances%rowtype;
  v_clean jsonb := '[]'::jsonb;
  v_name text;
begin
  if p_authors is null or jsonb_typeof(p_authors) <> 'array'
     or jsonb_array_length(p_authors) < 1 or jsonb_array_length(p_authors) > 50 then
    raise exception 'submission:authors_invalid';
  end if;
  for v_name in select trim(value) from jsonb_array_elements_text(p_authors)
  loop
    if v_name is null or length(v_name) = 0 or length(v_name) > 200 then
      raise exception 'submission:authors_invalid';
    end if;
    v_clean := v_clean || to_jsonb(v_name);
  end loop;

  select * into v_row from submission_acceptances where id = p_intent_id for update;
  if not found or v_row.status <> 'open' or v_row.claimed_role <> 'authorized_depositor'
     or v_row.declared_authors is not null then
    raise exception 'submission:authors_not_recordable';
  end if;
  update submission_acceptances set declared_authors = v_clean where id = p_intent_id;
end;
$fn$;

-- ------------------------------------------------------------
-- Finalize, as in 0012, plus: a depositor's declared authors are linked in
-- their declared order. Same signature, so the 0012 grants stay in force.
-- ------------------------------------------------------------
create or replace function finalize_submission_intent(
  p_intent_id uuid,
  p_intent_token_hash text,
  p_object_size bigint,
  p_object_sha256 text,
  p_confirmation_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_row submission_acceptances%rowtype;
  v_researcher_id uuid;
  v_author_id uuid;
  v_paper_id uuid;
  v_policy text;
  v_name text;
  v_order int := 0;
begin
  select * into v_row from submission_acceptances
  where id = p_intent_id and intent_token_hash = p_intent_token_hash
  for update;
  if not found then
    raise exception 'submission:intent_not_found';
  end if;

  if v_row.status = 'finalized' then
    select submission_extraction_policy into v_policy from papers where id = v_row.paper_id;
    return jsonb_build_object('paper_id', v_row.paper_id, 'already_finalized', true, 'processing_decision', v_policy);
  end if;

  -- Returned, not raised: raising would roll the status change back.
  if v_row.status = 'expired' or v_row.expires_at < now() then
    update submission_acceptances set status = 'expired' where id = v_row.id and status = 'open';
    return jsonb_build_object('error', 'intent_expired');
  end if;

  if p_object_size is distinct from v_row.declared_size then
    raise exception 'submission:object_size_mismatch';
  end if;
  if p_object_sha256 !~ '^[0-9a-f]{64}$' or p_confirmation_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'submission:invalid_finalization';
  end if;

  insert into researchers (full_name, email, whatsapp_number)
  values (v_row.full_name, v_row.email, v_row.whatsapp_number)
  returning id into v_researcher_id;

  insert into papers (
    submitted_by, file_path, permission_to_process, publication_scope,
    status, extraction_status, confirmation_token_hash,
    submission_acceptance_id, publication_setting, file_sha256, file_size,
    submission_extraction_policy, submission_decision_source
  ) values (
    v_researcher_id, v_row.object_path, false, '{}',
    'submitted', 'pending', p_confirmation_token_hash,
    v_row.id, v_row.publication_setting, p_object_sha256, p_object_size,
    v_row.processing_decision, 'server'
  )
  returning id, submission_extraction_policy into v_paper_id, v_policy;

  -- Authorship, as declared (unverified; the confirmation step can change
  -- it). An author is first; a co-author's position is left for
  -- confirmation. A depositor is never linked; the names they declared
  -- are, in order, with no contact details.
  if v_row.claimed_role in ('author', 'coauthor') then
    insert into paper_researchers (paper_id, researcher_id, author_order)
    values (v_paper_id, v_researcher_id, case when v_row.claimed_role = 'author' then 1 else null end);
  elsif v_row.claimed_role = 'authorized_depositor' and v_row.declared_authors is not null then
    for v_name in select value from jsonb_array_elements_text(v_row.declared_authors)
    loop
      v_order := v_order + 1;
      insert into researchers (full_name) values (v_name) returning id into v_author_id;
      insert into paper_researchers (paper_id, researcher_id, author_order) values (v_paper_id, v_author_id, v_order);
    end loop;
  end if;

  update submission_acceptances
  set status = 'finalized', finalized_at = now(), paper_id = v_paper_id,
      object_sha256 = p_object_sha256, object_size = p_object_size
  where id = v_row.id;

  return jsonb_build_object('paper_id', v_paper_id, 'already_finalized', false, 'processing_decision', v_policy);
end;
$fn$;

-- ------------------------------------------------------------
-- The confirmation read: no Facebook; LinkedIn with its display choice;
-- which row is the submitter's own; the new-path setting and role.
-- ------------------------------------------------------------
create or replace function get_paper_for_confirmation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_paper record;
  v_researchers jsonb;
  v_extraction jsonb;
  v_role text;
begin
  if p_token is null or length(p_token) = 0 then
    return null;
  end if;

  select * into v_paper
  from papers
  where confirmation_token_hash = encode(digest(p_token, 'sha256'), 'hex')
  limit 1;

  if not found then
    return null;
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'researcher_id', r.id,
      'full_name', r.full_name,
      'linkedin_url', r.linkedin_url,
      'linkedin_public', r.linkedin_public,
      'is_submitter', r.id = v_paper.submitted_by,
      'author_order', pr.author_order
    ) order by pr.author_order nulls last, r.full_name
  ), '[]'::jsonb)
  into v_researchers
  from paper_researchers pr
  join researchers r on r.id = pr.researcher_id
  where pr.paper_id = v_paper.id;

  select ag.result_data into v_extraction
  from ai_generations ag
  where ag.id = v_paper.last_applied_generation_id;

  select claimed_role into v_role from submission_acceptances where id = v_paper.submission_acceptance_id;

  -- Explicit allowlist of fields, not select *.
  return jsonb_build_object(
    'paper_id', v_paper.id,
    'title', v_paper.title,
    'title_ar', v_paper.title_ar,
    'abstract', v_paper.abstract,
    'abstract_ar', v_paper.abstract_ar,
    'supervisor_name', v_paper.supervisor_name,
    'year', v_paper.year,
    'university', v_paper.university,
    'faculty', v_paper.faculty,
    'degree_type', v_paper.degree_type,
    'document_type', v_paper.document_type,
    'failure_code', v_paper.failure_code,
    'publication_scope', v_paper.publication_scope,
    'publication_setting', v_paper.publication_setting,
    'submitter_role', v_role,
    'extraction_status', v_paper.extraction_status,
    'metadata_confirmed_at', v_paper.metadata_confirmed_at,
    'manual_entry_source', v_paper.manual_entry_source,
    'manual_entry_at', v_paper.manual_entry_at,
    'researchers', v_researchers,
    'extraction_detail', v_extraction
  );
end;
$$;

-- ------------------------------------------------------------
-- Confirmation write, as in 0010, except:
--   - facebook_url is ignored entirely;
--   - LinkedIn is stored whatever the publication permission, and must be
--     a linkedin.com profile address;
--   - a researcher row linked to another paper as well is shared: its
--     name, LinkedIn and display choice cannot be changed through this
--     paper's link. Sending it unchanged is fine; a change is refused with
--     an explanation (never silently ignored). Rows exclusive to this
--     paper are edited as before;
--   - linkedin_public can be true only for the submitter's own row, and
--     clearing the link clears it; every row created here starts private.
-- ------------------------------------------------------------
create or replace function confirm_researcher_metadata(
  p_token text,
  p_researchers jsonb,
  p_corrections jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_paper record;
  v_item jsonb;
  v_researcher_id uuid;
  v_order int := 0;
  v_kept_ids uuid[] := '{}';
  v_linkedin text;
  v_public boolean;
  v_exclusive boolean;
  v_existing researchers%rowtype;
begin
  select * into v_paper
  from papers
  where confirmation_token_hash = encode(digest(p_token, 'sha256'), 'hex')
  limit 1;

  if not found then
    raise exception 'Invalid or expired confirmation link.';
  end if;

  if p_researchers is null or jsonb_typeof(p_researchers) <> 'array' or jsonb_array_length(p_researchers) = 0 then
    raise exception 'At least one researcher is required.';
  end if;

  for v_item in select * from jsonb_array_elements(p_researchers)
  loop
    v_order := v_order + 1;

    if v_item->>'full_name' is null or length(trim(v_item->>'full_name')) = 0 then
      raise exception 'Each researcher needs a name.';
    end if;

    v_linkedin := nullif(trim(coalesce(v_item->>'linkedin_url', '')), '');
    if v_linkedin is not null
       and v_linkedin !~* '^https://([a-z]{2,3}\.)?(www\.)?linkedin\.com/in/[^/?#[:space:]]{1,100}/?$' then
      raise exception 'Please enter a LinkedIn profile address, for example https://www.linkedin.com/in/your-name';
    end if;

    if (v_item->>'researcher_id') is not null
       and exists (
         select 1 from paper_researchers
         where paper_id = v_paper.id and researcher_id = (v_item->>'researcher_id')::uuid
       )
    then
      v_researcher_id := (v_item->>'researcher_id')::uuid;
      v_exclusive := not exists (
        select 1 from paper_researchers where researcher_id = v_researcher_id and paper_id <> v_paper.id
      );
      v_public := v_linkedin is not null
                  and v_researcher_id = v_paper.submitted_by
                  and coalesce((v_item->>'linkedin_public')::boolean, false);
      if v_exclusive then
        update researchers set
          full_name = trim(v_item->>'full_name'),
          linkedin_url = v_linkedin,
          linkedin_public = v_public
        where id = v_researcher_id;
      else
        -- Shared with another paper: one paper's link cannot rename a
        -- person or change their profile for every paper they are on. An
        -- unchanged row passes; a change is refused, not silently dropped.
        select * into v_existing from researchers where id = v_researcher_id;
        if trim(v_item->>'full_name') is distinct from v_existing.full_name
           or v_linkedin is distinct from v_existing.linkedin_url
           or (v_researcher_id = v_paper.submitted_by and v_public is distinct from v_existing.linkedin_public) then
          raise exception 'This person is also listed on another submission, so their name and profile can''t be changed here. Please contact us to correct them.';
        end if;
      end if;
    else
      insert into researchers (full_name, linkedin_url, linkedin_public)
      values (trim(v_item->>'full_name'), v_linkedin, false)
      returning id into v_researcher_id;
    end if;

    insert into paper_researchers (paper_id, researcher_id, author_order)
    values (v_paper.id, v_researcher_id, coalesce((v_item->>'author_order')::int, v_order))
    on conflict (paper_id, researcher_id)
    do update set author_order = excluded.author_order;

    v_kept_ids := v_kept_ids || v_researcher_id;
  end loop;

  delete from paper_researchers
  where paper_id = v_paper.id
    and researcher_id <> all(v_kept_ids);

  if p_corrections is not null then
    update papers set
      title = case when p_corrections ? 'title' then nullif(trim(p_corrections->>'title'), '') else title end,
      title_ar = case when p_corrections ? 'title_ar' then nullif(trim(p_corrections->>'title_ar'), '') else title_ar end,
      abstract = case when p_corrections ? 'abstract' then nullif(trim(p_corrections->>'abstract'), '') else abstract end,
      abstract_ar = case when p_corrections ? 'abstract_ar' then nullif(trim(p_corrections->>'abstract_ar'), '') else abstract_ar end,
      supervisor_name = case when p_corrections ? 'supervisor_name' then nullif(trim(p_corrections->>'supervisor_name'), '') else supervisor_name end,
      university = case when p_corrections ? 'university' then nullif(trim(p_corrections->>'university'), '') else university end,
      faculty = case when p_corrections ? 'faculty' then nullif(trim(p_corrections->>'faculty'), '') else faculty end,
      degree_type = case when p_corrections ? 'degree_type' then nullif(trim(p_corrections->>'degree_type'), '') else degree_type end,
      -- An unparseable year KEEPS the existing value (BUG_HISTORY.md #34).
      year = case
               when p_corrections ? 'year' then
                 case when nullif(trim(p_corrections->>'year'), '') is null
                      then null
                      else coalesce(normalize_year_text(p_corrections->>'year'), year) end
               else year
             end
    where id = v_paper.id;
  end if;

  update papers set metadata_confirmed_at = now() where id = v_paper.id;

  return jsonb_build_object('paper_id', v_paper.id, 'confirmed_at', now());
end;
$$;

revoke all on function record_declared_authors(uuid, jsonb) from public, anon, authenticated;
grant execute on function record_declared_authors(uuid, jsonb) to service_role;

-- ============================================================
-- Phase 3 M4 (migration 0015): protected admin review. Fresh installs only;
-- a live database gets supabase/migrations/0015_admin_review.sql instead.
-- Requires Supabase Auth (auth.users). See docs/admin-review.md.
-- ============================================================

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


-- ============================================================
-- Phase 3 M5 (migration 0016): public research pages. Fresh installs only;
-- a live database gets supabase/migrations/0016_public_research.sql instead.
-- ============================================================

-- ------------------------------------------------------------
-- Public identifiers.
-- ------------------------------------------------------------
create table if not exists public_records (
  paper_id uuid primary key references papers(id),
  -- 12 characters from a 31-letter alphabet with no look-alikes (no 0/o,
  -- 1/l/i): about 59 bits, random, not derived from anything private.
  public_id text not null unique check (public_id ~ '^[a-hjkmnp-z2-9]{12}$'),
  created_at timestamptz not null default now()
);
alter table public_records enable row level security;
revoke all on table public_records from anon, authenticated;

create or replace function public_new_id()
returns text
language plpgsql
volatile
set search_path = public, extensions
as $fn$
declare
  v_alpha constant text := 'abcdefghjkmnpqrstuvwxyz23456789';
  v_bytes bytea := gen_random_bytes(12);
  v_out text := '';
  i int;
begin
  for i in 0..11 loop
    v_out := v_out || substr(v_alpha, (get_byte(v_bytes, i) % 31) + 1, 1);
  end loop;
  return v_out;
end;
$fn$;

-- Assigned when a paper is first approved, and kept for good: a later
-- re-approval keeps the same address. Being assigned publishes nothing.
create or replace function public_assign_id()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  n int := 0;
begin
  if exists (select 1 from public_records where paper_id = new.paper_id) then
    return new;
  end if;
  loop
    begin
      insert into public_records (paper_id, public_id) values (new.paper_id, public_new_id());
      return new;
    exception when unique_violation then
      if exists (select 1 from public_records where paper_id = new.paper_id) then
        return new;
      end if;
      n := n + 1;
      if n > 5 then raise; end if;
    end;
  end loop;
end;
$fn$;

drop trigger if exists review_approvals_public_id on review_approvals;
create trigger review_approvals_public_id
  after insert on review_approvals
  for each row execute function public_assign_id();

-- Papers approved before this migration get their identifier now.
insert into public_records (paper_id, public_id)
select distinct a.paper_id, public_new_id()
from review_approvals a
where not exists (select 1 from public_records r where r.paper_id = a.paper_id)
on conflict do nothing;

-- ------------------------------------------------------------
-- Search folding: the 0015 name normalizer (lower case; alef forms, alef
-- maqsura and taa marbuta folded; tatweel, harakat and punctuation removed)
-- plus Arabic-Indic and Persian digits folded to ASCII. Applied to both the
-- query and the text searched; the text shown is never changed.
-- ------------------------------------------------------------
create or replace function public_fold(p text)
returns text
language sql
immutable
set search_path = public
as $fn$
  select normalize_name_text(translate(coalesce(p, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'))
$fn$;

-- ------------------------------------------------------------
-- The public view of one paper: an explicit allowlist. Nothing else in
-- papers, researchers, reviews or acceptances is ever read into it.
-- Internal: called only after eligibility has been established.
-- ------------------------------------------------------------
create or replace function public_record_fields(p_paper uuid, p_public_id text, e jsonb)
returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
  select jsonb_build_object(
    'public_id', p_public_id,
    'title', nullif(btrim(p.title), ''), 'title_ar', nullif(btrim(p.title_ar), ''),
    'abstract', nullif(btrim(p.abstract), ''), 'abstract_ar', nullif(btrim(p.abstract_ar), ''),
    'year', p.year,
    'degree_type', nullif(btrim(p.degree_type), ''),
    'document_type', case when p.document_type in ('thesis', 'article') then p.document_type end,
    'supervisor_name', case when p.document_type = 'thesis' then nullif(btrim(p.supervisor_name), '') end,
    'institution', case when i.id is not null then jsonb_build_object('name_en', i.name_en, 'name_ar', i.name_ar) end,
    -- The verified unit the approval pinned; otherwise the faculty text as
    -- the submitter confirmed it (shown, never matched).
    'unit', case when u.id is not null then jsonb_build_object('name_en', u.name_en, 'name_ar', u.name_ar)
                 when nullif(btrim(p.faculty), '') is not null then jsonb_build_object('text', btrim(p.faculty)) end,
    'authors', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', rr.full_name,
        -- Only a LinkedIn profile its owner chose to show, and only an
        -- https linkedin.com address.
        'linkedin_url', case when rr.linkedin_public and rr.linkedin_url ~* '^https://([a-z]{2,3}\.)?(www\.)?linkedin\.com/' then rr.linkedin_url end)
        order by pr.author_order nulls last, rr.full_name)
      from paper_researchers pr join researchers rr on rr.id = pr.researcher_id
      where pr.paper_id = p.id), '[]'::jsonb),
    'setting', e->>'setting',
    'fulltext', case when (e->>'fulltext_public')::boolean then jsonb_build_object(
        'format', d.file_extension, 'size', d.size_bytes) end,
    'approved_at', (select a.approved_at from review_approvals a where a.id = (e->>'approval_id')::uuid))
  from papers p
  join paper_reviews r on r.paper_id = p.id
  left join institutions i on i.id = r.institution_id
  left join academic_units u on u.id = r.academic_unit_id and u.institution_id = r.institution_id
  left join document_versions d on d.id = (e->>'dissemination_version_id')::uuid
  where p.id = p_paper
$fn$;

-- A research page. NULL for anything not currently public: unknown,
-- private, pending, declined, withdrawn, suspended, embargoed, changed
-- since approval, or from an ineligible institution. The caller answers
-- every NULL the same way.
create or replace function public_record(p_public_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $fn$
declare
  v_paper uuid;
  e jsonb;
begin
  if p_public_id is null or p_public_id !~ '^[a-hjkmnp-z2-9]{12}$' then
    return null;
  end if;
  select paper_id into v_paper from public_records where public_id = p_public_id;
  if not found then
    return null;
  end if;
  e := publication_eligibility(v_paper);
  if not coalesce((e->>'record_public')::boolean, false) then
    return null;
  end if;
  return public_record_fields(v_paper, p_public_id, e);
end;
$fn$;

-- The approved dissemination copy of a public full-text record, or NULL.
-- The path comes from the approval, never from the caller, and only while
-- publication_eligibility says full text is public (which includes the
-- global full-text legal restriction).
create or replace function public_document(p_public_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $fn$
declare
  v_paper uuid;
  e jsonb;
  d document_versions%rowtype;
begin
  if p_public_id is null or p_public_id !~ '^[a-hjkmnp-z2-9]{12}$' then
    return null;
  end if;
  select paper_id into v_paper from public_records where public_id = p_public_id;
  if not found then
    return null;
  end if;
  e := publication_eligibility(v_paper);
  if not coalesce((e->>'fulltext_public')::boolean, false) or e->>'dissemination_version_id' is null then
    return null;
  end if;
  select * into d from document_versions where id = (e->>'dissemination_version_id')::uuid;
  if not found or d.state <> 'approved' or d.kind <> 'dissemination' or d.paper_id <> v_paper then
    return null;
  end if;
  return jsonb_build_object('storage_path', d.storage_path, 'format', d.file_extension, 'size', d.size_bytes,
    'sha256', d.sha256, 'title', coalesce(nullif(btrim((select title from papers where id = v_paper)), ''),
                                          nullif(btrim((select title_ar from papers where id = v_paper)), '')));
end;
$fn$;

-- ------------------------------------------------------------
-- Browse and search. Only currently public records are ever considered,
-- so results, totals, filter options and their counts describe public
-- records only. Bounded: at most 50 per page; deterministic order.
--   filters: q (text), unit (uuid), year (int), degree (text),
--            type ('thesis'|'article'), page (>= 1), limit (1..50)
-- ------------------------------------------------------------
create or replace function public_catalogue(p jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $fn$
declare
  v_q text := public_fold(left(coalesce(p->>'q', ''), 200));
  v_unit uuid;
  v_year int;
  v_degree text := nullif(btrim(left(coalesce(p->>'degree', ''), 100)), '');
  v_type text := nullif(p->>'type', '');
  v_limit int := least(greatest(coalesce((p->>'limit')::int, 20), 1), 50);
  v_page int := greatest(coalesce((p->>'page')::int, 1), 1);
  v_terms text[];
  v_out jsonb;
begin
  begin
    v_unit := nullif(p->>'unit', '')::uuid;
    v_year := nullif(p->>'year', '')::int;
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'invalid_filter');
  end;
  if v_type is not null and v_type not in ('thesis', 'article') then
    return jsonb_build_object('ok', false, 'error', 'invalid_filter');
  end if;
  v_terms := case when v_q is null then '{}'::text[] else (select array_agg(t) from unnest(string_to_array(v_q, ' ')) t where t <> '') end;
  if cardinality(v_terms) > 8 then v_terms := v_terms[1:8]; end if;

  with pub as (
    select pr.public_id, p.id, e
    from public_records pr
    join papers p on p.id = pr.paper_id
    cross join lateral (select publication_eligibility(p.id) as e) el
    where coalesce((e->>'record_public')::boolean, false)
  ), rows as (
    select pub.public_id, pub.e, p.id, p.year, nullif(btrim(p.degree_type), '') as degree,
           case when p.document_type in ('thesis', 'article') then p.document_type end as dtype,
           r.academic_unit_id as unit_id,
           public_fold(concat_ws(' ', p.title, p.title_ar, p.abstract, p.abstract_ar,
             (select string_agg(rr.full_name, ' ') from paper_researchers x join researchers rr on rr.id = x.researcher_id where x.paper_id = p.id))) as hay,
           coalesce(nullif(btrim(p.title), ''), p.title_ar) as sort_title
    from pub join papers p on p.id = pub.id join paper_reviews r on r.paper_id = p.id
  ), matched as (
    -- Every word of the query must appear (after folding).
    select * from rows where coalesce((select bool_and(position(t in hay) > 0) from unnest(v_terms) t), true)
  ), filtered as (
    select * from matched
    where (v_unit is null or unit_id = v_unit) and (v_year is null or year = v_year)
      and (v_degree is null or degree = v_degree) and (v_type is null or dtype = v_type)
  )
  select jsonb_build_object(
    'ok', true,
    'total', (select count(*) from filtered),
    'page', v_page, 'limit', v_limit,
    'items', coalesce((
      select jsonb_agg(public_record_fields(f.id, f.public_id, f.e) - 'abstract' - 'abstract_ar' - 'supervisor_name'
               || jsonb_build_object('snippet', left(coalesce(nullif(btrim(pp.abstract), ''), nullif(btrim(pp.abstract_ar), ''), ''), 280),
                                     'snippet_lang', case when nullif(btrim(pp.abstract), '') is not null then 'en' when nullif(btrim(pp.abstract_ar), '') is not null then 'ar' end)
               order by f.year desc nulls last, f.sort_title, f.public_id)
      from (select * from filtered order by year desc nulls last, sort_title, public_id
            limit v_limit offset (v_page - 1) * v_limit) f
      join papers pp on pp.id = f.id), '[]'::jsonb),
    -- Each facet counts the records matching the query and every OTHER
    -- filter, so a choice never leads to an empty page. Only values that
    -- public records actually have are listed.
    'facets', jsonb_build_object(
      'unit', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'name_en', u.name_en, 'name_ar', u.name_ar, 'count', c.n) order by coalesce(u.name_en, u.name_ar))
                        from (select unit_id, count(*) n from matched
                              where unit_id is not null and (v_year is null or year = v_year) and (v_degree is null or degree = v_degree) and (v_type is null or dtype = v_type)
                              group by unit_id) c join academic_units u on u.id = c.unit_id), '[]'::jsonb),
      'year', coalesce((select jsonb_agg(jsonb_build_object('value', year, 'count', n) order by year desc)
                        from (select year, count(*) n from matched
                              where year is not null and (v_unit is null or unit_id = v_unit) and (v_degree is null or degree = v_degree) and (v_type is null or dtype = v_type)
                              group by year) c), '[]'::jsonb),
      'degree', coalesce((select jsonb_agg(jsonb_build_object('value', degree, 'count', n) order by degree)
                          from (select degree, count(*) n from matched
                                where degree is not null and (v_unit is null or unit_id = v_unit) and (v_year is null or year = v_year) and (v_type is null or dtype = v_type)
                                group by degree) c), '[]'::jsonb),
      'type', coalesce((select jsonb_agg(jsonb_build_object('value', dtype, 'count', n) order by dtype)
                        from (select dtype, count(*) n from matched
                              where dtype is not null and (v_unit is null or unit_id = v_unit) and (v_year is null or year = v_year) and (v_degree is null or degree = v_degree)
                              group by dtype) c), '[]'::jsonb)))
  into v_out;
  return v_out;
end;
$fn$;

-- Sitemap entries: public records only.
create or replace function public_sitemap()
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $fn$
  select coalesce(jsonb_agg(jsonb_build_object('public_id', pr.public_id,
           'lastmod', (select a.approved_at from review_approvals a where a.id = (el.e->>'approval_id')::uuid))
           order by pr.public_id), '[]'::jsonb)
  from public_records pr
  cross join lateral (select publication_eligibility(pr.paper_id) as e) el
  where coalesce((el.e->>'record_public')::boolean, false)
$fn$;

-- For the review screen: the public identifier, only when the record is
-- public right now. Administrators only. Whether the public site is
-- switched on is the application's to say.
create or replace function admin_public_link(p_actor uuid, p_paper uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $fn$
begin
  perform admin_require_role(p_actor, array['administrator']);
  if not coalesce((publication_eligibility(p_paper)->>'record_public')::boolean, false) then
    return jsonb_build_object('public_id', null);
  end if;
  return jsonb_build_object('public_id', (select public_id from public_records where paper_id = p_paper));
end;
$fn$;

-- ------------------------------------------------------------
-- Grants, by name. service_role only.
-- ------------------------------------------------------------
do $grants$
declare
  r record;
  v_api text[] := array['public_record', 'public_catalogue', 'public_document', 'public_sitemap', 'admin_public_link'];
  v_all text[] := v_api || array['public_new_id', 'public_assign_id', 'public_fold', 'public_record_fields'];
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


-- ============================================================
-- Phase 3 M6 (migration 0017): activity counts. Fresh installs only;
-- a live database gets supabase/migrations/0017_activity_metrics.sql instead.
-- ============================================================

create table if not exists activity_counts (
  paper_id uuid not null references papers(id),
  event text not null check (event in ('page_view', 'document_open', 'document_download', 'citation_export')),
  count bigint not null default 0 check (count >= 0),
  updated_at timestamptz not null default now(),
  primary key (paper_id, event)
);
alter table activity_counts enable row level security;
revoke all on table activity_counts from anon, authenticated;

create table if not exists activity_dedup (
  key text primary key check (key ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);
create index if not exists activity_dedup_created on activity_dedup (created_at);
alter table activity_dedup enable row level security;
revoke all on table activity_dedup from anon, authenticated;

-- Record one event. p_client is the server's keyed hash of the client (64
-- hex), never an address. Returns 'counted', 'duplicate' or 'not_eligible'.
-- The increment is a single atomic upsert; the duplicate check is a unique
-- insert, so a retried or concurrent request counts once.
create or replace function public_record_event(p_public_id text, p_event text, p_client text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_paper uuid;
  e jsonb;
  v_key text;
begin
  if p_event not in ('page_view', 'document_open', 'document_download', 'citation_export')
     or coalesce(p_client, '') !~ '^[0-9a-f]{64}$'
     or coalesce(p_public_id, '') !~ '^[a-hjkmnp-z2-9]{12}$' then
    raise exception 'invalid event';
  end if;
  select paper_id into v_paper from public_records where public_id = p_public_id;
  if not found then
    return 'not_eligible';
  end if;
  e := publication_eligibility(v_paper);
  if not coalesce((e->>'record_public')::boolean, false)
     or (p_event in ('document_open', 'document_download') and not coalesce((e->>'fulltext_public')::boolean, false)) then
    return 'not_eligible';
  end if;

  -- Bounded cleanup of expired deduplication keys (at most 200 per call).
  delete from activity_dedup where key in (
    select key from activity_dedup where created_at < now() - interval '2 days' limit 200);

  v_key := encode(digest(p_client || ':' || p_public_id || ':' || p_event || ':' || to_char(now() at time zone 'utc', 'YYYY-MM-DD'), 'sha256'), 'hex');
  insert into activity_dedup (key) values (v_key) on conflict do nothing;
  if not found then
    return 'duplicate';
  end if;
  insert into activity_counts as c (paper_id, event, count) values (v_paper, p_event, 1)
  on conflict (paper_id, event) do update set count = c.count + 1, updated_at = now();
  return 'counted';
end;
$fn$;

-- The counts a public page may show, or NULL when the record is not public.
-- Document counts only while full text is public now: a record that is
-- metadata-only today never appears to offer a document.
create or replace function public_activity(p_public_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $fn$
declare
  v_paper uuid;
  e jsonb;
  v_full boolean;
begin
  if coalesce(p_public_id, '') !~ '^[a-hjkmnp-z2-9]{12}$' then
    return null;
  end if;
  select paper_id into v_paper from public_records where public_id = p_public_id;
  if not found then
    return null;
  end if;
  e := publication_eligibility(v_paper);
  if not coalesce((e->>'record_public')::boolean, false) then
    return null;
  end if;
  v_full := coalesce((e->>'fulltext_public')::boolean, false);
  return jsonb_build_object(
    'page_view', coalesce((select count from activity_counts where paper_id = v_paper and event = 'page_view'), 0),
    'citation_export', coalesce((select count from activity_counts where paper_id = v_paper and event = 'citation_export'), 0),
    'document_open', case when v_full then coalesce((select count from activity_counts where paper_id = v_paper and event = 'document_open'), 0) end,
    'document_download', case when v_full then coalesce((select count from activity_counts where paper_id = v_paper and event = 'document_download'), 0) end);
end;
$fn$;

do $grants$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('public_record_event', 'public_activity')
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $grants$;

