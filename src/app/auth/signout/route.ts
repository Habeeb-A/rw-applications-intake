import { NextResponse, type NextRequest } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * POST only. A GET sign-out route can be fired by a link prefetch, an image
 * tag, or any cross-site request, which makes it a trivial denial-of-service
 * annoyance. Requiring a form POST means it is at least an intentional act.
 */
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
