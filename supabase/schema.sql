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
