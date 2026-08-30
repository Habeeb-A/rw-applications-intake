import { redirect } from "next/navigation";

import { getSessionContext } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * The root path is a router, not a page. Where someone lands depends only on
 * facts the server just verified: whether they have a session, what role their
 * profile carries, and whether an application already exists for them.
 */
export default async function Home() {
  const session = await getSessionContext();

  if (!session) redirect("/login");
  if (session.role === "staff") redirect("/dashboard");

  const supabase = await createSupabaseServerClient();

  // RLS means this can only ever return this user's own row, so no filter on
  // applicant_id is strictly required. It is included anyway: relying on an
  // implicit policy to scope a query makes the query's intent unreadable, and
  // a future policy change would silently alter what this page does.
  const { data: application } = await supabase
    .from("applications")
    .select("id")
    .eq("applicant_id", session.userId)
    .maybeSingle();

  redirect(application ? "/application" : "/apply");
}
