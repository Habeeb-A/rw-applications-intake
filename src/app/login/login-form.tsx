"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Mode = "magic_link" | "password";

/**
 * Two sign-in methods, both Supabase Auth, both producing the same session.
 *
 *  - Magic link is the flow the brief suggests and the one a real applicant
 *    would use: no password to choose, forget, or reuse from another site.
 *
 *  - Password sign-in exists so that this trial can be reviewed. The
 *    deliverables ask for test credentials for a staff user and an applicant
 *    user, and "credentials" that require access to an inbox are not credentials
 *    a reviewer can use. The seed script sets passwords for the four seeded
 *    accounts; every other account is magic-link only.
 *
 * Both paths are equivalent as far as authorisation is concerned. The session
 * they mint is the same, RLS applies identically, and nothing downstream knows
 * or cares which was used.
 */
export function LoginForm({ nextPath }: { nextPath: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ kind: "info" | "error"; text: string } | null>(null);

  async function handleMagicLink(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage(null);

    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        // Must be on Supabase's redirect allow-list (Authentication → URL
        // Configuration), or the link silently bounces to the site root.
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`,
      },
    });

    setPending(false);

    if (error) {
      setMessage({ kind: "error", text: error.message });
      return;
    }

    // Deliberately the same message whether or not that address has an account.
    // Saying "no account found" would turn this form into a way to enumerate
    // who has applied — which, for a mental-health programme, is exactly the
    // kind of thing not to leak.
    setMessage({
      kind: "info",
      text: "If that address is valid, a sign-in link is on its way. It expires in one hour.",
    });
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

    // refresh() re-runs the server components with the new auth cookie, so the
    // redirect target is evaluated against the session that now exists.
    router.replace(nextPath);
    router.refresh();
  }

  return (
    <div className="card">
      {message ? <div className={`notice ${message.kind}`}>{message.text}</div> : null}

      {mode === "password" ? (
        <form onSubmit={handlePassword}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button type="submit" disabled={pending}>
            {pending ? "Signing in…" : "Sign in"}
          </button>
          <p className="hint" style={{ marginTop: 14 }}>
            <button type="button" className="linkish" onClick={() => setMode("magic_link")}>
              Email me a sign-in link instead
            </button>
          </p>
        </form>
      ) : (
        <form onSubmit={handleMagicLink}>
          <div className="field">
            <label htmlFor="magic-email">Email</label>
            <input
              id="magic-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <p className="hint">
              We&rsquo;ll send a single-use link. No password needed.
            </p>
          </div>
          <button type="submit" disabled={pending}>
            {pending ? "Sending…" : "Send sign-in link"}
          </button>
          <p className="hint" style={{ marginTop: 14 }}>
            <button type="button" className="linkish" onClick={() => setMode("password")}>
              Use a password instead
            </button>
          </p>
        </form>
      )}
    </div>
  );
}
