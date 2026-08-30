/**
 * Seed a Supabase project with synthetic test data.
 *
 *   npm run seed          create users and applications (idempotent)
 *   npm run seed -- --reset   delete existing seed users first, then recreate
 *
 * Synthetic data only. Every name, address and motivation below is invented;
 * all accounts use the reserved-for-testing `.test` TLD, which cannot resolve
 * and cannot collide with a real person's address.
 *
 * ---------------------------------------------------------------------------
 * Why this is TypeScript and not a .sql file
 *
 * Seeding users means creating rows in `auth.users` and `auth.identities`.
 * Those are GoTrue's tables, and hand-writing inserts into them — with a
 * bcrypt hash, the right identity_data shape, the right null-vs-empty-string
 * conventions for the token columns — is a well-known way to produce accounts
 * that look fine in the dashboard and then fail to authenticate. The exact
 * shape has also changed across GoTrue versions.
 *
 * `auth.admin.createUser()` is the supported interface to the same thing, and
 * it is stable across those versions. The brief asks that the seed run cleanly
 * on a *fresh* Supabase project; this is the version of the script most likely
 * to do that on whatever Supabase ships next month.
 *
 * ---------------------------------------------------------------------------
 * Why the statuses are set by signing in as staff
 *
 * The service-role key could set them directly. Instead, the script signs in as
 * a seeded staff user and changes statuses through the ordinary authenticated
 * path. Two reasons: the seeded audit trail then carries a real reviewer
 * identity rather than a null, and the seed doubles as a smoke test — if RLS is
 * misconfigured, seeding fails rather than quietly succeeding via a key that
 * bypasses the policies being tested.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";

import type { AvailabilityOption, Database } from "../src/lib/database.types";

type DbClient = SupabaseClient<Database, "public">;

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SEED_EMAIL_DOMAIN = "cbtlab.test";
const RESET = process.argv.includes("--reset");

/**
 * Read and validate configuration up front.
 *
 * A TypeScript `asserts` function can only narrow a parameter, not a
 * module-level const, so this returns a validated object instead. The practical
 * benefit is the same: after this call the values are `string`, not
 * `string | undefined`, and nothing downstream needs a non-null assertion.
 */
function readConfig() {
  const entries = {
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };

  const missing = Object.entries({
    NEXT_PUBLIC_SUPABASE_URL: entries.supabaseUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: entries.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: entries.serviceRoleKey,
  })
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0) {
    console.error(
      `\nMissing environment variable(s): ${missing.join(", ")}\n` +
        `Copy .env.example to .env.local and fill in the values from\n` +
        `Supabase -> Project Settings -> API.\n`,
    );
    process.exit(1);
  }

  return {
    supabaseUrl: entries.supabaseUrl as string,
    anonKey: entries.anonKey as string,
    serviceRoleKey: entries.serviceRoleKey as string,
    staffPassword: process.env.SEED_STAFF_PASSWORD ?? "staff-trial-password",
    applicantPassword: process.env.SEED_APPLICANT_PASSWORD ?? "applicant-trial-password",
  };
}

type SeedConfig = ReturnType<typeof readConfig>;

// ---------------------------------------------------------------------------
// Synthetic data
// ---------------------------------------------------------------------------

interface SeedApplicant {
  handle: string;
  fullName: string;
  country: string;
  timeZone: string;
  availability: AvailabilityOption;
  motivation: string;
  /** Status a reviewer will set after seeding. Undefined leaves it pending. */
  reviewedAs?: "accepted" | "rejected" | "waitlisted";
}

const STAFF: { handle: string; label: string }[] = [
  { handle: "reviewer.one", label: "Reviewer One" },
  { handle: "reviewer.two", label: "Reviewer Two" },
];

/**
 * 22 applicants. Countries and time zones are weighted towards the regions the
 * role description names (Africa, Asia, Europe) so the dashboard shows a
 * realistic spread rather than twenty identical rows.
 */
const APPLICANTS: SeedApplicant[] = [
  { handle: "applicant.one", fullName: "Amara Nwosu", country: "Nigeria", timeZone: "Africa/Lagos", availability: "weekday_evenings",
    motivation: "I have been reading about CBT for a while and want to practise the tools with other people rather than on my own. Evenings after work suit me best." },
  { handle: "applicant.two", fullName: "Tomas Berger", country: "Germany", timeZone: "Europe/Berlin", availability: "weekends",
    motivation: "A friend went through a similar group last year and found it useful. I would like structure and some accountability for the habits I keep dropping." },
  { handle: "chidi.okafor", fullName: "Chidi Okafor", country: "Nigeria", timeZone: "Africa/Lagos", availability: "flexible",
    motivation: "Work has been overwhelming for months and I want practical tools rather than more reading. A small group sounds less intimidating than one-to-one therapy.", reviewedAs: "accepted" },
  { handle: "priya.raman", fullName: "Priya Raman", country: "India", timeZone: "Asia/Kolkata", availability: "weekday_evenings",
    motivation: "I am interested in the third-wave approaches specifically, and in having a facilitator who keeps the group on track week to week.", reviewedAs: "accepted" },
  { handle: "lena.kowalski", fullName: "Lena Kowalski", country: "Poland", timeZone: "Europe/Warsaw", availability: "weekends",
    motivation: "I have tried self-guided workbooks twice and stopped both times around week three. I think the group is the part I have been missing.", reviewedAs: "waitlisted" },
  { handle: "marcus.hale", fullName: "Marcus Hale", country: "United Kingdom", timeZone: "Europe/London", availability: "flexible",
    motivation: "Recently changed careers and want to build better habits around rumination before it becomes a bigger problem. Flexible on timing." },
  { handle: "sofia.marino", fullName: "Sofia Marino", country: "Spain", timeZone: "Europe/Madrid", availability: "weekday_evenings",
    motivation: "Looking for something evidence-based and affordable. I liked that the programme publishes its outcome data rather than just testimonials.", reviewedAs: "accepted" },
  { handle: "kwame.mensah", fullName: "Kwame Mensah", country: "Ghana", timeZone: "Africa/Accra", availability: "weekends",
    motivation: "Weekend mornings are the only reliable time I have. I want to work on procrastination and the guilt cycle that follows it." },
  { handle: "yuki.tanaka", fullName: "Yuki Tanaka", country: "Japan", timeZone: "Asia/Tokyo", availability: "flexible",
    motivation: "I have done individual therapy before and want to try a peer group next. Curious whether the format works as well as the research suggests.", reviewedAs: "rejected" },
  { handle: "fatima.zahra", fullName: "Fatima Zahra", country: "Morocco", timeZone: "Africa/Casablanca", availability: "weekday_evenings",
    motivation: "Studying and working at the same time and finding it hard to switch off. I would like tools I can actually use during a busy week." },
  { handle: "daniel.osei", fullName: "Daniel Osei", country: "Kenya", timeZone: "Africa/Nairobi", availability: "weekends",
    motivation: "Interested in the behavioural activation part especially. I know what I should be doing and consistently do not do it.", reviewedAs: "waitlisted" },
  { handle: "anna.svensson", fullName: "Anna Svensson", country: "Sweden", timeZone: "Europe/Stockholm", availability: "flexible",
    motivation: "I want to understand my own thought patterns better and have a structured way to challenge them rather than arguing with myself in circles." },
  { handle: "rahul.mehta", fullName: "Rahul Mehta", country: "India", timeZone: "Asia/Kolkata", availability: "weekday_evenings",
    motivation: "The cost was the main barrier for me with regular therapy. A peer group at this price makes it something I can actually commit to.", reviewedAs: "accepted" },
  { handle: "grace.mwangi", fullName: "Grace Mwangi", country: "Kenya", timeZone: "Africa/Nairobi", availability: "weekends",
    motivation: "I facilitate a small reading group already and am curious about the facilitator side too, but I would like to go through it as a participant first." },
  { handle: "pieter.devries", fullName: "Pieter de Vries", country: "Netherlands", timeZone: "Europe/Amsterdam", availability: "flexible",
    motivation: "Straightforward reason: I procrastinate badly and it is affecting my work. I want a structured programme with other people expecting me to show up." },
  { handle: "maria.santos", fullName: "Maria Santos", country: "Brazil", timeZone: "America/Sao_Paulo", availability: "weekday_evenings",
    motivation: "Evenings work best given the time difference. I am hoping to build a home-practice routine that survives past the first fortnight.", reviewedAs: "waitlisted" },
  { handle: "ahmed.hassan", fullName: "Ahmed Hassan", country: "Egypt", timeZone: "Africa/Cairo", availability: "weekends",
    motivation: "I read the CBT playbook excerpt and found it clearer than most things I have tried. I would like to work through it properly with support." },
  { handle: "clara.dubois", fullName: "Clara Dubois", country: "France", timeZone: "Europe/Paris", availability: "flexible",
    motivation: "Between jobs at the moment, which means I have the time now and would rather use it on something structured than let it drift.", reviewedAs: "rejected" },
  { handle: "james.okonkwo", fullName: "James Okonkwo", country: "Nigeria", timeZone: "Africa/Lagos", availability: "weekday_evenings",
    motivation: "I want to get better at noticing the thought before the mood, rather than only working it out afterwards. That is the specific skill I am after." },
  { handle: "isabel.cruz", fullName: "Isabel Cruz", country: "Philippines", timeZone: "Asia/Manila", availability: "weekends",
    motivation: "Weekends are the only time that works with my shift pattern. Interested in the group format and in meeting people working on similar things.", reviewedAs: "accepted" },
  { handle: "noah.fischer", fullName: "Noah Fischer", country: "Austria", timeZone: "Europe/Vienna", availability: "flexible",
    motivation: "A colleague recommended the programme. I want something with a defined end point rather than open-ended, and twelve weeks feels right." },
  { handle: "leila.rahimi", fullName: "Leila Rahimi", country: "Canada", timeZone: "America/Toronto", availability: "weekday_evenings",
    motivation: "I have a long commute and evenings are when I am actually at home and able to focus. Looking for tools for anxiety around work deadlines." },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const emailFor = (handle: string) => `${handle}@${SEED_EMAIL_DOMAIN}`;

function log(step: string, detail = "") {
  console.log(`  ${step.padEnd(46)}${detail}`);
}

async function deleteSeedUsers(admin: DbClient) {
  let removed = 0;
  // listUsers is paginated; a fresh project will have one short page, but a
  // project seeded a few times will not.
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    if (data.users.length === 0) break;

    for (const user of data.users) {
      if (user.email?.endsWith(`@${SEED_EMAIL_DOMAIN}`)) {
        // Cascades: profiles.id and applications.applicant_id both reference
        // auth.users with ON DELETE CASCADE, and status events cascade from
        // applications. One delete, no orphans.
        const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
        if (deleteError) throw deleteError;
        removed += 1;
      }
    }
    if (data.users.length < 200) break;
  }
  return removed;
}

async function ensureUser(
  admin: DbClient,
  email: string,
  password: string,
): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // no inbox to click through during seeding
  });

  if (!error && data.user) return data.user.id;

  // Already exists (re-run without --reset): find and reuse the id.
  if (error && /already/i.test(error.message)) {
    for (let page = 1; page <= 20; page += 1) {
      const { data: list, error: listError } = await admin.auth.admin.listUsers({
        page,
        perPage: 200,
      });
      if (listError) throw listError;
      const found = list.users.find((u) => u.email === email);
      if (found) return found.id;
      if (list.users.length < 200) break;
    }
  }

  throw error ?? new Error(`Could not create or find user ${email}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const config: SeedConfig = readConfig();

  console.log("\nSeeding Supabase project");
  console.log(`  ${config.supabaseUrl}\n`);

  const admin: DbClient = createClient<Database>(
    config.supabaseUrl,
    config.serviceRoleKey,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  if (RESET) {
    const removed = await deleteSeedUsers(admin);
    log("removed existing seed users", String(removed));
  }

  // --- staff ---------------------------------------------------------------
  const staffIds: string[] = [];
  for (const member of STAFF) {
    const id = await ensureUser(admin, emailFor(member.handle), config.staffPassword);
    staffIds.push(id);
  }

  // The only place in this repository that grants the staff role, and it runs
  // with the service-role key on a developer's machine. There is no code path
  // in the deployed application that can do this.
  const { error: promoteError } = await admin
    .from("profiles")
    .update({ role: "staff" })
    .in("id", staffIds);
  if (promoteError) throw promoteError;
  log("staff users created and promoted", String(staffIds.length));

  // --- applicants ----------------------------------------------------------
  const applicantIds = new Map<string, string>();
  for (const applicant of APPLICANTS) {
    const id = await ensureUser(admin, emailFor(applicant.handle), config.applicantPassword);
    applicantIds.set(applicant.handle, id);
  }
  log("applicant users created", String(applicantIds.size));

  // --- applications --------------------------------------------------------
  // Inserted with the service-role key, which bypasses RLS. That is correct
  // here: seeding is an administrative act with no end user attached, and
  // signing in as 22 separate applicants to insert 22 rows would be slow
  // theatre. The *review* step below is the one worth doing authentically.
  const rows = APPLICANTS.map((applicant) => ({
    applicant_id: applicantIds.get(applicant.handle)!,
    full_name: applicant.fullName,
    email: emailFor(applicant.handle),
    country: applicant.country,
    time_zone: applicant.timeZone,
    motivation: applicant.motivation,
    availability: applicant.availability,
  }));

  const { error: insertError } = await admin
    .from("applications")
    .upsert(rows, { onConflict: "applicant_id,application_type" });
  if (insertError) throw insertError;
  log("applications inserted", String(rows.length));

  // --- reviews, performed as a real staff user -----------------------------
  const reviewer: DbClient = createClient<Database>(
    config.supabaseUrl,
    config.anonKey,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { error: signInError } = await reviewer.auth.signInWithPassword({
    email: emailFor(STAFF[0]!.handle),
    password: config.staffPassword,
  });
  if (signInError) {
    throw new Error(
      `Could not sign in as the seeded staff user: ${signInError.message}\n` +
        `If this says "Email logins are disabled", enable Email provider under ` +
        `Authentication → Providers in the Supabase dashboard.`,
    );
  }

  let reviewed = 0;
  for (const applicant of APPLICANTS) {
    if (!applicant.reviewedAs) continue;

    const { data, error } = await reviewer
      .from("applications")
      .update({ status: applicant.reviewedAs })
      .eq("applicant_id", applicantIds.get(applicant.handle)!)
      .select("id");

    if (error) throw error;

    // Zero rows here would mean the staff UPDATE policy is not working — worth
    // failing loudly on, because the seed is the first thing that would notice.
    if (!data || data.length === 0) {
      throw new Error(
        `Staff update affected no rows for ${applicant.handle}. ` +
          `The applications UPDATE policy is not granting staff access.`,
      );
    }
    reviewed += 1;
  }
  await reviewer.auth.signOut();
  log("applications reviewed by staff", String(reviewed));

  // --- summary -------------------------------------------------------------
  const { count } = await admin
    .from("applications")
    .select("*", { count: "exact", head: true });

  console.log("\nDone.\n");
  console.log("Test credentials");
  for (const member of STAFF) {
    console.log(`  staff      ${emailFor(member.handle).padEnd(30)} ${config.staffPassword}`);
  }
  for (const applicant of APPLICANTS.slice(0, 2)) {
    console.log(`  applicant  ${emailFor(applicant.handle).padEnd(30)} ${config.applicantPassword}`);
  }
  console.log(`\n  ${count ?? rows.length} applications in the database.\n`);
}

main().catch((error) => {
  console.error("\nSeed failed:\n", error);
  process.exit(1);
});
