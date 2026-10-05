-- Minimal stand-ins for what every Supabase project already provides,
-- so schema.sql can be loaded into a plain, disposable local Postgres
-- for migration testing. NEVER run this against a Supabase project.
-- Roles are cluster-wide, so they may survive from an earlier run.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;
create schema extensions;
create extension pgcrypto schema extensions;
create schema storage;
create table storage.buckets (
  id text primary key, name text, public boolean,
  file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text, name text, metadata jsonb,
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
grant usage on schema public, extensions to anon;

-- Supabase Auth's user table, only as far as the review migration reads it
-- (Phase 3 M4). Real projects have the full auth schema; on the real local
-- stack (supabase/tests/local-stack) this is not used.
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  email_confirmed_at timestamptz
);
create or replace function auth.uid() returns uuid language sql stable
  as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
