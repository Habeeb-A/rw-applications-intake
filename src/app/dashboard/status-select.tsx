"use client";

import { useState, useTransition } from "react";

import {
  APPLICATION_STATUSES,
  STATUS_LABELS,
  type ApplicationStatus,
} from "@/lib/database.types";

import { updateApplicationStatus } from "./actions";

/**
 * The reviewer's control for one application.
 *
 * Optimistic in the sense that the select shows the new value immediately, but
 * it reverts on failure rather than leaving a reviewer believing they recorded
 * a decision they did not. For a queue where the decision has real consequences
 * for a person, a silently-lost write is the failure worth designing against.
 */
export function StatusSelect({
  applicationId,
  currentStatus,
}: {
  applicationId: string;
  currentStatus: ApplicationStatus;
}) {
  const [status, setStatus] = useState<ApplicationStatus>(currentStatus);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const nextStatus = event.target.value as ApplicationStatus;
    const previousStatus = status;

    setStatus(nextStatus);
    setError(null);

    startTransition(async () => {
      const result = await updateApplicationStatus(applicationId, nextStatus);
      if (!result.ok) {
        setStatus(previousStatus);
        setError(result.message ?? "Could not save that change.");
      }
    });
  }

  return (
    <div>
      <label className="visually-hidden" htmlFor={`status-${applicationId}`}>
        Status
      </label>
      <select
        id={`status-${applicationId}`}
        value={status}
        disabled={isPending}
        onChange={handleChange}
        aria-busy={isPending}
      >
        {APPLICATION_STATUSES.map((value) => (
          <option key={value} value={value}>
            {STATUS_LABELS[value]}
          </option>
        ))}
      </select>
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
