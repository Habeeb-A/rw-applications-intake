import { z } from "zod";

/**
 * Validation for the application form.
 *
 * This runs on the server, inside the Server Action, before anything reaches
 * Supabase. It is the second of three layers and none of them is redundant:
 *
 *   1. HTML attributes (required, maxLength) — instant feedback, trivially
 *      bypassed, and that is fine because it is a usability feature.
 *   2. This schema — runs on the server, so it applies to any caller that
 *      reaches the Server Action, including one that never rendered the form.
 *   3. CHECK constraints in Postgres — the only layer that also applies to a
 *      request made directly against the REST API, bypassing this app entirely.
 *
 * The bounds here are kept deliberately in step with the CHECK constraints in
 * 20260830090000_init_schema.sql. Where they disagree, the database wins and
 * the user gets an unhelpful error, so they are worth keeping aligned.
 */

export const AVAILABILITY_VALUES = [
  "weekday_evenings",
  "weekends",
  "flexible",
] as const;

export const applicationFormSchema = z.object({
  full_name: z
    .string()
    .trim()
    .min(1, "Please enter your full name.")
    .max(120, "Name must be 120 characters or fewer."),

  email: z
    .string()
    .trim()
    .min(1, "Please enter your email address.")
    .max(254, "Email must be 254 characters or fewer.")
    .email("Please enter a valid email address."),

  country: z
    .string()
    .trim()
    .min(1, "Please enter your country.")
    .max(80, "Country must be 80 characters or fewer."),

  time_zone: z
    .string()
    .trim()
    .min(1, "Please select your time zone.")
    .max(64, "Time zone must be 64 characters or fewer."),

  motivation: z
    .string()
    .trim()
    .min(20, "Please write at least 20 characters so we can understand your motivation.")
    .max(4000, "Please keep this under 4000 characters."),

  availability: z.enum(AVAILABILITY_VALUES, {
    // Reached only if someone posts a value outside the enum, i.e. not through
    // the form's radio buttons.
    message: "Please choose one of the listed availability options.",
  }),
});

export type ApplicationFormValues = z.infer<typeof applicationFormSchema>;

/** Field-keyed errors, shaped for rendering next to each input. */
export type FieldErrors = Partial<Record<keyof ApplicationFormValues, string>>;

export function parseApplicationForm(
  formData: FormData,
): { success: true; data: ApplicationFormValues } | { success: false; errors: FieldErrors } {
  const result = applicationFormSchema.safeParse({
    full_name: formData.get("full_name"),
    email: formData.get("email"),
    country: formData.get("country"),
    time_zone: formData.get("time_zone"),
    motivation: formData.get("motivation"),
    availability: formData.get("availability"),
  });

  if (result.success) {
    return { success: true, data: result.data };
  }

  const errors: FieldErrors = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0] as keyof ApplicationFormValues | undefined;
    if (field && !errors[field]) {
      errors[field] = issue.message;
    }
  }
  return { success: false, errors };
}
