import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import type { Database } from "@/lib/database.types";
import { requireEnv } from "@/lib/env";

/**
 * Supabase client for Server Components, Route Handlers and Server Actions.
 *
 * This client carries the *user's* session, taken from cookies, and therefore
 * talks to Postgres as the `authenticated` role with that user's JWT. Every
 * query it makes is subject to Row Level Security. That is the point: there is
 * no server-side client in this application that can see more than the signed-in
 * user is entitled to see.
 *
 * The service-role key — which bypasses RLS entirely — is used only by the
 * scripts in scripts/, which run on a developer's machine. It is never imported
 * into anything that ships to Netlify.
 */
export async function createSupabaseServerClient() {
  // In Next 15 `cookies()` is async.
  const cookieStore = await cookies();

  return createServerClient<Database>(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components may not set cookies. This is expected and safe:
            // the middleware refreshes the session on every request, so a token
            // that could not be written here is written there instead.
          }
        },
      },
    },
  );
}
