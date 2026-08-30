import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import type { Database } from "@/lib/database.types";

/**
 * Session refresh, and a first-pass redirect for signed-out visitors.
 *
 * Read this carefully, because the security model depends on what this file
 * is NOT.
 *
 * Middleware here does two things:
 *   1. Refreshes the Supabase auth cookie so a valid session does not expire
 *      mid-visit. Server Components cannot write cookies, so this is the only
 *      place the refreshed token can be persisted.
 *   2. Bounces an unauthenticated visitor to /login, so they see a login page
 *      instead of a flash of an empty dashboard.
 *
 * The second point is a convenience, not a security boundary. Middleware is
 * emphatically NOT where authorisation happens in this application, for two
 * reasons:
 *
 *   - Next.js has had a recurring class of middleware-bypass advisories
 *     (CVE-2025-29927 and several follow-ups) in which a crafted request skips
 *     middleware entirely. Any app that gated access here alone was exposed.
 *   - Middleware sees a request, not a query. Even a correct middleware cannot
 *     constrain what rows a later query returns.
 *
 * So every protected page independently re-checks the user server-side, and
 * beneath that, Row Level Security constrains the data regardless of what any
 * layer of application code believes. If this file were deleted entirely, no
 * applicant could read another applicant's data and no non-staff user could
 * read the dashboard's data — they would simply get uglier empty pages.
 */

/** Paths reachable without a session. Everything else requires one. */
const PUBLIC_PATHS = ["/login", "/auth/callback", "/auth/signout"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          supabaseResponse = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            supabaseResponse.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // getUser(), not getSession(). getSession() reads the cookie and trusts it;
  // getUser() revalidates the token against the Auth server. On a path that
  // decides whether to let a request through, the difference matters.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (!user && !isPublicPath(pathname)) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    // Preserve where they were heading so login can return them there.
    redirectUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(redirectUrl);
  }

  // The response object must be returned as-is (rather than a fresh
  // NextResponse) so the refreshed auth cookies survive. Constructing a new
  // response here is the single most common cause of users being logged out at
  // random intervals in @supabase/ssr apps.
  return supabaseResponse;
}
