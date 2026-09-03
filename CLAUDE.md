# CLAUDE.md — context for any Claude Code session in this repo

Read this before changing anything. Several things in this codebase look like
mistakes and are load-bearing. Removing them silently breaks the thing the
project is being assessed on.

---

## What this is

A trial task for a paid role at **Rethink Wellbeing**, a non-profit running
peer-facilitated group CBT programmes. It is a small but real slice of their CBT
Lab platform: the applications intake.

It is **not** a generic CRUD app. It is an access-control exercise wearing a
CRUD app's clothes. The reviewers have said they will test the Supabase REST API
directly, not just click through the UI.

After submission there is a **~60-minute walkthrough call** in which the author
must explain every decision and implement a live change request. So:

- **Legibility beats cleverness.** A comment explaining *why* is worth more than
  a smaller diff.
- **Do not introduce anything the author cannot explain.** No new abstractions,
  no new dependencies, no patterns that need a paragraph of framework lore.

Stack: Next.js 15 (App Router) · TypeScript · Supabase (Postgres + RLS) · Netlify.
Synthetic data only — no real personal information anywhere, ever.

---

## The seven acceptance criteria (the actual spec)

These are the ground truth. Any change must leave all seven true.

1. A submission made through the form appears in the staff dashboard with status
   `pending`.
2. A staff user can change any application's status, and the change persists
   after reload.
3. An unauthenticated request cannot read any application data, **including
   directly via the Supabase API**.
4. A logged-in applicant can read their own application and its status, but no
   other applicant's data; no non-staff user can access the dashboard or its
   data.
5. Starting from a fresh Supabase project, the migrations and seed script run
   cleanly by following the README alone.
6. The app is deployed and reachable at a public URL.
7. In the walkthrough call, the author can explain the schema and RLS decisions
   and implement a small change request live.

Note the ratio: two are about features, four are about access control, one is
about whether the author understands their own system.

---

## Invariants — never change these without being asked explicitly

If a task seems to require breaking one of these, stop and say so instead.

1. **`anon` holds no grant on any table in `public`.** Not a narrowed grant. No
   grant. This is what makes an unauthenticated request fail with a permission
   error rather than a silent empty array. Criterion 3.
2. **`status` is not in the INSERT grant on `applications`.** A client must be
   physically unable to supply it, so it always takes its `pending` default.
   Criterion 1 is true by construction, not by convention.
3. **`UPDATE` on `applications` is granted on the `status` column only.** Not
   table-wide. Staff must not be able to rewrite an applicant's answers.
4. **No `DELETE` grant on any table, for any client role.**
5. **`application_status_events` is append-only and trigger-written.** No client
   role gets INSERT, UPDATE or DELETE on it.
6. **No code path in the deployed app sets `profiles.role`.** Staff is granted
   out of band with database access. There is no admin UI for it and there must
   not be one.
7. **The service-role key never reaches the browser, Netlify, or any file under
   `src/`.** It carries `BYPASSRLS`. Only `scripts/` may import it.
8. **`getUser()`, never `getSession()`,** on any path that decides access.
   `getSession()` trusts the cookie; `getUser()` verifies it.
9. **Middleware is not the security boundary.** The test: *deleting
   `src/middleware.ts` entirely must not make any data reachable.* It refreshes
   the session and redirects signed-out visitors; that is all. Motivated by the
   recurring Next.js middleware-bypass CVE class (CVE-2025-29927 and follow-ups).

---

## Looks wrong, is deliberate — do not "fix" these

| Thing | Why it is like that |
|---|---|
| `is_staff()` is `SECURITY DEFINER` | The `applications` policies must read `profiles`, which has RLS, whose policy calls `is_staff()` → Postgres aborts with *infinite recursion detected in policy for relation profiles*. `SECURITY DEFINER` breaks the cycle. It is contained: no arguments, boolean return, `EXECUTE` revoked from `PUBLIC`, `search_path = ''`. |
| `set search_path = ''` and fully-qualified names inside functions | Without it, a caller who can create objects could shadow `profiles` and make the function read a table they control. The verbose `public.profiles` is the containment, not clutter. |
| `(select auth.uid())` rather than `auth.uid()` | Wrapping it lets Postgres evaluate it once as an InitPlan instead of once per row. Do not "simplify" it. |
| `status = 'pending'` in the INSERT policy's `WITH CHECK` | Redundant *today*, because `status` is not in the grant. It exists so that widening the grant later cannot silently open a path to self-accepting. |
| `FORCE ROW LEVEL SECURITY` is absent | It would subject the table owner to policies, breaking migrations, the seed script and service-role maintenance — none of which act for an end user or are reachable from a browser. |
| `.select()` after `.update()` in `dashboard/actions.ts` | Without it, an update blocked by RLS and a successful one are **both** a 204 with no error. Asking for affected rows back is the only way to tell them apart. |
| The same validation in three places (HTML, zod, CHECK constraints) | HTML is usability. Zod covers anything reaching the Server Action. Only the CHECK constraints cover a request that skips the app entirely. None is redundant. |
| `changed_by` references `public.profiles`, not `auth.users` | PostgREST derives embedded selects from foreign keys and cannot see into the `auth` schema. This is what makes `actor:profiles(email)` resolve in one query. |
| Error messages that don't distinguish "no such row" from "not allowed" | Telling a caller a row exists but they may not touch it confirms a record they have no right to know about. |
| Identical login message whether or not the account exists | Otherwise the form enumerates who has applied to a mental-health programme. |
| Plain CSS, no Tailwind | The brief warns Netlify/Next deployment is fiddly; a build-time CSS pipeline is one more thing that can fail a deploy. |
| System font stack, no `next/font` | `next/font/google` fetches at **build** time, making every deploy fail-able for a reason unrelated to this code. |
| Exact version pins, no caret ranges | A fresh clone weeks later must build what was reviewed. |
| `next` pinned to 15.5.24 and a `postcss` override | 15.5.4 shipped a **critical RCE** and a middleware-bypass advisory; postcss had a path-traversal advisory. `npm audit` must stay at zero. |

---

## How to verify any change

Run all four. They are fast. A change is not done until they pass.

```bash
npm run test:db      # 42 access-control assertions vs a real local Postgres (~2s)
npx tsc --noEmit     # types
npm run build        # production build
npm audit            # must report 0 vulnerabilities
```

And against a live deployment:

```bash
npm run verify -- --url https://<the-site>.netlify.app
```

`npm run test:db` is the important one. It sets the same `request.jwt.claims`
setting PostgREST sets from a decoded JWT and switches to the same Postgres
roles, so a policy cannot tell it from a real HTTP request. **If you touch
anything in `supabase/migrations/`, run it before and after.**

Note: a blocked RLS read is **not** an error — it returns an empty set. A
blocked UPDATE reports success and changes zero rows. Never conclude a policy
works because nothing threw.

---

## House rules

- **No new dependencies** without saying why in the same message. Every one is
  build risk on a deploy target the brief already calls fiddly.
- **Never edit a migration that has already run** on a real project. Add a new
  timestamped one.
- **Do not reformat files you are not otherwise changing.** Noise in the diff
  costs review time and hides the real change.
- **Small, single-purpose commits**, with a message saying *why*, not what.
- **Do not delete comments** explaining a decision. They are the walkthrough
  script.
- If something looks wrong but is in the table above, leave it and say so.
- If you are unsure whether a change is in scope, ask before making it. The
  scope is the seven criteria plus the audit-trail stretch goal — nothing else.

---

## Repo map

```
supabase/migrations/   the database — 4 of the 7 criteria live here
db-tests/              42 assertions + a local Postgres harness (no Docker)
src/lib/               types, env, validation, auth, three Supabase clients
src/middleware.ts      session refresh — NOT the security boundary
src/app/               login, apply, application, dashboard, auth routes
scripts/seed.ts        22 applications, 2 staff, synthetic, via the admin API
scripts/verify-acceptance.ts   the 7 criteria, executable
README.md              the one-page deliverable for the reviewers
```
