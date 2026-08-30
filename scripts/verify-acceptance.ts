/**
 * Checks each acceptance criterion from the brief, the way the brief says they
 * will be checked — including hitting the Supabase REST API directly rather
 * than only driving the UI.
 *
 *   npm run verify                      against the deployed URL in .env.local
 *   npm run verify -- --url https://…   against a specific deployment
 *
 * This exists because "we will check each of these explicitly, including
 * testing the API" is a specification, and a specification that can be executed
 * should be. Every assertion below maps to a numbered criterion, and the
 * failures are the interesting output: a criterion that cannot fail here is one
 * that is not really being tested.
 *
 * Note that this script never uses the service-role key. It only holds what an
 * attacker would hold — the public anon key — plus ordinary user credentials.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";

import type { Database } from "../src/lib/database.types";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

type DbClient = SupabaseClient<Database, "public">;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

function arg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SITE_URL = arg("--url") ?? process.env.DEPLOYED_URL;

const STAFF_EMAIL = process.env.VERIFY_STAFF_EMAIL ?? "reviewer.one@cbtlab.test";
const STAFF_PASSWORD = process.env.SEED_STAFF_PASSWORD ?? "staff-trial-password";
const APPLICANT_EMAIL = process.env.VERIFY_APPLICANT_EMAIL ?? "applicant.one@cbtlab.test";
const APPLICANT_PASSWORD = process.env.SEED_APPLICANT_PASSWORD ?? "applicant-trial-password";
const OTHER_APPLICANT_EMAIL = process.env.VERIFY_OTHER_APPLICANT_EMAIL ?? "applicant.two@cbtlab.test";

if (!SUPABASE_URL || !ANON_KEY) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Tiny assertion harness
// ---------------------------------------------------------------------------

interface Check {
  criterion: string;
  description: string;
  passed: boolean;
  detail?: string;
}

const checks: Check[] = [];

function record(criterion: string, description: string, passed: boolean, detail?: string) {
  checks.push({ criterion, description, passed, detail });
  const mark = passed ? "  PASS" : "* FAIL";
  console.log(`${mark}  [${criterion}] ${description}${detail ? `  — ${detail}` : ""}`);
}

async function signIn(email: string, password: string): Promise<DbClient> {
  const client = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Could not sign in as ${email}: ${error.message}`);
  return client;
}

// ---------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------

async function main() {
  console.log(`\nVerifying against ${SUPABASE_URL}`);
  if (SITE_URL) console.log(`Deployed app: ${SITE_URL}`);
  console.log("");

  // =========================================================================
  // Criterion 3 — an unauthenticated request cannot read any application data,
  // including directly via the Supabase API.
  //
  // Done with raw fetch, not the client library, so there is no chance of a
  // helper quietly attaching a session. This is the exact request an outsider
  // holding only the public anon key would make.
  // =========================================================================

  for (const table of ["applications", "profiles", "application_status_events"]) {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*`, {
      headers: { apikey: ANON_KEY!, Authorization: `Bearer ${ANON_KEY}` },
    });
    const body = await response.text();

    // Two acceptable outcomes: an explicit permission error (what this schema
    // produces, because anon holds no grant), or an empty array (what RLS alone
    // would produce). Anything containing a row is a failure.
    const isPermissionError = response.status === 401 || response.status === 403;
    const isEmptyArray = response.status === 200 && body.trim() === "[]";

    record(
      "3",
      `anon REST read of ${table} returns no data`,
      isPermissionError || isEmptyArray,
      `HTTP ${response.status} ${body.slice(0, 90)}`,
    );
  }

  // An unauthenticated write attempt.
  const anonInsert = await fetch(`${SUPABASE_URL}/rest/v1/applications`, {
    method: "POST",
    headers: {
      apikey: ANON_KEY!,
      Authorization: `Bearer ${ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      applicant_id: "00000000-0000-4000-8000-000000000000",
      full_name: "Anonymous Intruder",
      email: "intruder@example.test",
      country: "Nowhere",
      time_zone: "UTC",
      motivation: "This insert should be rejected before it reaches a policy.",
      availability: "flexible",
    }),
  });
  record("3", "anon REST insert into applications is rejected", anonInsert.status >= 400,
    `HTTP ${anonInsert.status}`);

  // =========================================================================
  // Criterion 4 — a logged-in applicant reads their own application and status,
  // but no other applicant's data; no non-staff user can access the dashboard
  // or its data.
  // =========================================================================

  const applicant = await signIn(APPLICANT_EMAIL, APPLICANT_PASSWORD);
  const { data: applicantUser } = await applicant.auth.getUser();
  const applicantId = applicantUser.user?.id;

  const { data: ownRows, error: ownError } = await applicant
    .from("applications")
    .select("id, applicant_id, status");

  record("4", "applicant can read their own application",
    !ownError && (ownRows?.length ?? 0) === 1,
    ownError ? ownError.message : `${ownRows?.length ?? 0} row(s)`);

  record("4", "applicant sees only rows they own",
    (ownRows ?? []).every((row) => row.applicant_id === applicantId),
    "checked applicant_id on every returned row");

  record("4", "applicant can read their own status",
    typeof ownRows?.[0]?.status === "string", ownRows?.[0]?.status);

  // Ask for another applicant's row by name. RLS should filter it out.
  const other = await signIn(OTHER_APPLICANT_EMAIL, APPLICANT_PASSWORD);
  const { data: otherUser } = await other.auth.getUser();
  const otherId = otherUser.user?.id;
  await other.auth.signOut();

  const { data: crossRead } = await applicant
    .from("applications")
    .select("id")
    .eq("applicant_id", otherId!);

  record("4", "applicant cannot read another applicant's application",
    (crossRead?.length ?? 0) === 0, `${crossRead?.length ?? 0} row(s) returned`);

  // The dashboard's data, requested as a non-staff user.
  const { data: applicantDashboardRead } = await applicant.from("applications").select("id");
  record("4", "non-staff user cannot read the dashboard's dataset",
    (applicantDashboardRead?.length ?? 0) <= 1,
    `${applicantDashboardRead?.length ?? 0} row(s) visible to an applicant`);

  const { data: applicantAudit } = await applicant
    .from("application_status_events")
    .select("id");
  record("4", "non-staff user cannot read the audit trail",
    (applicantAudit?.length ?? 0) === 0, `${applicantAudit?.length ?? 0} row(s)`);

  // Privilege escalation attempts.
  const { data: selfPromote } = await applicant
    .from("profiles")
    .update({ role: "staff" })
    .eq("id", applicantId!)
    .select("id");
  record("4", "applicant cannot promote themselves to staff",
    (selfPromote?.length ?? 0) === 0, "profiles UPDATE affected no rows");

  const { data: selfAccept } = await applicant
    .from("applications")
    .update({ status: "accepted" })
    .eq("applicant_id", applicantId!)
    .select("id, status");
  record("4", "applicant cannot accept their own application",
    (selfAccept?.length ?? 0) === 0, "applications UPDATE affected no rows");

  // =========================================================================
  // Criteria 1 and 2 — a submission appears to staff as pending; staff can
  // change status and the change persists.
  // =========================================================================

  const staff = await signIn(STAFF_EMAIL, STAFF_PASSWORD);

  const { data: allRows, error: allError } = await staff
    .from("applications")
    .select("id, status, full_name, applicant_id");

  record("1", "staff can list all applications",
    !allError && (allRows?.length ?? 0) >= 20,
    allError ? allError.message : `${allRows?.length ?? 0} application(s)`);

  record("1", "staff sees applications from more than one applicant",
    new Set((allRows ?? []).map((r) => r.applicant_id)).size > 1);

  const pendingRow = (allRows ?? []).find((row) => row.status === "pending");
  record("1", "at least one application is visible with status pending",
    Boolean(pendingRow), pendingRow?.full_name);

  if (pendingRow) {
    const originalStatus = pendingRow.status;

    const { data: updated, error: updateError } = await staff
      .from("applications")
      .update({ status: "waitlisted" })
      .eq("id", pendingRow.id)
      .select("id, status");

    record("2", "staff can change an application's status",
      !updateError && updated?.[0]?.status === "waitlisted",
      updateError ? updateError.message : `now ${updated?.[0]?.status}`);

    // Re-read on a brand-new client, i.e. a fresh connection and a fresh
    // request — the API-level equivalent of reloading the page.
    const staffAgain = await signIn(STAFF_EMAIL, STAFF_PASSWORD);
    const { data: reread } = await staffAgain
      .from("applications")
      .select("status")
      .eq("id", pendingRow.id)
      .single();

    record("2", "the change persists across a fresh session",
      reread?.status === "waitlisted", `re-read as ${reread?.status}`);

    // Stretch goal: the change was recorded, with an actor.
    const { data: events } = await staffAgain
      .from("application_status_events")
      .select("old_status, new_status, changed_by")
      .eq("application_id", pendingRow.id)
      .order("changed_at", { ascending: false })
      .limit(1);

    const { data: staffUser } = await staffAgain.auth.getUser();
    record("stretch", "the status change was written to the audit trail",
      events?.[0]?.new_status === "waitlisted",
      `${events?.[0]?.old_status} -> ${events?.[0]?.new_status}`);
    record("stretch", "the audit trail records which staff user made the change",
      events?.[0]?.changed_by === staffUser.user?.id);

    // Staff may change status but nothing else.
    const { error: contentError } = await staffAgain
      .from("applications")
      .update({ motivation: "Rewritten by a reviewer, which should not be possible." })
      .eq("id", pendingRow.id)
      .select("id");
    record("extra", "staff cannot rewrite an applicant's answers",
      Boolean(contentError), contentError?.code ?? "update unexpectedly succeeded");

    // Restore, so the script is safe to run repeatedly.
    await staffAgain.from("applications").update({ status: originalStatus }).eq("id", pendingRow.id);
    await staffAgain.auth.signOut();
  }

  await applicant.auth.signOut();
  await staff.auth.signOut();

  // =========================================================================
  // Criterion 6 — the app is deployed and reachable at a public URL.
  // =========================================================================

  if (SITE_URL) {
    const rootResponse = await fetch(SITE_URL, { redirect: "manual" });
    record("6", "the deployed app responds",
      rootResponse.status < 500, `HTTP ${rootResponse.status}`);

    // A signed-out visitor must not be served the dashboard.
    const dashboardResponse = await fetch(`${SITE_URL.replace(/\/$/, "")}/dashboard`, {
      redirect: "manual",
    });
    const redirectedToLogin =
      dashboardResponse.status >= 300 &&
      dashboardResponse.status < 400 &&
      (dashboardResponse.headers.get("location") ?? "").includes("/login");
    record("3", "signed-out request for /dashboard is redirected to login",
      redirectedToLogin, `HTTP ${dashboardResponse.status} -> ${dashboardResponse.headers.get("location")}`);
  } else {
    console.log("\n  (skipped criterion 6 — pass --url https://your-site.netlify.app to include it)");
  }

  // =========================================================================
  // Summary
  // =========================================================================

  const failed = checks.filter((check) => !check.passed);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed.`);

  if (failed.length > 0) {
    console.log("\nFailures:");
    for (const check of failed) {
      console.log(`  [${check.criterion}] ${check.description}${check.detail ? ` — ${check.detail}` : ""}`);
    }
    process.exit(1);
  }
  console.log("");
}

main().catch((error) => {
  console.error("\nVerification could not complete:\n", error);
  process.exit(1);
});
