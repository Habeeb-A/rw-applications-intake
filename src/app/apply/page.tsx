import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { ApplicationForm } from "./application-form";

export default async function ApplyPage() {
  const session = await requireUser("/apply");

  // Staff have no application of their own; sending them to the form would be
  // a dead end (the unique index is per user, so they *could* apply, but it
  // isn't what this page is for).
  if (session.role === "staff") redirect("/dashboard");

  // One application per person, so if one exists this page is not the right
  // destination. The check is here as well as in the database because a
  // friendly redirect beats a unique-violation error message.
  const supabase = await createSupabaseServerClient();
  const { data: existing } = await supabase
    .from("applications")
    .select("id")
    .eq("applicant_id", session.userId)
    .maybeSingle();

  if (existing) redirect("/application");

  return (
    <main className="narrow">
      <h1>Apply to the CBT Lab</h1>
      <p className="page-intro">
        A 12-week peer-facilitated group programme. This form takes a couple of
        minutes. You can check your status here after submitting.
      </p>
      <ApplicationForm defaultEmail={session.email} />
    </main>
  );
}
