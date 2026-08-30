"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getSessionContext } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseApplicationForm, type FieldErrors } from "@/lib/validation";

export interface ApplyState {
  formError?: string;
  fieldErrors?: FieldErrors;
}

/**
 * Submit an application.
 *
 * A Server Action is a POST endpoint. It is reachable by anything that can make
 * an HTTP request, not only by the form component that renders above it, so it
 * re-establishes who the caller is rather than trusting anything the request
 * carries.
 *
 * Note what is NOT taken from the submitted form: `applicant_id` and `status`.
 *
 *   - `applicant_id` is set from the verified session. If it came from the form,
 *     a caller could submit an application into someone else's account. (The
 *     RLS WITH CHECK would reject that too — this is the second of the two
 *     locks, not the only one.)
 *   - `status` is never sent at all. The `authenticated` role holds no INSERT
 *     grant on that column, so the database applies its 'pending' default. This
 *     is what makes acceptance criterion 1 hold by construction: there is no
 *     code path, and no API call, that creates an application in any other
 *     state.
 */
export async function submitApplication(
  _prevState: ApplyState,
  formData: FormData,
): Promise<ApplyState> {
  const session = await getSessionContext();
  if (!session) {
    redirect("/login?next=/apply");
  }

  const parsed = parseApplicationForm(formData);
  if (!parsed.success) {
    return { fieldErrors: parsed.errors };
  }

  const supabase = await createSupabaseServerClient();

  const { error } = await supabase.from("applications").insert({
    applicant_id: session.userId, // from the session, never from the form
    full_name: parsed.data.full_name,
    email: parsed.data.email,
    country: parsed.data.country,
    time_zone: parsed.data.time_zone,
    motivation: parsed.data.motivation,
    availability: parsed.data.availability,
  });

  if (error) {
    // 23505 — unique violation on applications_one_per_applicant_per_type.
    // Not really an error from the user's point of view: they already applied,
    // most likely by double-submitting. Send them to their application.
    if (error.code === "23505") {
      redirect("/application?notice=already_submitted");
    }

    // 23514 — a CHECK constraint the zod schema should have caught first.
    // Reaching here means the two have drifted apart, which is worth knowing
    // about in the logs rather than silently mapping to a generic message.
    if (error.code === "23514") {
      console.error("CHECK constraint rejected an application that passed validation", error);
      return {
        formError:
          "One of your answers was rejected by the database. Please check the lengths of your answers and try again.",
      };
    }

    console.error("Failed to insert application", error);
    return {
      formError: "Something went wrong saving your application. Please try again.",
    };
  }

  // The applicant's own view is a server component reading this row; without
  // this the cached render would show the pre-submission state.
  revalidatePath("/application");
  redirect("/application?notice=submitted");
}
