import { redirect } from "next/navigation";

import { getSessionContext } from "@/lib/auth";

import { LoginForm } from "./login-form";

/**
 * `next` is a caller-supplied redirect target, so it is validated before use.
 * Accepting it unchecked would make this an open redirect: a link to
 * /login?next=https://evil.example would send a freshly authenticated user
 * straight off-site. Only same-origin absolute paths are allowed through.
 */
function safeNextPath(raw: string | undefined): string {
  if (!raw) return "/";
  if (!raw.startsWith("/")) return "/";
  // "//host" and "/\host" are protocol-relative URLs, not local paths.
  if (raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  return raw;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  const nextPath = safeNextPath(params.next);

  // Already signed in? Send them where they were going.
  const session = await getSessionContext();
  if (session) redirect(nextPath);

  return (
    <main className="narrow">
      <h1>Sign in</h1>
      <p className="page-intro">
        Applications for the CBT Lab programme. You need to be signed in to apply
        or to view an application you have already submitted.
      </p>

      {params.error === "auth_failed" ? (
        <div className="notice error">
          That sign-in link did not work. It may have already been used or expired
          — links are single-use and valid for one hour. Please request a new one.
        </div>
      ) : null}

      <LoginForm nextPath={nextPath} />
    </main>
  );
}
