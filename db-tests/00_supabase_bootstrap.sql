-- =============================================================================
-- db-tests/00_supabase_bootstrap.sql
--
-- Recreates just enough of a Supabase project to run the migrations and the
-- access-control tests against a plain local Postgres, with no Docker and no
-- network. This file is NOT applied to Supabase — Supabase provides all of it
-- already. It exists so the RLS policies can be tested as a normal part of
-- development rather than by clicking around a deployed app.
--
-- What it reproduces:
--   * the `auth` schema and the subset of auth.users the app touches
--   * auth.uid(), reading the same request.jwt.claims GUC that PostgREST sets
--   * the anon / authenticated / service_role roles, with the same
--     BYPASSRLS setting service_role has in a real project
--   * Supabase's default privileges on the public schema, so that the REVOKEs
--     in the RLS migration are exercised against the defaults they exist to undo
-- =============================================================================

create extension if not exists pgcrypto with schema public;

create schema if not exists auth;

-- ---------------------------------------------------------------------------
-- Client roles, matching a real project.
-- NOLOGIN: PostgREST connects as `authenticator` and SET ROLEs into these.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    -- BYPASSRLS is what makes the service key dangerous and why it never
    -- reaches the browser.
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth  to anon, authenticated, service_role;

-- Supabase grants broadly by default on new objects in `public`. Reproducing
-- that here is the point: it is exactly what the migration's REVOKE statements
-- have to undo, so the tests prove the revokes do their job.
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- auth.users — only the columns this application depends on.
-- ---------------------------------------------------------------------------
create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text unique,
  encrypted_password text,
  email_confirmed_at timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- auth.uid() — identical in behaviour to the Supabase original.
--
-- PostgREST decodes the JWT and sets `request.jwt.claims` as a GUC for the
-- duration of the request. The tests below set the same GUC with `set local`,
-- so a policy cannot tell the difference between the test harness and a real
-- authenticated HTTP request. That is what makes these tests meaningful rather
-- than decorative.
-- ---------------------------------------------------------------------------
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ),
    ''
  )::uuid
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )
$$;

grant execute on function auth.uid()  to anon, authenticated, service_role;
grant execute on function auth.role() to anon, authenticated, service_role;
grant select on auth.users to service_role;
