import { redirect } from "next/navigation";

import type { AppRole } from "@/lib/database.types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface SessionContext {
  userId: string;
  email: string;
  role: AppRole;
}

/**
 * Resolve the signed-in user and their role, server-side, on every request.
 *
 * Three things are deliberate here:
 *
 *  - `getUser()` rather than `getSession()`. getSession() decodes whatever
 *    cookie the browser sent; getUser() verifies it against the Auth server. On
 *    a decision that gates access, only the verified answer is worth having.
 *
 *  - The role comes from a database read, not from the JWT. A JWT claim is a
 *    snapshot from sign-in time: revoking someone's staff access would not take
 *    effect until their token expired. Reading `profiles` means a revocation is
 *    effective on the user's next request. The cost is one indexed
 *    primary-key lookup per protected page load, which is the right trade at
 *    this scale. (See the README for what I would do instead at higher volume.)
 *
 *  - This function returns null rather than throwing, so callers decide what a
 *    missing session means for their page.
 */
export async function getSessionContext(): Promise<SessionContext | null> {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) return null;

  // Subject to RLS: the policy on `profiles` lets a user read their own row,
  // so this returns exactly one row and could not return anyone else's even if
  // the filter below were wrong.
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, email, role")
    .eq("id", user.id)
    .single();

  if (profileError || !profile) {
    // A user with no profile row should be impossible — the trigger on
    // auth.users creates one for every account. Treat it as "not signed in"
    // rather than guessing a role.
    return null;
  }

  return {
    userId: profile.id,
    email: profile.email,
    role: profile.role,
  };
}

/** For pages that need any signed-in user. */
export async function requireUser(nextPath?: string): Promise<SessionContext> {
  const context = await getSessionContext();
  if (!context) {
    redirect(nextPath ? `/login?next=${encodeURIComponent(nextPath)}` : "/login");
  }
  return context;
}

/**
 * For staff-only pages.
 *
 * Note that a non-staff user reaching /dashboard is sent away by this check,
 * *and* would see nothing if they somehow got past it: the RLS policy on
 * `applications` returns no rows to a non-staff caller, and the audit-trail
 * policy returns none either. This function makes the failure a clean redirect
 * instead of an empty table.
 */
export async function requireStaff(): Promise<SessionContext> {
  const context = await requireUser("/dashboard");
  if (context.role !== "staff") {
    redirect("/application?error=staff_only");
  }
  return context;
}
