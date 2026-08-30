import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import {
  AVAILABILITY_LABELS,
  STATUS_LABELS,
  type ApplicationRow,
} from "@/lib/database.types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * The applicant's own view: their application, and its current status.
 *
 * This is the read half of acceptance criterion 4. Worth noticing what is not
 * here: no application id in the URL, no way to ask for a different row. The
 * page reads "the application belonging to whoever is signed in", so there is
 * no parameter to tamper with in the first place. Even if there were, the RLS
 * policy would return nothing for anyone else's row.
 */
export default async function MyApplicationPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const params = await searchParams;
  const session = await requireUser("/application");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("applications")
    .select("*")
    .eq("applicant_id", session.userId)
    .maybeSingle();

  if (error) {
    console.error("Failed to load own application", error);
  }

  const application = data as ApplicationRow | null;

  if (!application) {
    if (session.role === "staff") redirect("/dashboard");
    redirect("/apply");
  }

  return (
    <main className="narrow">
      <h1>Your application</h1>
      <p className="page-intro">
        Submitted {new Date(application.created_at).toLocaleDateString("en-GB", {
          day: "numeric", month: "long", year: "numeric",
        })}
      </p>

      {params.notice === "submitted" ? (
        <div className="notice info">
          Thank you — your application has been received. We review applications in
          batches and will be in touch by email.
        </div>
      ) : null}
      {params.notice === "already_submitted" ? (
        <div className="notice info">
          You have already applied. Your existing application is shown below.
        </div>
      ) : null}
      {params.error === "staff_only" ? (
        <div className="notice error">
          That page is only available to Rethink Wellbeing staff.
        </div>
      ) : null}

      <div className="card">
        <dl className="detail">
          <dt>Status</dt>
          <dd>
            <span className={`status status-${application.status}`}>
              {STATUS_LABELS[application.status]}
            </span>
          </dd>

          <dt>Full name</dt>
          <dd>{application.full_name}</dd>

          <dt>Email</dt>
          <dd>{application.email}</dd>

          <dt>Country</dt>
          <dd>{application.country}</dd>

          <dt>Time zone</dt>
          <dd>{application.time_zone}</dd>

          <dt>Availability</dt>
          <dd>{AVAILABILITY_LABELS[application.availability]}</dd>

          <dt>Motivation</dt>
          <dd>{application.motivation}</dd>
        </dl>
      </div>

      <p className="hint" style={{ marginTop: 16 }}>
        Need to change something? Reply to your confirmation email and we will
        update it for you. Applications cannot be edited after submission.
      </p>
    </main>
  );
}
