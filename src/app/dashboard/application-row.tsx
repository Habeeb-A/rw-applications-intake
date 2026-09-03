"use client";

import { useId, useState } from "react";

import {
  AVAILABILITY_LABELS,
  STATUS_LABELS,
  type ApplicationRow as Application,
} from "@/lib/database.types";

import { StatusSelect } from "./status-select";

/**
 * One application in the review queue, expandable to its full record.
 *
 * The table truncates motivation at 140 characters, which is enough to triage
 * on and not enough to decide on. Expanding shows the whole answer.
 *
 * No query runs when a row opens. The dashboard already selects every column
 * for every row it is allowed to see, so this is purely a matter of which of
 * the data staff already hold is currently on screen — there is no per-row
 * fetch to secure, and no id travels anywhere.
 *
 * `submittedLabel` arrives pre-formatted from the server rather than being
 * built here from `created_at`. Formatting a date in the browser gives the
 * viewer's locale and time zone, which would disagree with the server's render
 * and produce a hydration mismatch on every row.
 */
export function ApplicationRow({
  application,
  submittedLabel,
}: {
  application: Application;
  submittedLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <>
      <tr>
        <td>
          <button
            type="button"
            className="row-toggle"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((previous) => !previous)}
          >
            <span className="row-caret" aria-hidden="true">▶</span>
            <span>
              <span className="person-name">{application.full_name}</span>
              <span className="person-mail">{application.email}</span>
            </span>
          </button>
        </td>
        <td className="nowrap">{application.country}</td>
        <td className="nowrap">{application.time_zone}</td>
        <td className="nowrap">{AVAILABILITY_LABELS[application.availability]}</td>
        <td className="motivation">
          {application.motivation.length > 140
            ? `${application.motivation.slice(0, 140).trimEnd()}…`
            : application.motivation}
        </td>
        <td className="nowrap">{submittedLabel}</td>
        <td>
          <StatusSelect
            applicationId={application.id}
            currentStatus={application.status}
          />
        </td>
      </tr>

      {open ? (
        <tr className="detail-row">
          <td colSpan={7}>
            <div className="detail-panel" id={panelId}>
              <h3>{application.full_name}</h3>
              <dl className="detail">
                <dt>Status</dt>
                <dd>
                  <span className={`status status-${application.status}`}>
                    {STATUS_LABELS[application.status]}
                  </span>
                </dd>

                <dt>Email</dt>
                <dd>{application.email}</dd>

                <dt>Country</dt>
                <dd>{application.country}</dd>

                <dt>Time zone</dt>
                <dd>{application.time_zone}</dd>

                <dt>Availability</dt>
                <dd>{AVAILABILITY_LABELS[application.availability]}</dd>

                <dt>Submitted</dt>
                <dd>{submittedLabel}</dd>

                <dt>Motivation</dt>
                <dd>{application.motivation}</dd>
              </dl>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
