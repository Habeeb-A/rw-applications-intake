# CBT Lab — Applications Intake

A working slice of the applications intake for the Rethink Wellbeing CBT Lab platform: an applicant-facing form, an applicant status view, and a staff review dashboard, with access control enforced in the database rather than in application code.

Next.js 15 (App Router) · TypeScript · Supabase (Postgres + RLS) · Netlify

- **Live app:** `<deployed URL>`
- **Test credentials:** below
- **Synthetic data only.** No real personal information appears anywhere in this repository.

---

## Test credentials

| Role | Email | Password |
|---|---|---|
| Staff | `reviewer.one@cbtlab.test` | *(see `.env.local` / shared separately)* |
| Staff | `reviewer.two@cbtlab.test` | *(same)* |
| Applicant (has a pending application) | `applicant.one@cbtlab.test` | *(shared separately)* |
| Applicant (has a pending application) | `applicant.two@cbtlab.test` | *(same)* |

Sign-in offers both a magic link and email + password. Magic link is the flow a real applicant would use; passwords exist so that these test accounts can be used without access to an inbox.

---

## Setup from scratch

Verified end to end against a brand-new Supabase project.

### 1. Clone and install

```bash
git clone <repo-url> && cd rw-applications-intake
npm install
```

Requires Node 20+.

### 2. Create a Supabase project

Create a new project at [supabase.com](https://supabase.com). **Choose an EU region** (Frankfurt) — the handover doc flags EU data residency as an open compliance question, and a project's region cannot be changed after creation.

### 3. Configure environment

```bash
cp .env.example .env.local
```

Fill in from **Project Settings → API**:

| Variable | Where |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `anon` `public` key |
| `SUPABASE_SERVICE_ROLE_KEY` | `service_role` key — **local only**, never deployed |
| `SEED_STAFF_PASSWORD` / `SEED_APPLICANT_PASSWORD` | any values you choose |

The service-role key carries `BYPASSRLS`. It is used only by `scripts/seed.ts` and `scripts/verify-acceptance.ts`, both of which run on your machine. Do not add it to Netlify.

### 4. Run the migrations

**Option A — Supabase SQL editor.** Paste the contents of each file in `supabase/migrations/` into the SQL editor and run them **in filename order**:

1. `20260830090000_init_schema.sql`
2. `20260830090100_functions_and_triggers.sql`
3. `20260830090200_rls_and_grants.sql`

**Option B — Supabase CLI.**

```bash
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

### 5. Enable email auth

**Authentication → Providers → Email**: enable it, and enable "Confirm email".

**Authentication → URL Configuration**: set Site URL to your deployed URL (or `http://localhost:3000` while developing) and add both of these to Redirect URLs:

```
http://localhost:3000/auth/callback
https://<your-site>.netlify.app/auth/callback
```

A magic link whose redirect target is not on this list fails silently — it lands on the site root with no session and no error, which is a confusing five minutes if you don't know to look here.

### 6. Seed

```bash
npm run seed            # idempotent
npm run seed -- --reset # delete seeded users first, then recreate
```

Creates 2 staff users, 22 applicant users and 22 applications with a realistic spread of countries, time zones, availability and statuses. It then signs in as a staff user and sets several statuses through the normal authenticated path, so the audit trail carries a real reviewer identity — and so that the seed fails loudly if RLS is misconfigured rather than quietly succeeding through a key that bypasses the policies.

### 7. Run

```bash
npm run dev             # http://localhost:3000
```

### 8. Deploy to Netlify

Connect the repo. Netlify detects Next.js and installs its runtime; `netlify.toml` pins the rest. Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` under **Site configuration → Environment variables**, then deploy. Add the deployed `/auth/callback` URL to Supabase's redirect list (step 5).

---

## Verifying it

Two test suites, both runnable in seconds.

```bash
npm run test:db    # 42 access-control assertions against a throwaway local Postgres
npm run verify -- --url https://<your-site>.netlify.app
```

**`npm run test:db`** spins up a local Postgres, applies the real migrations, and asserts every access-control claim in this README — as `anon`, as two different applicants, and as staff. It sets the same `request.jwt.claims` GUC that PostgREST sets from a decoded JWT, so a policy cannot tell the harness from a real HTTP request. No Docker, no network, about two seconds.

**`npm run verify`** checks each numbered acceptance criterion against a live deployment, including raw `fetch` calls to the Supabase REST API with only the anon key — the same request an outsider would make. It never uses the service-role key.

Both exit non-zero on failure.

---

## Schema

Three tables.

**`profiles`** — one row per `auth.users` row, created by an `AFTER INSERT` trigger on `auth.users`. Carries `role` (`applicant` | `staff`), defaulting to `applicant`. There is no code path in the deployed application that grants staff; the role is set out of band with database access. That closes the privilege-escalation surface by construction rather than by a check somewhere in the app.

**`applications`** — owned by an `auth.users` row via `applicant_id`, which is the column every policy pivots on. Unique on `(applicant_id, application_type)`. Enums for `status`, `availability` and `application_type`; `CHECK` constraints on lengths and email shape.

**`application_status_events`** — append-only audit trail, written by `AFTER INSERT`/`AFTER UPDATE` triggers on `applications`. No client role holds an `INSERT`, `UPDATE` or `DELETE` grant on it, so an audit row cannot be forged, edited or removed through the API by anyone, staff included.

### Decisions worth flagging

**Applicant identity is tight, not loose.** An application belongs to an `auth.users` row from the moment it is created. The handover doc calls this out as "a decision, not a detail" — the alternative is batch-importing applications at confirmation, which is looser but creates a reconciliation step forever. I took the tighter option so an application can become an enrolment record without one. Raised with Inga, since it is the one choice here that is expensive to reverse later.

**One application per person per type**, enforced by a unique index. Assumed, not specified — flagged as a question.

**`application_type` exists from day one**, defaulted to `participant`. The pre-programme click-dummy covers facilitator applications too; carrying the discriminator now costs nothing and avoids a migration against live data later.

**`changed_by` references `public.profiles`, not `auth.users`**, even though the two share a primary key. PostgREST derives its embedded-select syntax from foreign keys and cannot see into the `auth` schema, so this is what lets the dashboard fetch "who made this change" in one query instead of a second round trip.

---

## Access control

Two independent layers, both in the database, neither in application code.

**Layer 1 — GRANTs.** Evaluated *before* RLS. `anon` is granted nothing at all on any of the three tables, so an unauthenticated request fails with an explicit permission error and never reaches a policy. `authenticated` gets column-scoped grants: `INSERT` excludes `status`, `id` and the timestamps, so a client physically cannot supply a status and it always takes its `pending` default; `UPDATE` is granted on `status` alone, so even a staff user cannot rewrite an applicant's motivation through the API.

**Layer 2 — RLS policies.** Which rows, of the ones the role may touch.

| Table | Policy |
|---|---|
| `profiles` | read own, or all if staff. No insert/update/delete policy at all. |
| `applications` | read own or all-if-staff; insert only with `applicant_id = auth.uid()` and `status = 'pending'`; update only if staff; no delete. |
| `application_status_events` | read if staff. No write policy — trigger only. |

### Why `is_staff()` is `SECURITY DEFINER`

The policies on `applications` need to read `profiles` to answer "is this caller staff?". But `profiles` has RLS too, so that read evaluates the `profiles` policy, which calls the same function, which reads `profiles` again — Postgres aborts with *infinite recursion detected in policy for relation profiles*. `SECURITY DEFINER` runs the function as its owner, which is not subject to RLS on `profiles`, breaking the cycle.

That is a real privilege escalation, so it is contained: the function takes no arguments (it can only ever describe the caller), returns a single boolean, has `EXECUTE` revoked from `PUBLIC`, and pins `search_path = ''` with every name fully qualified — without which a caller who can create objects could shadow `profiles` and make the function read a table they control.

`auth.uid()` is wrapped as `(select auth.uid())` throughout so Postgres evaluates it once per statement as an InitPlan rather than once per row.

### Why middleware is not the security boundary

`src/middleware.ts` refreshes the session cookie and bounces signed-out visitors to `/login`. That second part is a convenience, not a control. Next.js has a recurring class of middleware-bypass advisories (CVE-2025-29927 and several follow-ups) in which a crafted request skips middleware entirely — and middleware sees a request, not a query, so even a correct one cannot constrain which rows come back.

So every protected page re-checks the user server-side, and RLS constrains the data regardless of what any layer of application code believes. **If `src/middleware.ts` were deleted entirely, no applicant could read another applicant's data and no non-staff user could read the dashboard's data.** They would get uglier empty pages, not a breach. That is the test I used for whether the layering was right.

The role is read from the database on each protected page rather than from a JWT claim, so revoking someone's staff access takes effect on their next request rather than when their token expires.

---

## Netlify notes

The brief asks what went wrong here. Honestly: not much, because the fixable problems were designed around rather than debugged.

- **`publish` is deliberately absent from `netlify.toml`.** With the Next.js runtime, Netlify manages the publish path itself. Setting `publish = ".next"` — which looks right, and is what the existing prototype's static Vite setup needs — produces a deploy that serves the raw build directory and 404s on every route. Silent, and the most common failure of this combination.
- **`NEXT_PUBLIC_*` variables are inlined at build time.** Adding them to Netlify and hitting "redeploy" does not pick them up; it needs a fresh build. `src/lib/env.ts` throws a message naming the missing variable rather than letting it surface as a fetch to `undefined`.
- **Build warning, not an error:** `@supabase/ssr` pulls `@supabase/supabase-js` into the middleware bundle, which touches `process.version`, and Next warns that this is unsupported in the Edge Runtime. Netlify runs middleware as an edge function; the guarded access is fine there and the combination is widely deployed. Left as-is rather than papered over, and noted here so it isn't a surprise in your build log.
- **Dependencies are pinned exactly**, not to caret ranges, so a fresh clone in three weeks builds what was reviewed.
- **`npm audit` reports zero vulnerabilities.** It did not initially: the current Next 15.5.4 carried a critical RCE advisory and a middleware-bypass class, patched by moving to 15.5.24, plus a `postcss` path-traversal advisory resolved with an override. Worth doing on a health-adjacent product rather than shipping a red audit.

---

## What I would do differently with more time

**Roughly in the order I would actually pick them up.**

1. **Move the role into the JWT via a custom access token hook.** Reading `profiles` on every protected page is one indexed lookup, which is right at this scale and wrong at cohort scale. Supabase's `custom_access_token_hook` puts the role in the token, and `is_staff()` becomes a claim read with no table access — which also removes the `SECURITY DEFINER` function entirely. The trade is revocation latency, so it needs a short token lifetime and a deliberate answer on how staff access is revoked mid-session.

2. **Integration tests against a real Supabase instance in CI.** `db-tests/` proves the policies against real Postgres, but it stands in for Supabase's auth schema rather than using it. `supabase start` in GitHub Actions would close that gap, plus a Playwright pass over the three journeys.

3. **Pagination and filtering on the dashboard.** It currently loads every application. Fine for 22, wrong at 500. Keyset pagination on `(created_at, id)`, a status filter, and a search on name/email — the indexes for the first two are already there.

4. **Rate limiting on submission.** Nothing stops an authenticated user hammering the Server Action. The unique index caps the damage at one row per person, but the write attempts are unbounded.

5. **Structured logging and error tracking.** `console.error` is not an incident process. For a service the role description describes as carrying crisis flags, "must never fail silently" needs Sentry or equivalent, plus alerting on failed writes specifically.

6. **A real time-zone control.** The form ships a curated list of 16. `Intl.supportedValuesOf('timeZone')` gives the full IANA set, which needs a combobox rather than a select.

7. **Accessibility audit.** Labels, focus rings, `aria-invalid` and error association are in place and it is keyboard-navigable, but it has not been through a screen reader or checked against a WCAG level — which the handover doc lists as an open question anyway.

**What I deliberately cut,** to keep this at the scoped size: applicants cannot edit or withdraw an application after submitting (the copy says to email instead); there is no email notification on a status change; there is no staff view of a single application, only the table; and there is no admin UI for granting the staff role, which is intentional rather than missing.

---

## Repository layout

```
supabase/migrations/     schema, functions and triggers, RLS and grants
db-tests/                access-control test suite + local Postgres harness
scripts/seed.ts          synthetic data
scripts/verify-acceptance.ts   the seven acceptance criteria, executable
src/app/                 routes: login, apply, application, dashboard
src/lib/auth.ts          server-side session and role resolution
src/lib/supabase/        browser, server and middleware clients
```
