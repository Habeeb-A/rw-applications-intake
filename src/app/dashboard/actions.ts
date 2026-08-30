"use server";

import { revalidatePath } from "next/cache";

import { getSessionContext } from "@/lib/auth";
import { APPLICATION_STATUSES, type ApplicationStatus } from "@/lib/database.types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface UpdateStatusResult {
  ok: boolean;
  message?: string;
}

/**
 * Change an application's status.
 *
 * There are three independent gates between a request and a changed row, and
 * it is worth being precise about which one does what, because they fail
 * differently:
 *
 *   1. This function checks the caller's role from the database. Rejects a
 *      non-staff caller with a clear message. If it were removed, nothing
 *      unsafe would happen — the caller would just get a confusing "0 rows
 *      updated" instead of "not allowed".
 *
 *   2. The RLS UPDATE policy (`using (public.is_staff())`) decides which rows
 *      the caller may target. This is the gate that actually enforces the rule.
 *      A non-staff caller hitting the REST API directly, with no involvement
 *      from this file at all, matches zero rows.
 *
 *   3. The column-level UPDATE grant, which covers `status` alone. Even a staff
 *      caller cannot rewrite an applicant's motivation through the API.
 *
 * Only the first of the three lives in application code, and it is the only one
 * that is not load-bearing. That ordering is the whole design.
 */
export async function updateApplicationStatus(
  applicationId: string,
  nextStatus: ApplicationStatus,
): Promise<UpdateStatusResult> {
  const session = await getSessionContext();

  if (!session) {
    return { ok: false, message: "Your session has expired. Please sign in again." };
  }

  if (session.role !== "staff") {
    return { ok: false, message: "Only staff can change an application status." };
  }

  // The status arrives from a client component, so it is a string until proven
  // otherwise. Postgres would reject an invalid enum value anyway; checking
  // here turns a 22P02 into a sentence.
  if (!APPLICATION_STATUSES.includes(nextStatus)) {
    return { ok: false, message: `"${nextStatus}" is not a valid status.` };
  }

  const supabase = await createSupabaseServerClient();

  // `.select()` after `.update()` asks PostgREST to return the affected rows.
  // That is how we can tell a genuinely-applied update from one that RLS
  // filtered to nothing: without it, a policy-blocked update and a successful
  // one are both a 204 with no error.
  const { data, error } = await supabase
    .from("applications")
    .update({ status: nextStatus })
    .eq("id", applicationId)
    .select("id, status");

  if (error) {
    console.error("Failed to update application status", error);
    return { ok: false, message: "Could not save that change. Please try again." };
  }

  if (!data || data.length === 0) {
    // Either the row does not exist, or a policy excluded it. Deliberately not
    // distinguishing the two in the message: telling a caller "that row exists
    // but you may not touch it" confirms the existence of a record they have no
    // right to know about.
    return { ok: false, message: "That application could not be updated." };
  }

  // The audit row was written by an AFTER UPDATE trigger inside the same
  // transaction as this update — not here. It cannot be skipped by any caller,
  // including a future one that forgets this action exists.
  revalidatePath("/dashboard");
  return { ok: true };
}
