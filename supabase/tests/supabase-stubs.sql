-- Minimal stand-ins for what every Supabase project already provides,
-- so schema.sql can be loaded into a plain, disposable local Postgres
-- for migration testing. NEVER run this against a Supabase project.
-- Roles are cluster-wide, so they may survive from an earlier run.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
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
