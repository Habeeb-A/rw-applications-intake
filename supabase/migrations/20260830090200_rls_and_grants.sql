-- =============================================================================
-- 20260830090200_rls_and_grants.sql
--
-- Access control is enforced in two independent layers. Both are in the
-- database; neither is in application code.
--
--   Layer 1 — GRANTs (table and column level)
--     Answers "may this Postgres role touch this table, and which columns?"
--     Evaluated before RLS. A role with no grant gets `permission denied for
--     table ...` and never reaches a policy at all.
--
--   Layer 2 — Row Level Security policies
--     Answers "which rows, of the ones this role may touch?"
--
-- The distinction matters for acceptance criterion 3. With RLS alone, an
-- unauthenticated read returns HTTP 200 and an empty array: correct, but
-- indistinguishable from "there is no data". By additionally revoking every
-- grant from `anon`, the same request fails closed with an explicit
-- permission error. Two mechanisms, either one sufficient, and the failure is
-- loud rather than silent.
--
-- Roles in play:
--   anon           unauthenticated caller holding the public anon key
--   authenticated  caller with a valid user JWT
--   service_role   backend key; has BYPASSRLS, never exposed to the browser
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Enable RLS
--
-- A table with RLS enabled and no policy denies everything. That is the
-- intended default: every access below is opened deliberately.
--
-- FORCE ROW LEVEL SECURITY is deliberately NOT used. It would subject the
-- table owner to policies as well, which breaks migrations, the seed script
-- and any service-role maintenance task — none of which act on behalf of an
-- end user and none of which are reachable from the browser.
-- ---------------------------------------------------------------------------

alter table public.profiles                  enable row level security;
alter table public.applications              enable row level security;
alter table public.application_status_events enable row level security;

-- ---------------------------------------------------------------------------
-- Layer 1: grants
--
-- Start from nothing. Supabase's default privileges grant broadly to `anon`
-- and `authenticated` on new objects in `public`, so revoking first is not
-- ceremony — it is undoing a default that would otherwise leave these tables
-- readable by the anon key.
-- ---------------------------------------------------------------------------

revoke all on public.profiles                  from anon, authenticated;
revoke all on public.applications              from anon, authenticated;
revoke all on public.application_status_events from anon, authenticated;

-- `anon` is granted nothing at all, on any of the three tables. An
-- unauthenticated request therefore fails at the grant layer, before RLS.

-- profiles: an authenticated user may read (rows are then narrowed by policy).
-- No INSERT: profiles are created by trigger.
-- No UPDATE: this is what stops a user promoting themselves to staff. There is
-- no column-level grant on `role` for any client role, so the privilege
-- escalation is not merely unpolicied, it is ungranted.
grant select on public.profiles to authenticated;

-- applications:
--   SELECT — narrowed to own rows, or everything for staff, by policy.
--   INSERT — column-scoped. `status`, `id`, `created_at` and `updated_at` are
--            absent from this list, so a client physically cannot supply them;
--            `status` therefore always takes its 'pending' default. This is
--            what makes criterion 1 true by construction rather than by
--            convention.
--   UPDATE — column-scoped to `status` alone. Even a staff user cannot rewrite
--            an applicant's motivation or email through the API. Row-level
--            policy then restricts *who* may perform that update.
grant select on public.applications to authenticated;
grant insert (applicant_id, application_type, full_name, email, country,
              time_zone, motivation, availability)
  on public.applications to authenticated;
grant update (status) on public.applications to authenticated;

-- No DELETE grant to any client role: applications are not deletable through
-- the API. Withdrawal, if it becomes a real requirement, belongs in the status
-- enum, not in a DELETE.

-- audit trail: readable by staff (narrowed by policy below), never writable by
-- a client. The only writer is the SECURITY DEFINER trigger.
grant select on public.application_status_events to authenticated;

-- ---------------------------------------------------------------------------
-- Layer 2: policies on profiles
-- ---------------------------------------------------------------------------

-- A user may read their own profile; staff may read all of them (the dashboard
-- shows reviewer identity on the audit trail).
create policy "profiles: read own or staff reads all"
  on public.profiles
  for select
  to authenticated
  using (
    id = (select auth.uid())
    or public.is_staff()
  );

-- No INSERT, UPDATE or DELETE policy on profiles, by design.

-- ---------------------------------------------------------------------------
-- Layer 2: policies on applications
-- ---------------------------------------------------------------------------

-- Criterion 4, read half: an applicant sees exactly their own row.
-- Criterion 3: `auth.uid()` is null for an unauthenticated caller, so the
-- predicate is false even if the grant layer were removed.
create policy "applications: applicant reads own, staff reads all"
  on public.applications
  for select
  to authenticated
  using (
    applicant_id = (select auth.uid())
    or public.is_staff()
  );

-- An applicant may create an application, and only for themselves. Without the
-- WITH CHECK, an authenticated user could POST directly to the REST API with
-- someone else's applicant_id and plant a row in another person's account.
--
-- The `status` clause is redundant while `status` is absent from the INSERT
-- grant above. It is kept so that widening the grant later cannot silently
-- open a path to self-accepting.
create policy "applications: applicant creates own, always pending"
  on public.applications
  for insert
  to authenticated
  with check (
    applicant_id = (select auth.uid())
    and status = 'pending'::public.application_status
  );

-- Criterion 2: staff, and only staff, may change status.
--
-- USING decides which existing rows may be targeted; WITH CHECK validates the
-- row after the update. Both are required: USING alone would let a staff user
-- target any row (correct here), while WITH CHECK alone would leave the set of
-- targetable rows unrestricted. An applicant matches neither, so an applicant's
-- attempt to update affects zero rows.
create policy "applications: staff updates status"
  on public.applications
  for update
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- No DELETE policy.

-- ---------------------------------------------------------------------------
-- Layer 2: policies on application_status_events
--
-- Staff-only. The audit trail records who reviewed whom; it is internal
-- reviewer data, not applicant-facing. An applicant sees their current status
-- on their own page, which is what the brief asks for.
-- ---------------------------------------------------------------------------

create policy "status events: staff read"
  on public.application_status_events
  for select
  to authenticated
  using (public.is_staff());

-- No INSERT, UPDATE or DELETE policy: append-only, trigger-written.
