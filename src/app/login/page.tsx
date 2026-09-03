import { redirect } from "next/navigation";

import { getSessionContext } from "@/lib/auth";

import { LoginForm, type DemoAccount } from "./login-form";

/**
 * The accounts the seed script creates. Listed here so a reviewer can sign in
 * as either role in one click, which is what deliverable 1 actually needs.
 */
const DEMO_ACCOUNTS: DemoAccount[] = [
  { role: "Applicant", name: "Amara Nwosu", email: "applicant.one@cbtlab.test" },
  { role: "Staff reviewer", name: "Reviewer One", email: "reviewer.one@cbtlab.test" },
];

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
      <div className="auth-card">
        <div className="auth-brand">
          <span className="brand-mark" aria-hidden="true">CB</span>
          <span>
            <span className="brand-name">CBT Lab</span>
            <span className="brand-sub">Applications intake</span>
          </span>
        </div>

        <h1>Choose a demo account</h1>
        <p className="page-intro" style={{ marginBottom: 0 }}>
          Each account is a real Supabase Auth user. What it can read and change
          is decided by Row Level Security policies in the database, not by this
          page.
        </p>

        {params.error === "auth_failed" ? (
          <div className="notice error" style={{ marginTop: 24, marginBottom: 0 }}>
            <p>
              That sign-in link did not work. Links are single-use and valid for
              one hour, so it may have already been used or expired. Please
              request a new one.
            </p>
          </div>
        ) : null}

        <LoginForm
          nextPath={nextPath}
          demoAccounts={DEMO_ACCOUNTS}
          demoPassword={process.env.NEXT_PUBLIC_DEMO_PASSWORD ?? null}
        />
      </div>
    </main>
  );
}
