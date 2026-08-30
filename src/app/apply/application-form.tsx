"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { AVAILABILITY_LABELS } from "@/lib/database.types";
import { AVAILABILITY_VALUES } from "@/lib/validation";

import { submitApplication, type ApplyState } from "./actions";

/**
 * A small, common list — enough for a realistic form without pulling in a
 * timezone package for a trial. `Intl.supportedValuesOf("timeZone")` would give
 * the full IANA list in one line; noted in the README as a with-more-time item,
 * since the full list is ~400 entries and needs a combobox rather than a select.
 */
const TIME_ZONES = [
  "Africa/Lagos",
  "Africa/Nairobi",
  "Africa/Johannesburg",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Warsaw",
  "Asia/Kolkata",
  "Asia/Manila",
  "Asia/Singapore",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Australia/Sydney",
  "UTC",
];

function SubmitButton() {
  // useFormStatus reads the pending state of the enclosing form, which is why
  // this has to be its own component rather than a branch inside the form.
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}>
      {pending ? "Submitting…" : "Submit application"}
    </button>
  );
}

export function ApplicationForm({ defaultEmail }: { defaultEmail: string }) {
  const [state, formAction] = useActionState<ApplyState, FormData>(
    submitApplication,
    {},
  );

  const fieldErrors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="card" noValidate>
      {state.formError ? <div className="notice error">{state.formError}</div> : null}

      <div className="field">
        <label htmlFor="full_name">Full name</label>
        <input
          id="full_name"
          name="full_name"
          type="text"
          maxLength={120}
          required
          aria-invalid={Boolean(fieldErrors.full_name)}
          aria-describedby={fieldErrors.full_name ? "full_name-error" : undefined}
        />
        {fieldErrors.full_name ? (
          <p className="field-error" id="full_name-error">{fieldErrors.full_name}</p>
        ) : null}
      </div>

      <div className="field">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          maxLength={254}
          required
          defaultValue={defaultEmail}
          aria-invalid={Boolean(fieldErrors.email)}
          aria-describedby={fieldErrors.email ? "email-error" : "email-hint"}
        />
        <p className="hint" id="email-hint">
          Pre-filled from your sign-in. Change it if you would rather we used a
          different address for programme correspondence.
        </p>
        {fieldErrors.email ? (
          <p className="field-error" id="email-error">{fieldErrors.email}</p>
        ) : null}
      </div>

      <div className="field">
        <label htmlFor="country">Country</label>
        <input
          id="country"
          name="country"
          type="text"
          maxLength={80}
          required
          aria-invalid={Boolean(fieldErrors.country)}
          aria-describedby={fieldErrors.country ? "country-error" : undefined}
        />
        {fieldErrors.country ? (
          <p className="field-error" id="country-error">{fieldErrors.country}</p>
        ) : null}
      </div>

      <div className="field">
        <label htmlFor="time_zone">Time zone</label>
        <select
          id="time_zone"
          name="time_zone"
          required
          defaultValue=""
          aria-invalid={Boolean(fieldErrors.time_zone)}
          aria-describedby={fieldErrors.time_zone ? "time_zone-error" : "time_zone-hint"}
        >
          <option value="" disabled>Select a time zone…</option>
          {TIME_ZONES.map((zone) => (
            <option key={zone} value={zone}>{zone.replace("_", " ")}</option>
          ))}
        </select>
        <p className="hint" id="time_zone-hint">
          Groups are matched partly on time zone, so this one matters.
        </p>
        {fieldErrors.time_zone ? (
          <p className="field-error" id="time_zone-error">{fieldErrors.time_zone}</p>
        ) : null}
      </div>

      <div className="field">
        <label htmlFor="motivation">What brings you to the programme?</label>
        <textarea
          id="motivation"
          name="motivation"
          maxLength={4000}
          required
          aria-invalid={Boolean(fieldErrors.motivation)}
          aria-describedby={fieldErrors.motivation ? "motivation-error" : "motivation-hint"}
        />
        <p className="hint" id="motivation-hint">
          A few sentences is plenty. Minimum 20 characters.
        </p>
        {fieldErrors.motivation ? (
          <p className="field-error" id="motivation-error">{fieldErrors.motivation}</p>
        ) : null}
      </div>

      <fieldset
        className="field"
        style={{ border: "none", padding: 0, margin: "0 0 18px" }}
      >
        <legend
          style={{ padding: 0, fontWeight: 550, fontSize: 13, marginBottom: 6 }}
        >
          Availability
        </legend>
        <div className="radio-group">
          {AVAILABILITY_VALUES.map((value) => (
            <label className="radio-option" key={value} htmlFor={`availability-${value}`}>
              <input
                id={`availability-${value}`}
                type="radio"
                name="availability"
                value={value}
                required
              />
              {AVAILABILITY_LABELS[value]}
            </label>
          ))}
        </div>
        {fieldErrors.availability ? (
          <p className="field-error">{fieldErrors.availability}</p>
        ) : null}
      </fieldset>

      <SubmitButton />
    </form>
  );
}
