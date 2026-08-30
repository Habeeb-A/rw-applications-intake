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
 * Always render fresh. A reviewer queue that serves a cached page shows
 * decisions that have already been made by a colleague, which is worse than a
 * slower page.
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
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function DashboardPage() {
  // Redirects a non-staff user before any query runs. Note that this is a
  // convenience: the queries below would return nothing for a non-staff caller
  // regardless, because both tables' policies require public.is_staff().
  await requireStaff();

  const supabase = await createSupabaseServerClient();

  const [applicationsResult, eventsResult] = await Promise.all([
    supabase
      .from("applications")
      .select("*")
      .order("created_at", { ascending: false }),
    // The embedded selects below are resolved by PostgREST from the foreign
    // keys on application_status_events. `actor:profiles(email)` works because
    // changed_by references public.profiles rather than auth.users.
    supabase
      .from("application_status_events")
      .select("id, old_status, new_status, changed_at, applications(full_name), actor:profiles(email)")
      .not("old_status", "is", null) // creation events are noise in an activity feed
      .order("changed_at", { ascending: false })
      .limit(8),
  ]);

  if (applicationsResult.error) {
    console.error("Failed to load applications", applicationsResult.error);
  }
  if (eventsResult.error) {
    console.error("Failed to load status events", eventsResult.error);
  }

  const applications = (applicationsResult.data ?? []) as ApplicationRow[];
  const events = (eventsResult.data ?? []) as unknown as StatusEventWithActor[];

  const counts = APPLICATION_STATUSES.reduce<Record<ApplicationStatus, number>>(
    (acc, status) => {
      acc[status] = applications.filter((a) => a.status === status).length;
      return acc;
    },
    { pending: 0, accepted: 0, rejected: 0, waitlisted: 0 },
  );

  return (
    <main>
      <h1>Applications</h1>
      <p className="page-intro">
        All applications to the CBT Lab programme. Changing a status saves
        immediately and is recorded in the audit trail.
      </p>

      <div className="summary">
        <div className="summary-item">
          <div className="summary-value">{applications.length}</div>
          <div className="summary-label">Total</div>
        </div>
        {APPLICATION_STATUSES.map((status) => (
          <div className="summary-item" key={status}>
            <div className="summary-value">{counts[status]}</div>
            <div className="summary-label">{STATUS_LABELS[status]}</div>
          </div>
        ))}
      </div>

      {applications.length === 0 ? (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            No applications yet. Run <code>npm run seed</code> to load synthetic
            test data, or submit one through the applicant form.
          </p>
        </div>
      ) : (
        <div className="table-scroll">
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
                    <div style={{ fontWeight: 550 }}>{application.full_name}</div>
                    <div className="muted small">{application.email}</div>
                  </td>
                  <td className="nowrap">{application.country}</td>
                  <td className="nowrap">{application.time_zone}</td>
                  <td className="nowrap">
                    {AVAILABILITY_LABELS[application.availability]}
                  </td>
                  <td className="motivation">
                    {application.motivation.length > 150
                      ? `${application.motivation.slice(0, 150).trimEnd()}…`
                      : application.motivation}
                  </td>
                  <td className="nowrap">
                    {new Date(application.created_at).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </td>
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
        <h2 style={{ fontSize: 15, margin: "0 0 4px" }}>Recent status changes</h2>
        <p className="muted small" style={{ margin: "0 0 14px" }}>
          Written by a database trigger, not by application code, so it records
          every status change regardless of how the change was made.
        </p>
        {events.length === 0 ? (
          <p className="muted small" style={{ margin: 0 }}>
            No status changes recorded yet.
          </p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {events.map((event) => (
              <li key={event.id} className="small" style={{ marginBottom: 6 }}>
                <strong>{event.actor?.email ?? "system"}</strong> changed{" "}
                {event.applications?.full_name ?? "an application"} from{" "}
                {event.old_status ? STATUS_LABELS[event.old_status] : "—"} to{" "}
                {STATUS_LABELS[event.new_status]} · {formatDateTime(event.changed_at)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
