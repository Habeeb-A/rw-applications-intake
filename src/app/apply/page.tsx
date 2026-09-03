import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { ApplicationForm } from "./application-form";

export const dynamic = "force-dynamic";

export default async function ApplyPage() {
  const session = await requireUser("/apply");

  // Staff have no application of their own; the form is not their destination.
  if (session.role === "staff") redirect("/dashboard");

  // One application per person, so if one already exists this is the wrong
  // page. Checked here as well as in the database because a friendly redirect
  // beats a unique-violation error message.
  const supabase = await createSupabaseServerClient();
  const { data: existing } = await supabase
    .from("applications")
    .select("id")
    .eq("applicant_id", session.userId)
    .maybeSingle();

  if (existing) redirect("/application");

  return (
    <main className="main narrow">
      <p className="eyebrow">Applicant · CBT Lab</p>

      <div className="hero">
        <p className="hero-eyebrow">Cohort applications open</p>
        <h1>Apply to the CBT Lab</h1>
        <p className="hero-lede">
          A 12-week peer-facilitated group programme: nine 90-minute sessions in
          a group of five or six, led by a trained facilitator. This form takes a
          couple of minutes, and you can check your status here afterwards.
        </p>
        <div className="chips">
          <span className="chip lit">9 sessions</span>
          <span className="chip">5–6 per group</span>
          <span className="chip">~5 h per week</span>
        </div>
      </div>

      <ApplicationForm defaultEmail={session.email} />
    </main>
  );
}
