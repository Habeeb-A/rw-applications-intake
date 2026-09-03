import type { Metadata } from "next";

import { getSessionContext } from "@/lib/auth";

import { Shell } from "./shell";

import "./globals.css";

/**
 * Typography note: no webfont.
 *
 * `next/font/google` was the first choice — it self-hosts the file and avoids a
 * third-party origin at runtime. But it fetches the font from Google *at build
 * time*, which turns every deploy into something that can fail for a reason
 * unrelated to this codebase. The brief already warns that Netlify deployment
 * is fiddly, and a failed font fetch fails the whole build.
 *
 * The system stack in globals.css gets a geometric grotesque on every platform
 * the reviewers are plausibly using, at zero bytes and zero build risk. If this
 * became a real product I would self-host the woff2 in /public and declare it
 * with @font-face, which has neither problem.
 */

export const metadata: Metadata = {
  title: "CBT Lab — Applications",
  description:
    "Applications intake for the Rethink Wellbeing CBT Lab. Trial build; synthetic data only.",
  // This holds real-shaped (if synthetic) applicant records. Nothing here
  // should turn up in a search index.
  robots: { index: false, follow: false },
};

function initials(email: string): string {
  const name = email.split("@")[0] ?? "";
  const parts = name.split(/[._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

/**
 * The shell reads the session on the server for every render, so the rail can
 * never display a role the server has not just confirmed against the database.
 *
 * Note what this shell deliberately does NOT copy from the click-dummy: its
 * P / F / S role switcher. That prototype stores its role in local storage, so
 * switching is free. Here the role lives in `profiles` and every policy reads
 * it, so a switcher would either be a lie or a privilege-escalation hole. The
 * role is shown as a badge instead.
 */
export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await getSessionContext();

  // Signed out (login, auth callback): render the page bare, no rail.
  if (!session) {
    return (
      <html lang="en">
        <body>{children}</body>
      </html>
    );
  }

  const isStaff = session.role === "staff";

  return (
    <html lang="en">
      <body>
        <Shell
          rail={
            <>
            <a className="brand" href="/">
              <span className="brand-mark" aria-hidden="true">CB</span>
              <span>
                <span className="brand-name">CBT Lab</span>
                <span className="brand-sub">
                  {isStaff ? "Applications review" : "Applicant workspace"}
                </span>
              </span>
            </a>

            <nav className="rail-nav" aria-label="Sections">
              {isStaff ? (
                <a className="rail-link" href="/dashboard" aria-current="page">
                  <svg width="17" height="17" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <rect x="1.5" y="1.5" width="5" height="5" rx="1.4" stroke="currentColor" strokeWidth="1.4"/>
                    <rect x="9.5" y="1.5" width="5" height="5" rx="1.4" stroke="currentColor" strokeWidth="1.4"/>
                    <rect x="1.5" y="9.5" width="5" height="5" rx="1.4" stroke="currentColor" strokeWidth="1.4"/>
                    <rect x="9.5" y="9.5" width="5" height="5" rx="1.4" stroke="currentColor" strokeWidth="1.4"/>
                  </svg>
                  Applications
                </a>
              ) : (
                <a className="rail-link" href="/" aria-current="page">
                  <svg width="17" height="17" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M3.5 1.5h6l3 3v10h-9z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
                    <path d="M9.5 1.5v3h3M5.5 8.5h5M5.5 11h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                  </svg>
                  Your application
                </a>
              )}
            </nav>

            <div className="rail-foot">
              <div className="who">
                <span className="avatar" aria-hidden="true">{initials(session.email)}</span>
                <span>
                  <span className="who-name" title={session.email}>{session.email}</span>
                  <span className="who-role">Signed in</span>
                </span>
              </div>

              <span className="role-badge">
                {isStaff ? "Staff" : "Applicant"}
              </span>

              {/* POST, not a link: signing out changes state, and a GET route
                  for it can be fired by a prefetch or a cross-site request. */}
              <form action="/auth/signout" method="post">
                <button type="submit" className="signout-btn">Sign out</button>
              </form>
            </div>
            </>
          }
        >
          {children}
        </Shell>
      </body>
    </html>
  );
}
