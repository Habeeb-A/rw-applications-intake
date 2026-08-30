-- =============================================================================
-- 20260830090100_functions_and_triggers.sql
--
-- Three jobs:
--   1. public.is_staff()      -- the authorisation predicate used by policies
--   2. profile provisioning   -- every auth.users row gets a profile
--   3. audit + updated_at     -- status history written by the database itself
-- =============================================================================

-- ---------------------------------------------------------------------------
-- public.is_staff()
--
-- Why SECURITY DEFINER, and why this matters:
--
-- The policies on `applications` need to ask "is the caller staff?", which
-- means reading `profiles`. But `profiles` has RLS enabled too. If this lookup
-- ran as the caller, reading `profiles` would evaluate the `profiles` policy,
-- which itself calls this function, which reads `profiles` again — Postgres
-- aborts with "infinite recursion detected in policy for relation profiles".
--
-- SECURITY DEFINER makes the function execute as its owner, which is not
-- subject to RLS on `profiles`, breaking the cycle. That is a real privilege
-- escalation, so it is contained deliberately:
--
--   * the function takes no arguments, so a caller cannot aim it at another
--     user; it can only ever answer a question about the caller themselves
--   * it returns a single boolean, so it is not a data-exfiltration path
--   * `set search_path = ''` pins name resolution at definition time. Without
--     it, a caller who can create objects in a schema earlier on their own
--     search_path could shadow `profiles` and make this function read a table
--     they control — a well-known SECURITY DEFINER attack. Every name below is
--     therefore fully qualified.
--   * EXECUTE is revoked from PUBLIC and granted only to `authenticated`
--
-- STABLE (not VOLATILE) lets the planner call it once per statement rather
-- than once per row.
--
-- `(select auth.uid())` rather than a bare `auth.uid()` is deliberate: wrapping
-- it in a subquery lets Postgres evaluate it once as an InitPlan instead of
-- re-evaluating per row. On a table scan of the dashboard this is the
-- difference between one call and one call per application.
-- ---------------------------------------------------------------------------

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'staff'::public.app_role
  );
$$;

revoke all on function public.is_staff() from public;
grant execute on function public.is_staff() to authenticated;

comment on function public.is_staff() is
  'True when the calling user has the staff role. SECURITY DEFINER to avoid RLS recursion on profiles; takes no arguments so it can only describe the caller.';

-- ---------------------------------------------------------------------------
-- Profile provisioning
--
-- Runs on every new auth.users row, whichever way the user arrived: magic
-- link, password sign-up, or the admin API used by the seed script. Doing this
-- in the database rather than in a callback in the app means there is no code
-- path that creates a user without a profile, and therefore no user who is
-- authenticated but has no role.
--
-- Note what is NOT here: nothing reads a role from the incoming metadata.
-- Sign-up cannot make you staff.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

comment on function public.handle_new_user() is
  'Creates a public.profiles row for every new auth.users row, always with the default applicant role.';

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- updated_at maintenance
--
-- In a BEFORE trigger so the value is written as part of the same row version;
-- an AFTER trigger would need a second UPDATE.
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger applications_set_updated_at
  before update on public.applications
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Audit trail
--
-- AFTER triggers, so an event is recorded only for a change that actually
-- committed. SECURITY DEFINER because `authenticated` has no INSERT grant on
-- the audit table — that is the point: the only writer is the database.
--
-- Splitting insert and update into two triggers keeps each one's WHEN clause
-- simple, and lets the update trigger fire only on an actual status
-- transition rather than on every UPDATE.
-- ---------------------------------------------------------------------------

create or replace function public.log_application_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.application_status_events
    (application_id, old_status, new_status, changed_by)
  values
    (new.id, null, new.status, (select auth.uid()));
  return null;  -- return value is ignored for AFTER ... FOR EACH ROW
end;
$$;

create or replace function public.log_application_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.application_status_events
    (application_id, old_status, new_status, changed_by)
  values
    (new.id, old.status, new.status, (select auth.uid()));
  return null;
end;
$$;

revoke all on function public.log_application_created() from public;
revoke all on function public.log_application_status_change() from public;

create trigger applications_log_created
  after insert on public.applications
  for each row
  execute function public.log_application_created();

create trigger applications_log_status_change
  after update on public.applications
  for each row
  when (old.status is distinct from new.status)
  execute function public.log_application_status_change();
