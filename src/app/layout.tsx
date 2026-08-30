import type { Metadata } from "next";

import { getSessionContext } from "@/lib/auth";

import "./globals.css";

export const metadata: Metadata = {
  title: "CBT Lab — Applications",
  description:
    "Applications intake for the Rethink Wellbeing CBT Lab. Trial build; synthetic data only.",
  robots: { index: false, follow: false },
};

/**
 * The header reads the session server-side on every render rather than
 * receiving it as a prop from a client component. Slightly more work per
 * request, but it means the UI can never show a role the server has not just
 * confirmed.
 */
export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await getSessionContext();

  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div className="site-header-inner">
            <a className="brand" href="/">
              CBT Lab <span>· Applications</span>
            </a>
            {session ? (
              <div className="session-info">
                <span>
                  {session.email}
                  {session.role === "staff" ? " · staff" : ""}
                </span>
                {session.role === "staff" ? <a href="/dashboard">Dashboard</a> : null}
                {/* A POST, not a link: signing out is a state change, and a
                    GET route for it can be triggered by a prefetch. */}
                <form action="/auth/signout" method="post">
                  <button type="submit" className="linkish">
                    Sign out
                  </button>
                </form>
              </div>
            ) : null}
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
