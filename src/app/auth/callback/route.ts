import { NextResponse, type NextRequest } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Where a magic link lands.
 *
 * @supabase/ssr uses the PKCE flow, so the emailed link resolves to this route
 * with a `code` query parameter. The code is exchanged here, server-side, for a
 * session that is written to an httpOnly cookie. The token never passes through
 * client-side JavaScript and never appears in a URL fragment the browser might
 * keep in history.
 *
 * `token_hash` is also handled, because Supabase's older email templates (and
 * any project whose template has not been updated) send that form instead. It
 * costs six lines and prevents a class of "the link doesn't work" report that is
 * miserable to diagnose from the outside.
 */

function safeNextPath(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) {
    return "/";
  }
  return raw;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const next = safeNextPath(searchParams.get("next"));

  const supabase = await createSupabaseServerClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type: type as "magiclink" | "email" | "recovery" | "invite" | "signup",
      token_hash: tokenHash,
    });
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }

  // Anything else — missing code, expired link, replayed link — lands back on
  // login with an explanation rather than a stack trace.
  return NextResponse.redirect(`${origin}/login?error=auth_failed`);
}
