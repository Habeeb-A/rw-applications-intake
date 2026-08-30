/**
 * Types describing the database schema.
 *
 * Hand-maintained to match supabase/migrations/, in the exact shape that
 * `supabase gen types typescript` emits — including `__InternalSupabase` and
 * the per-table `Relationships` arrays. Those are not decoration: supabase-js
 * uses `__InternalSupabase.PostgrestVersion` to pick its overloads, and it
 * resolves embedded selects like `actor:profiles(email)` from `Relationships`.
 * Omitting either makes every `.insert()` argument resolve to `never`, which is
 * a memorably confusing error for what is really a missing property.
 *
 * Regenerate against a live project with:
 *
 *   npx supabase gen types typescript --project-id <ref> > src/lib/database.types.ts
 *
 * The value of typing the client this way is not autocomplete — it is that a
 * column rename in a migration becomes a compile error in every query that
 * touches it, instead of a runtime `undefined` in production.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "12";
  };
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          role: Database["public"]["Enums"]["app_role"];
          created_at: string;
        };
        // No client role holds an INSERT or UPDATE grant on profiles; rows are
        // created by trigger. These shapes exist for the service-role client
        // used by the seed script, which is the only thing that writes here.
        Insert: {
          id: string;
          email: string;
          role?: Database["public"]["Enums"]["app_role"];
          created_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          role?: Database["public"]["Enums"]["app_role"];
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_id_fkey";
            columns: ["id"];
            isOneToOne: true;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      applications: {
        Row: {
          id: string;
          applicant_id: string;
          application_type: Database["public"]["Enums"]["application_type"];
          full_name: string;
          email: string;
          country: string;
          time_zone: string;
          motivation: string;
          availability: Database["public"]["Enums"]["availability_option"];
          status: Database["public"]["Enums"]["application_status"];
          created_at: string;
          updated_at: string;
        };
        // `status` is present but optional, matching what the generated types
        // would say — the database, not TypeScript, is what actually stops a
        // client supplying it (there is no INSERT grant on that column).
        Insert: {
          id?: string;
          applicant_id: string;
          application_type?: Database["public"]["Enums"]["application_type"];
          full_name: string;
          email: string;
          country: string;
          time_zone: string;
          motivation: string;
          availability: Database["public"]["Enums"]["availability_option"];
          status?: Database["public"]["Enums"]["application_status"];
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          applicant_id?: string;
          application_type?: Database["public"]["Enums"]["application_type"];
          full_name?: string;
          email?: string;
          country?: string;
          time_zone?: string;
          motivation?: string;
          availability?: Database["public"]["Enums"]["availability_option"];
          status?: Database["public"]["Enums"]["application_status"];
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "applications_applicant_id_fkey";
            columns: ["applicant_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      application_status_events: {
        Row: {
          id: number;
          application_id: string;
          old_status: Database["public"]["Enums"]["application_status"] | null;
          new_status: Database["public"]["Enums"]["application_status"];
          changed_by: string | null;
          changed_at: string;
        };
        // Written only by trigger; no client role holds an INSERT, UPDATE or
        // DELETE grant. Typed rather than `never` because `never` propagates
        // through supabase-js's conditional types and breaks unrelated queries.
        Insert: {
          application_id: string;
          old_status?: Database["public"]["Enums"]["application_status"] | null;
          new_status: Database["public"]["Enums"]["application_status"];
          changed_by?: string | null;
          changed_at?: string;
        };
        Update: {
          old_status?: Database["public"]["Enums"]["application_status"] | null;
          new_status?: Database["public"]["Enums"]["application_status"];
          changed_by?: string | null;
          changed_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "application_status_events_application_id_fkey";
            columns: ["application_id"];
            isOneToOne: false;
            referencedRelation: "applications";
            referencedColumns: ["id"];
          },
          {
            // This is the one that makes `actor:profiles(email)` resolve.
            foreignKeyName: "application_status_events_changed_by_fkey";
            columns: ["changed_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      is_staff: {
        Args: Record<PropertyKey, never>;
        Returns: boolean;
      };
    };
    Enums: {
      app_role: "applicant" | "staff";
      application_status: "pending" | "accepted" | "rejected" | "waitlisted";
      availability_option: "weekday_evenings" | "weekends" | "flexible";
      application_type: "participant" | "facilitator";
    };
    CompositeTypes: { [_ in never]: never };
  };
};

// ---------------------------------------------------------------------------
// Convenience aliases and display maps used across the app.
// ---------------------------------------------------------------------------

export type AppRole = Database["public"]["Enums"]["app_role"];
export type ApplicationStatus = Database["public"]["Enums"]["application_status"];
export type AvailabilityOption = Database["public"]["Enums"]["availability_option"];
export type ApplicationType = Database["public"]["Enums"]["application_type"];

export type ApplicationRow = Database["public"]["Tables"]["applications"]["Row"];
export type ApplicationInsert = Database["public"]["Tables"]["applications"]["Insert"];
export type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
export type StatusEventRow =
  Database["public"]["Tables"]["application_status_events"]["Row"];

export const APPLICATION_STATUSES: readonly ApplicationStatus[] = [
  "pending",
  "accepted",
  "rejected",
  "waitlisted",
] as const;

export const AVAILABILITY_LABELS: Record<AvailabilityOption, string> = {
  weekday_evenings: "Weekday evenings",
  weekends: "Weekends",
  flexible: "Flexible",
};

export const STATUS_LABELS: Record<ApplicationStatus, string> = {
  pending: "Pending",
  accepted: "Accepted",
  rejected: "Rejected",
  waitlisted: "Waitlisted",
};
