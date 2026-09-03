import { requireStaff } from "@/lib/auth";
import {
  APPLICATION_STATUSES,
  AVAILABILITY_LABELS,
  STATUS_LABELS,
  type ApplicationRow,
  type ApplicationStatus,
} from "@/lib/database.types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { StatusSelect } from "./status-select";

/**
 * Never serve this from cache. A reviewer queue that shows a decision a
 * colleague already changed is worse than a slightly slower page.
 */
export const dynamic = "force-dynamic";

interface StatusEventWithActor {
  id: number;
  old_status: ApplicationStatus | null;
  new_status: ApplicationStatus;
  changed_at: string;
  applications: { full_name: string } | null;
  actor: { email: string } | null;
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
  });
}

export default async function DashboardPage() {
  // Redirects a non-staff user before any query runs. This is a convenience:
  // the two queries below return nothing to a non-staff caller regardless,
  // because both tables' policies require public.is_staff().
  await requireStaff();

  const supabase = await createSupabaseServerClient();

  const [applicationsResult, eventsResult] = await Promise.all([
    supabase.from("applications").select("*").order("created_at", { ascending: false }),
    // The embedded selects resolve from foreign keys. `actor:profiles(email)`
    // works because application_status_events.changed_by references
    // public.profiles rather than auth.users — PostgREST cannot see into the
    // auth schema.
    supabase
      .from("application_status_events")
      .select("id, old_status, new_status, changed_at, applications(full_name), actor:profiles(email)")
      .not("old_status", "is", null) // creation events are noise in an activity feed
      .order("changed_at", { ascending: false })
      .limit(8),
  ]);

  if (applicationsResult.error) console.error("Failed to load applications", applicationsResult.error);
  if (eventsResult.error) console.error("Failed to load status events", eventsResult.error);

  const applications = (applicationsResult.data ?? []) as ApplicationRow[];
  const events = (eventsResult.data ?? []) as unknown as StatusEventWithActor[];

  const counts = APPLICATION_STATUSES.reduce<Record<ApplicationStatus, number>>(
    (acc, status) => {
      acc[status] = applications.filter((a) => a.status === status).length;
      return acc;
    },
    { pending: 0, accepted: 0, rejected: 0, waitlisted: 0 },
  );

  const countries = new Set(applications.map((a) => a.country)).size;

  return (
    <main className="main">
      <p className="eyebrow">Staff · Applications intake</p>

      <div className="hero">
        <p className="hero-eyebrow">Review queue</p>
        <h1>
          {counts.pending > 0
            ? `${counts.pending} application${counts.pending === 1 ? "" : "s"} waiting on a decision`
            : "Every application has been reviewed"}
        </h1>
        <p className="hero-lede">
          Set a status on any row below. The change saves immediately and is
          recorded in the audit trail with your name against it.
        </p>
        <hr className="hero-rule" />
        <div className="chips">
          <span className={`chip${counts.pending > 0 ? " lit" : ""}`}>
            {counts.pending} pending
          </span>
          <span className="chip">{applications.length} total</span>
          <span className="chip">{countries} countries</span>
        </div>
      </div>

      <div className="tiles">
        <div className="tile accent">
          <span className="tile-k">Total</span>
          <div className="tile-v">{applications.length}</div>
          <div className="tile-c">All applications</div>
        </div>
        {APPLICATION_STATUSES.map((status) => (
          <div className="tile" key={status}>
            <span className="tile-k">{STATUS_LABELS[status]}</span>
            <div className="tile-v">{counts[status]}</div>
            <div className="tile-c">
              {applications.length > 0
                ? `${Math.round((counts[status] / applications.length) * 100)}% of total`
                : "—"}
            </div>
          </div>
        ))}
      </div>

      {applications.length === 0 ? (
        <div className="card">
          <p className="card-label">No data</p>
          <p className="muted" style={{ margin: 0 }}>
            No applications yet. Run <code>npm run seed</code> to load synthetic
            test data, or submit one through the applicant form.
          </p>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Applicant</th>
                <th scope="col">Country</th>
                <th scope="col">Time zone</th>
                <th scope="col">Availability</th>
                <th scope="col">Motivation</th>
                <th scope="col">Submitted</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {applications.map((application) => (
                <tr key={application.id}>
                  <td>
                    <div className="person-name">{application.full_name}</div>
                    <div className="person-mail">{application.email}</div>
                  </td>
                  <td className="nowrap">{application.country}</td>
                  <td className="nowrap">{application.time_zone}</td>
                  <td className="nowrap">{AVAILABILITY_LABELS[application.availability]}</td>
                  <td className="motivation">
                    {application.motivation.length > 140
                      ? `${application.motivation.slice(0, 140).trimEnd()}…`
                      : application.motivation}
                  </td>
                  <td className="nowrap">{formatDate(application.created_at)}</td>
                  <td>
                    <StatusSelect
                      applicationId={application.id}
                      currentStatus={application.status}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card" style={{ marginTop: 24 }}>
        <p className="card-label">Audit trail</p>
        <h2>Recent status changes</h2>
        <p className="muted small" style={{ margin: "6px 0 18px" }}>
          Written by a database trigger rather than by application code, so every
          status change is recorded regardless of how it was made — including a
          change made directly against the API.
        </p>
        {events.length === 0 ? (
          <p className="muted small" style={{ margin: 0 }}>No status changes recorded yet.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
            {events.map((event) => (
              <li key={event.id} style={{ marginBottom: 8 }}>
                <strong>{event.actor?.email ?? "system"}</strong> moved{" "}
                {event.applications?.full_name ?? "an application"} from{" "}
                {event.old_status ? STATUS_LABELS[event.old_status] : "—"} to{" "}
                <strong>{STATUS_LABELS[event.new_status]}</strong>
                <span className="muted"> · {formatDateTime(event.changed_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
