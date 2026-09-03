"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Mode = "password" | "magic_link";

export interface DemoAccount {
  role: string;
  name: string;
  email: string;
}

/**
 * Sign-in, with the click-dummy's "choose a demo account" affordance.
 *
 * Two methods, both Supabase Auth, both minting the same session:
 *
 *  - Magic link is what a real applicant would use. No password to choose,
 *    forget, or reuse from another site.
 *
 *  - Password sign-in exists because deliverable 1 asks for test credentials
 *    for a staff user and an applicant user, and credentials that require
 *    access to an inbox are not credentials a reviewer can actually use.
 *
 * The demo cards fill the form in one click. They carry a password only when
 * NEXT_PUBLIC_DEMO_PASSWORD is set — a trial affordance, matching the existing
 * click-dummy, that is off unless deliberately switched on and would not exist
 * in a build serving real applicants. With it unset the cards fill the email
 * and leave the password to be typed.
 */
export function LoginForm({
  nextPath,
  demoAccounts,
  demoPassword,
}: {
  nextPath: string;
  demoAccounts: DemoAccount[];
  demoPassword: string | null;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ kind: "info" | "error"; text: string } | null>(null);

  function choose(account: DemoAccount) {
    setEmail(account.email);
    if (demoPassword) setPassword(demoPassword);
    setPicked(account.email);
    setMode("password");
    setMessage(null);
  }

  async function handlePassword(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage(null);

    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setPending(false);
      setMessage({ kind: "error", text: "Those credentials were not recognised." });
      return;
    }

    // refresh() re-runs the server components against the cookie that now
    // exists, so the redirect target is resolved with the new session.
    router.replace(nextPath);
    router.refresh();
  }

  async function handleMagicLink(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage(null);

    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        // Must be on Supabase's redirect allow-list (Authentication → URL
        // Configuration) or the link bounces to the site root with no session
        // and no error message anywhere.
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`,
      },
    });

    setPending(false);

    if (error) {
      setMessage({ kind: "error", text: error.message });
      return;
    }

    // Deliberately identical whether or not that address has an account.
    // "No account found" would turn this form into a way to enumerate who has
    // applied to a mental-health programme.
    setMessage({
      kind: "info",
      text: "If that address is valid, a sign-in link is on its way. It expires in one hour.",
    });
  }

  return (
    <>
      <div className="demo-cards">
        {demoAccounts.map((account) => (
          <button
            key={account.email}
            type="button"
            className="demo-card"
            aria-pressed={picked === account.email}
            onClick={() => choose(account)}
          >
            <span className="demo-role">{account.role}</span>
            <span className="demo-name">{account.name}</span>
            <span className="demo-mail">{account.email}</span>
          </button>
        ))}
      </div>

      {message ? <div className={`notice ${message.kind}`}><p>{message.text}</p></div> : null}

      {mode === "password" ? (
        <form onSubmit={handlePassword}>
          <div className="auth-fields">
            <div className="field">
              <label htmlFor="email">Email</label>
              <input
                id="email" name="email" type="email" autoComplete="email" required
                value={email} onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                id="password" name="password" type="password"
                autoComplete="current-password" required
                value={password} onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <button type="submit" disabled={pending}>
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M8 1.5l5 2v4c0 3-2.1 5.6-5 6.6-2.9-1-5-3.6-5-6.6v-4l5-2z"
                      stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
              </svg>
              {pending ? "Signing in…" : "Sign in"}
            </button>
          </div>
          <p className="hint" style={{ marginTop: 16 }}>
            <button type="button" className="linkish" onClick={() => { setMode("magic_link"); setMessage(null); }}>
              Email me a sign-in link instead
            </button>
          </p>
        </form>
      ) : (
        <form onSubmit={handleMagicLink}>
          <div className="auth-fields" style={{ gridTemplateColumns: "1fr auto" }}>
            <div className="field">
              <label htmlFor="magic-email">Email</label>
              <input
                id="magic-email" name="email" type="email" autoComplete="email" required
                value={email} onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <button type="submit" disabled={pending}>
              {pending ? "Sending…" : "Send sign-in link"}
            </button>
          </div>
          <p className="hint" style={{ marginTop: 16 }}>
            A single-use link, valid for one hour. No password needed.{" "}
            <button type="button" className="linkish" onClick={() => { setMode("password"); setMessage(null); }}>
              Use a password instead
            </button>
          </p>
        </form>
      )}
    </>
  );
}
