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
  created_at timestamptz not null default now()
);

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
