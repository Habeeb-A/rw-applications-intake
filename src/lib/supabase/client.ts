"use client";

import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "@/lib/database.types";
import { requireEnv } from "@/lib/env";

/**
 * Supabase client for the browser.
 *
 * Used only for authentication (requesting a magic link, password sign-in).
 * All application data is read and written from the server, so the browser
 * never queries `applications` directly — but note that this would be safe even
 * if it did, because the anon key grants nothing that RLS does not allow. The
 * key is public by design.
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient<Database>(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  );
}
