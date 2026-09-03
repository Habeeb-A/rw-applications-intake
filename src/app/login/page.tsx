import { redirect } from "next/navigation";

import { getSessionContext } from "@/lib/auth";

import { LoginForm } from "./login-form";

/**
 * `next` is caller-supplied, so it is validated before use. Accepting it
 * unchecked makes this an open redirect: /login?next=https://evil.example would
 * send a freshly authenticated user straight off-site, with their session
 * already minted. Only same-origin absolute paths pass.
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

  const session = await getSessionContext();
  if (session) redirect(nextPath);

  return (
    <main className="auth-page">
      <div className="auth-shell">
        <div className="auth-brand">
          <span className="brand-mark" aria-hidden="true">CB</span>
          <span>
            <span className="brand-name">CBT Lab</span>
            <span className="brand-sub">Applications intake</span>
          </span>
        </div>

        <h1>Choose your account</h1>
        <p className="page-intro">
          The CBT Lab is a 12-week peer-facilitated group programme: nine
          90-minute sessions in a group of five or six, led by a trained
          facilitator. Applicants sign in here to apply and to follow their
          application; the programme team signs in to review the queue.
        </p>

        {params.error === "auth_failed" ? (
          <div className="notice error">
            <p>
              That sign-in link did not work. Links are single-use and expire,
              so it may already have been used — some mail apps open links to
              preview them, which is enough to spend it. Request a new one, or
              log in with a password instead.
            </p>
          </div>
        ) : null}

        <LoginForm nextPath={nextPath} />
      </div>
    </main>
  );
}
