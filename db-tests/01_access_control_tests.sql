-- =============================================================================
-- db-tests/01_access_control_tests.sql
--
-- Executable proof of the access-control claims in the README, run against a
-- real Postgres with the real migrations applied.
--
-- Each test switches to the same Postgres role PostgREST would switch to
-- (`anon` or `authenticated`) and sets the same `request.jwt.claims` GUC that
-- PostgREST sets from a decoded JWT. From a policy's point of view there is no
-- difference between this harness and an HTTP request, which is why these tests
-- are evidence rather than decoration.
--
-- Run:  ./db-tests/run.sh
-- =============================================================================

create schema if not exists test;

create table if not exists test.results (
  seq         bigint generated always as identity primary key,
  passed      boolean not null,
  description text not null,
  detail      text
);

truncate test.results restart identity;

-- The harness tables are not part of the application; granting write access to
-- `authenticated` here is safe and never reaches a real project.
grant usage on schema test to anon, authenticated;
grant insert on test.results to anon, authenticated;
grant usage, select on all sequences in schema test to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Assertion helpers. SECURITY INVOKER on purpose: the statement under test
-- must execute with the privileges of the role being tested.
-- ---------------------------------------------------------------------------

create or replace function test.ok(condition boolean, description text)
returns void language plpgsql as $$
begin
  insert into test.results (passed, description) values (coalesce(condition, false), description);
end $$;

-- Asserts the statement fails with insufficient_privilege (SQLSTATE 42501),
-- i.e. blocked by the GRANT layer before any policy is consulted.
create or replace function test.denied_by_grant(stmt text, description text)
returns void language plpgsql as $$
begin
  execute stmt;
  insert into test.results (passed, description, detail)
  values (false, description, 'statement succeeded; expected permission denied');
exception
  when insufficient_privilege then
    insert into test.results (passed, description) values (true, description);
  when others then
    insert into test.results (passed, description, detail)
    values (false, description, 'wrong error ' || sqlstate || ': ' || sqlerrm);
end $$;

-- Asserts the statement fails for any reason (used where either the grant
-- layer or a policy may legitimately be the one to stop it).
create or replace function test.throws(stmt text, description text)
returns void language plpgsql as $$
begin
  execute stmt;
  insert into test.results (passed, description, detail)
  values (false, description, 'statement succeeded; expected an error');
exception when others then
  insert into test.results (passed, description, detail) values (true, description, sqlstate);
end $$;

create or replace function test.succeeds(stmt text, description text)
returns void language plpgsql as $$
begin
  execute stmt;
  insert into test.results (passed, description) values (true, description);
exception when others then
  insert into test.results (passed, description, detail)
  values (false, description, sqlstate || ': ' || sqlerrm);
end $$;

grant execute on all functions in schema test to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Fixtures. Created as the owner, which bypasses RLS — the same position the
-- seed script and migrations occupy.
-- ---------------------------------------------------------------------------

\set staff_a  '''11111111-1111-1111-1111-111111111111'''
\set staff_b  '''22222222-2222-2222-2222-222222222222'''
\set appl_a   '''aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'''
\set appl_b   '''bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'''

delete from auth.users where email like '%@test.invalid';

insert into auth.users (id, email, email_confirmed_at) values
  (:staff_a::uuid, 'staff.a@test.invalid',     now()),
  (:staff_b::uuid, 'staff.b@test.invalid',     now()),
  (:appl_a::uuid,  'applicant.a@test.invalid', now()),
  (:appl_b::uuid,  'applicant.b@test.invalid', now());

-- The trigger created the profiles; promote two of them out of band, which is
-- the only way staff is ever granted.
update public.profiles set role = 'staff' where id in (:staff_a::uuid, :staff_b::uuid);

insert into public.applications
  (id, applicant_id, full_name, email, country, time_zone, motivation, availability)
values
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', :appl_a::uuid,
   'Applicant A', 'applicant.a@test.invalid', 'Nigeria', 'Africa/Lagos',
   'Synthetic motivation text for applicant A, long enough to satisfy the check constraint.',
   'weekday_evenings'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', :appl_b::uuid,
   'Applicant B', 'applicant.b@test.invalid', 'Germany', 'Europe/Berlin',
   'Synthetic motivation text for applicant B, long enough to satisfy the check constraint.',
   'weekends');

-- Assertion helpers return void; their result rows are noise. Output is
-- redirected until the summary at the end.
\o /dev/null

\echo '=== Group 1: profile provisioning and role defaults ==================='

select test.ok(
  (select count(*) from public.profiles where id in (:appl_a::uuid, :appl_b::uuid, :staff_a::uuid, :staff_b::uuid)) = 4,
  'every auth.users row got a profile via trigger');

select test.ok(
  (select role from public.profiles where id = :appl_a::uuid) = 'applicant',
  'a new user defaults to the applicant role, never staff');

\echo ''
\echo '=== Group 2: unauthenticated access  [acceptance criterion 3] ========='

begin;
  set local role anon;

  select test.denied_by_grant('select * from public.applications',
    'anon cannot SELECT applications (blocked at the grant layer)');
  select test.denied_by_grant('select * from public.profiles',
    'anon cannot SELECT profiles');
  select test.denied_by_grant('select * from public.application_status_events',
    'anon cannot SELECT the audit trail');
  select test.denied_by_grant(
    'insert into public.applications (applicant_id, full_name, email, country, time_zone, motivation, availability) '
    || 'values (''' || :appl_a || '''::uuid, ''X'', ''x@test.invalid'', ''NG'', ''Africa/Lagos'', ''' || repeat('a', 40) || ''', ''flexible'')',
    'anon cannot INSERT an application');
  select test.denied_by_grant('update public.applications set status = ''accepted''',
    'anon cannot UPDATE any application status');
  select test.denied_by_grant('delete from public.applications',
    'anon cannot DELETE applications');
commit;

\echo ''
\echo '=== Group 3: applicant isolation  [acceptance criterion 4] ============'

begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';

  select test.ok(
    (select count(*) from public.applications) = 1,
    'applicant A sees exactly one application (their own), not both');

  select test.ok(
    (select applicant_id from public.applications) = :appl_a::uuid,
    'the row applicant A sees is their own');

  select test.ok(
    (select count(*) from public.applications where applicant_id = :appl_b::uuid) = 0,
    'applicant A cannot read applicant B''s application even when naming it directly');

  select test.ok(
    (select status from public.applications) = 'pending',
    'applicant A can read their own status');

  -- Not an error: RLS filters the target set, so the UPDATE matches zero rows.
  -- The assertion is therefore about effect, not about an exception.
  update public.applications set status = 'accepted' where applicant_id = :appl_a::uuid;
  select test.ok(
    (select status from public.applications where applicant_id = :appl_a::uuid) = 'pending',
    'applicant A cannot accept their own application (update affects zero rows)');

  select test.throws(
    'update public.applications set full_name = ''Tampered'' where applicant_id = ''' || :appl_a || '''::uuid',
    'applicant A cannot UPDATE a non-status column (no column grant)');

  select test.ok(
    (select count(*) from public.profiles) = 1,
    'applicant A sees only their own profile');

  select test.throws(
    'update public.profiles set role = ''staff'' where id = ''' || :appl_a || '''::uuid',
    'applicant A cannot promote themselves to staff');

  -- Note the asymmetry with the anon case above. `authenticated` HAS a SELECT
  -- grant on this table, so an applicant is stopped by the policy rather than
  -- by the grant layer: the read succeeds and returns nothing. Empty is the
  -- correct outcome — no row of another person's review history is visible —
  -- but it is an empty set, not an error, so that is what we assert.
  select test.ok(
    (select count(*) from public.application_status_events) = 0,
    'applicant A reads zero rows from the audit trail');

  -- Planting a row in another user's account, the way a direct REST call would.
  select test.throws(
    'insert into public.applications (applicant_id, full_name, email, country, time_zone, motivation, availability) '
    || 'values (''' || :appl_b || '''::uuid, ''Planted'', ''p@test.invalid'', ''NG'', ''Africa/Lagos'', ''' || repeat('a', 40) || ''', ''flexible'')',
    'applicant A cannot INSERT an application owned by applicant B');
commit;

\echo ''
\echo '=== Group 4: applicant self-submission  [acceptance criterion 1] ======'

-- A third applicant with no existing application, to test the submit path.
insert into auth.users (id, email, email_confirmed_at)
values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'applicant.c@test.invalid', now());

begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","role":"authenticated"}';

  select test.succeeds(
    'insert into public.applications (applicant_id, full_name, email, country, time_zone, motivation, availability) '
    || 'values (''cccccccc-cccc-4ccc-8ccc-cccccccccccc''::uuid, ''Applicant C'', ''applicant.c@test.invalid'', '
    || '''Kenya'', ''Africa/Nairobi'', ''' || repeat('a', 40) || ''', ''flexible'')',
    'an applicant can submit their own application');

  select test.ok(
    (select status from public.applications where applicant_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid) = 'pending',
    'a newly submitted application has status pending');

  -- The column grant excludes `status`, so supplying it fails outright.
  select test.throws(
    'insert into public.applications (applicant_id, full_name, email, country, time_zone, motivation, availability, status) '
    || 'values (''cccccccc-cccc-4ccc-8ccc-cccccccccccc''::uuid, ''Cheat'', ''c2@test.invalid'', '
    || '''Kenya'', ''Africa/Nairobi'', ''' || repeat('a', 40) || ''', ''flexible'', ''accepted'')',
    'an applicant cannot submit an application pre-set to accepted');
commit;

\echo ''
\echo '=== Group 5: staff review  [acceptance criteria 1, 2] ================='

-- Ground truth, captured as the owner (not subject to RLS) so the staff
-- assertions below compare against reality rather than a hardcoded number that
-- drifts whenever an earlier group commits another fixture row.
drop table if exists test.facts;
create table test.facts as
  select count(*)::int                                        as total_applications,
         count(*) filter (where status = 'pending')::int       as pending_applications,
         count(distinct applicant_id)::int                     as distinct_applicants
  from public.applications;
grant select on test.facts to authenticated;

begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

  select test.ok(
    (select count(*) from public.applications)
      = (select total_applications from test.facts),
    'staff sees every application in the table, not a filtered subset');

  select test.ok(
    (select count(distinct applicant_id) from public.applications) > 1
      and (select count(distinct applicant_id) from public.applications)
        = (select distinct_applicants from test.facts),
    'staff sees applications from more than one applicant');

  select test.ok(
    (select count(*) from public.applications where status = 'pending')
      = (select pending_applications from test.facts),
    'every submitted application appears to staff with status pending');

  select test.succeeds(
    'update public.applications set status = ''waitlisted'' where id = ''dddddddd-dddd-4ddd-8ddd-dddddddddddd''',
    'staff can change an application status');

  select test.ok(
    (select status from public.applications where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd') = 'waitlisted',
    'the status change is visible immediately');

  select test.throws(
    'update public.applications set motivation = ''Rewritten by staff'' where id = ''dddddddd-dddd-4ddd-8ddd-dddddddddddd''',
    'staff cannot rewrite an applicant''s answers, only the status');

  select test.throws(
    'delete from public.applications where id = ''dddddddd-dddd-4ddd-8ddd-dddddddddddd''',
    'staff cannot delete an application through the API');
commit;

-- Persisted across the transaction boundary, which is the "survives a reload"
-- half of criterion 2.
select test.ok(
  (select status from public.applications where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd') = 'waitlisted',
  'the status change persisted after the transaction committed');

\echo ''
\echo '=== Group 6: audit trail  [stretch goal] ============================='

begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

  select test.ok(
    (select count(*) from public.application_status_events
      where application_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd') = 2,
    'audit trail holds both the creation event and the status change');

  select test.ok(
    (select changed_by from public.application_status_events
      where application_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
        and new_status = 'waitlisted') = :staff_a::uuid,
    'the audit trail records which staff user made the change');

  select test.ok(
    (select old_status from public.application_status_events
      where application_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
        and new_status = 'waitlisted') = 'pending',
    'the audit trail records the status it changed from');

  select test.throws(
    'insert into public.application_status_events (application_id, new_status) '
    || 'values (''dddddddd-dddd-4ddd-8ddd-dddddddddddd'', ''accepted'')',
    'staff cannot forge an audit event');

  select test.throws(
    'update public.application_status_events set new_status = ''rejected''',
    'staff cannot rewrite an audit event');

  select test.throws(
    'delete from public.application_status_events',
    'staff cannot delete an audit event');
commit;

\echo ''
\echo '=== Group 7: constraints and data integrity =========================='

select test.throws(
  'insert into public.applications (applicant_id, full_name, email, country, time_zone, motivation, availability) '
  || 'values (''' || :appl_a || '''::uuid, ''Duplicate'', ''dup@test.invalid'', ''NG'', ''Africa/Lagos'', ''' || repeat('a', 40) || ''', ''flexible'')',
  'a second participant application from the same user is rejected');

select test.throws(
  'insert into public.applications (applicant_id, full_name, email, country, time_zone, motivation, availability) '
  || 'values (''' || :appl_a || '''::uuid, ''Bad Email'', ''not-an-email'', ''NG'', ''Africa/Lagos'', ''' || repeat('a', 40) || ''', ''flexible'')',
  'a malformed email is rejected by a check constraint');

select test.throws(
  'insert into public.applications (applicant_id, full_name, email, country, time_zone, motivation, availability) '
  || 'values (''' || :appl_a || '''::uuid, ''Short'', ''s@test.invalid'', ''NG'', ''Africa/Lagos'', ''too short'', ''flexible'')',
  'a motivation under 20 characters is rejected by a check constraint');

select test.throws(
  'insert into public.applications (applicant_id, full_name, email, country, time_zone, motivation, availability) '
  || 'values (''99999999-9999-4999-8999-999999999999''::uuid, ''Ghost'', ''g@test.invalid'', ''NG'', ''Africa/Lagos'', ''' || repeat('a', 40) || ''', ''flexible'')',
  'an application referencing a non-existent user is rejected by the foreign key');

select test.throws(
  'select 1 from public.applications where availability = ''mondays''::public.availability_option',
  'an availability value outside the enum is rejected by the type system');

\echo ''
\echo '=== Group 8: RLS is actually switched on ============================='

select test.ok(
  (select bool_and(rowsecurity) from pg_tables
    where schemaname = 'public'
      and tablename in ('profiles', 'applications', 'application_status_events')),
  'RLS is enabled on all three tables');

select test.ok(
  (select count(*) from information_schema.role_table_grants
    where grantee = 'anon' and table_schema = 'public') = 0,
  'the anon role holds no grant of any kind in the public schema');

\o

\echo ''
\echo '=== Results =========================================================='

select
  case when passed then '  PASS' else '* FAIL' end as result,
  description,
  coalesce(detail, '') as detail
from test.results
order by seq;

\echo ''
select
  count(*) filter (where passed)       as passed,
  count(*) filter (where not passed)   as failed,
  count(*)                             as total
from test.results;

-- Non-zero exit when anything failed, so this is usable in CI.
-- A DO block rather than a `select 1/0` guard: Postgres constant-folds the
-- division at plan time, so the guard fired even when nothing had failed.
do $$
declare failed_count int;
begin
  select count(*) into failed_count from test.results where not passed;
  if failed_count > 0 then
    raise exception '% access-control test(s) failed', failed_count;
  end if;
  raise notice 'ALL ACCESS-CONTROL TESTS PASSED';
end $$;
