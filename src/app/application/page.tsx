import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import {
  AVAILABILITY_LABELS,
  STATUS_LABELS,
  type ApplicationRow,
  type ApplicationStatus,
} from "@/lib/database.types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * The applicant's own view: their application, and its current status.
 *
 * This is the read half of acceptance criterion 4. Note what is absent: no
 * application id in the URL, no query parameter naming a record. The page reads
 * "the application belonging to whoever is signed in", so there is nothing to
 * tamper with — and if there were, the RLS policy returns no row for anyone
 * else's application anyway.
 */
export const dynamic = "force-dynamic";

const STATUS_COPY: Record<ApplicationStatus, string> = {
  pending: "Your application is with our review team. We review in batches and will email you when there is a decision.",
  accepted: "You have a place on the programme. Look out for an email with your group and start date.",
  rejected: "We are not able to offer you a place on this cohort. You are welcome to apply again for a future one.",
  waitlisted: "You are on the waiting list. If a place opens up before the cohort starts, we will be in touch.",
};

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
    // Scoped to application_type as well as owner. Uniqueness is per
    // (applicant_id, application_type), so one person may legitimately own a
    // participant row and a facilitator row; maybeSingle() errors on two rows
    // and yields null, which would read here as "no application at all".
    .eq("application_type", "participant")
    .maybeSingle();

  if (error) console.error("Failed to load own application", error);

  const application = data as ApplicationRow | null;

  if (!application) {
    if (session.role === "staff") redirect("/dashboard");
    redirect("/apply");
  }

  return (
    <main className="main narrow">
      <p className="eyebrow">Applicant · CBT Lab</p>

      <div className="hero">
        <p className="hero-eyebrow">Application status</p>
        <h1>{STATUS_LABELS[application.status]}</h1>
        <p className="hero-lede">{STATUS_COPY[application.status]}</p>
        <hr className="hero-rule" />
        <div className="chips">
          <span className="chip lit">
            Submitted {new Date(application.created_at).toLocaleDateString("en-GB", {
              day: "numeric", month: "long", year: "numeric",
            })}
          </span>
          <span className="chip">12-week programme</span>
        </div>
      </div>

      {params.notice === "submitted" ? (
        <div className="notice info">
          <p>Thank you — your application has been received.</p>
        </div>
      ) : null}
      {params.notice === "already_submitted" ? (
        <div className="notice info">
          <p>You have already applied. Your existing application is shown below.</p>
        </div>
      ) : null}
      {params.error === "staff_only" ? (
        <div className="notice error">
          <p>That page is only available to Rethink Wellbeing staff.</p>
        </div>
      ) : null}

      <div className="card">
        <p className="card-label">What you told us</p>
        <h2 style={{ marginBottom: 20 }}>Your answers</h2>
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

      <p className="hint" style={{ marginTop: 18 }}>
        Need to change something? Reply to your confirmation email and we will
        update it for you. Applications cannot be edited after submission.
      </p>
    </main>
  );
}
