-- =============================================================================
-- 20260830090000_init_schema.sql
-- Core schema for the applications intake slice.
--
-- Design notes (expanded in README.md):
--   * `profiles` mirrors auth.users and is the single source of truth for
--     authorisation. Role lives in the database, never in the client.
--   * `applications` is owned by an auth.users row from the moment it is
--     created, so an application can later become an enrolment record without
--     a reconciliation step (see handover doc, "Decide the identity question
--     early").
--   * `application_status_events` is an append-only audit trail written by a
--     trigger, not by application code, so it cannot be bypassed by any client
--     that can update the row.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Enumerated types
--
-- Enums rather than text + CHECK: the set of valid values is enforced by the
-- type system, is visible in the generated TypeScript types, and an invalid
-- value is rejected by Postgres before any policy is evaluated.
-- ---------------------------------------------------------------------------

create type public.app_role as enum (
  'applicant',
  'staff'
);

create type public.application_status as enum (
  'pending',
  'accepted',
  'rejected',
  'waitlisted'
);

create type public.availability_option as enum (
  'weekday_evenings',
  'weekends',
  'flexible'
);

-- The pre-programme click-dummy covers participant *and* facilitator
-- applications. Carrying the discriminator from day one costs nothing now and
-- avoids a migration against live data later.
create type public.application_type as enum (
  'participant',
  'facilitator'
);

-- ---------------------------------------------------------------------------
-- profiles
--
-- One row per authenticated user, created by an AFTER INSERT trigger on
-- auth.users (see the functions migration). `role` defaults to 'applicant':
-- there is no code path anywhere in this application that grants staff. A
-- staff role is set deliberately, out of band, by someone with database
-- access. That is the whole privilege-escalation surface, and it is closed by
-- construction rather than by a check somewhere in the app.
-- ---------------------------------------------------------------------------

create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text not null,
  role       public.app_role not null default 'applicant',
  created_at timestamptz not null default now()
);

comment on table public.profiles is
  'Application-level user record. Mirrors auth.users; carries the authorisation role.';
comment on column public.profiles.role is
  'Authorisation role. Never set from client code; staff is granted out of band.';

-- ---------------------------------------------------------------------------
-- applications
-- ---------------------------------------------------------------------------

create table public.applications (
  id               uuid primary key default gen_random_uuid(),

  -- The owning user. This column is what every row-level policy pivots on, so
  -- it is NOT NULL and foreign-keyed: an orphan application is unreachable by
  -- its owner and would be invisible to the access-control model.
  applicant_id     uuid not null references auth.users (id) on delete cascade,

  application_type public.application_type not null default 'participant',

  -- Form fields from the brief.
  full_name        text not null,
  email            text not null,
  country          text not null,
  time_zone        text not null,
  motivation       text not null,
  availability     public.availability_option not null,

  status           public.application_status not null default 'pending',

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- Validation is duplicated here and in the client (zod). The client copy is
  -- for the user experience; this copy is the one that is actually load-bearing,
  -- because a request can reach PostgREST without ever passing through our UI.
  constraint applications_full_name_length
    check (char_length(trim(full_name)) between 1 and 120),
  constraint applications_email_shape
    check (email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint applications_country_length
    check (char_length(trim(country)) between 1 and 80),
  constraint applications_time_zone_length
    check (char_length(trim(time_zone)) between 1 and 64),
  constraint applications_motivation_length
    check (char_length(trim(motivation)) between 20 and 4000)
);

comment on table public.applications is
  'One application per user per application_type. Synthetic data only.';

-- One application per person per type. Assumed rather than specified; called
-- out in the README and raised with the client. Enforced in the database so it
-- holds for direct API writes too, not only for submissions through the form.
create unique index applications_one_per_applicant_per_type
  on public.applications (applicant_id, application_type);

-- Supports the row-level policy `applicant_id = auth.uid()`, which is
-- evaluated against every candidate row on every applicant read.
create index applications_applicant_id_idx
  on public.applications (applicant_id);

-- Supports the staff dashboard's default ordering and status filter.
create index applications_status_created_at_idx
  on public.applications (status, created_at desc);

-- ---------------------------------------------------------------------------
-- application_status_events  (the stretch goal: who changed what, and when)
--
-- Append-only. There is no UPDATE or DELETE policy and no UPDATE or DELETE
-- grant on this table for any client role, so an audit row cannot be edited or
-- removed through the API by anyone, staff included.
-- ---------------------------------------------------------------------------

create table public.application_status_events (
  id             bigint generated always as identity primary key,
  application_id uuid not null references public.applications (id) on delete cascade,
  old_status     public.application_status,          -- null on creation
  new_status     public.application_status not null,
  -- References public.profiles rather than auth.users, even though the two
  -- share a primary key. PostgREST derives its join syntax from foreign keys,
  -- and it cannot see across into the auth schema — so pointing at profiles is
  -- what lets the dashboard fetch "who made this change" as a single embedded
  -- select instead of a second round trip and a manual stitch in JS.
  changed_by     uuid references public.profiles (id) on delete set null,
  changed_at     timestamptz not null default now()
);

comment on table public.application_status_events is
  'Append-only audit trail. Written only by trigger; no client role may INSERT, UPDATE or DELETE.';
comment on column public.application_status_events.changed_by is
  'auth.uid() of the actor. Null when written by a service-role or SQL seed context, which has no end user.';

create index application_status_events_application_id_idx
  on public.application_status_events (application_id, changed_at desc);
