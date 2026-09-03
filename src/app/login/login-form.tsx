"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Sign-in, sign-up, magic link and password reset, for both audiences.
 *
 * ---------------------------------------------------------------------------
 * The audience toggle is presentation only — read this before changing it
 *
 * The README explains why this app has no role switcher: the role lives in
 * `profiles`, every RLS policy reads it, and a control that changed it would
 * either be a lie or a privilege-escalation hole.
 *
 * This toggle is not that. It chooses which panel renders and nothing else.
 * Both panels call the same Supabase Auth methods and mint the same kind of
 * session. What the resulting user may read is decided afterwards, server-side,
 * by a database read of `profiles` and by the policies. An applicant who signs
 * in through the Staff panel gets an applicant's session and is bounced from
 * /dashboard by requireStaff() exactly as if they had used the other panel.
 *
 * So the toggle is a signpost, not a permission. It exists because applicants
 * and reviewers arrive here for different reasons and need different forms —
 * staff never sign themselves up, because nothing in the deployed application
 * can grant the staff role.
 *
 * ---------------------------------------------------------------------------
 * Four ways in, and why each exists
 *
 *  - Password sign-in: what a reviewer holding handed-over test credentials uses.
 *  - Sign-up: applicants only. A new account always lands as `applicant`,
 *    because the role comes from the column default and there is no code path
 *    anywhere in this application that writes `profiles.role`.
 *  - Magic link: for an applicant returning to an account they already have
 *    without having to remember a password.
 *  - Forgot password: the ordinary reset flow, back through /auth/callback.
 */

type Audience = "applicant" | "staff";
type Mode = "password" | "signup" | "magic_link" | "forgot";

interface Notice {
  kind: "info" | "error";
  text: string;
}

export function LoginForm({ nextPath }: { nextPath: string }) {
  const router = useRouter();
  const [audience, setAudience] = useState<Audience>("applicant");
  const [mode, setMode] = useState<Mode>("password");

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const origin = typeof window === "undefined" ? "" : window.location.origin;

  function chooseAudience(next: Audience) {
    setAudience(next);
    // Staff never sign themselves up, so a staff panel offering a sign-up tab
    // would advertise something that cannot work. Reset to the form that does.
    if (next === "staff") setMode("password");
    setNotice(null);
  }

  function chooseMode(next: Mode) {
    setMode(next);
    setNotice(null);
  }

  async function handlePassword(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setNotice(null);

    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setPending(false);
      setNotice({ kind: "error", text: "Those credentials were not recognised." });
      return;
    }

    // refresh() re-runs the server components against the cookie that now
    // exists, so the redirect target is resolved with the new session.
    router.replace(nextPath);
    router.refresh();
  }

  async function handleSignup(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setNotice(null);

    const supabase = createSupabaseBrowserClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        // Stored on the auth user, not in a table. The application form reads
        // it to pre-fill the name field; nothing authorises off it.
        data: { full_name: fullName.trim() },
        emailRedirectTo: origin + "/auth/callback?next=" + encodeURIComponent(nextPath),
      },
    });

    if (error) {
      setPending(false);
      // Deliberately not "that email is already registered". This form would
      // otherwise report who holds an account on a mental-health programme.
      setNotice({
        kind: "error",
        text: "That email cannot be used to create a new account. If you already have one, log in or request a sign-in link.",
      });
      return;
    }

    // With email confirmation switched off, signUp returns a live session and
    // the applicant goes straight to the form. With it on there is no session
    // yet, and the only honest thing to do is send them to their inbox.
    if (data.session) {
      router.replace(nextPath);
      router.refresh();
      return;
    }

    setPending(false);
    setNotice({
      kind: "info",
      text: "Account created. Check your email for a confirmation link, then log in.",
    });
  }

  async function handleMagicLink(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setNotice(null);

    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        // Must be on Supabase's redirect allow-list (Authentication → URL
        // Configuration) or the link bounces to the site root with no session
        // and no error message anywhere.
        emailRedirectTo: origin + "/auth/callback?next=" + encodeURIComponent(nextPath),
      },
    });

    setPending(false);

    if (error) {
      setNotice({
        kind: "error",
        text: "Could not send a sign-in link just now. These are rate-limited, so if you requested one in the last few minutes, wait a little and try again — or use a password instead.",
      });
      return;
    }

    // Deliberately identical whether or not that address has an account.
    setNotice({
      kind: "info",
      text: "If that address is valid, a sign-in link is on its way. Open it in this same browser: the link is single-use, and some mail apps consume it by previewing.",
    });
  }

  async function handleForgot(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setNotice(null);

    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: origin + "/auth/callback?next=" + encodeURIComponent("/auth/reset"),
    });

    setPending(false);

    if (error) {
      setNotice({
        kind: "error",
        text: "Could not send a reset link just now. These are rate-limited; please wait a few minutes and try again.",
      });
      return;
    }

    // Same non-committal wording as the magic link, for the same reason.
    setNotice({
      kind: "info",
      text: "If that address has an account, a password reset link is on its way.",
    });
  }

  const isApplicant = audience === "applicant";

  const heading =
    mode === "signup"
      ? "Create an account"
      : mode === "forgot"
        ? "Reset password"
        : mode === "magic_link"
          ? "Email me a link"
          : "Log in";

  const submitLabel =
    mode === "signup"
      ? "Create account"
      : mode === "magic_link"
        ? "Send sign-in link"
        : mode === "forgot"
          ? "Send reset link"
          : "Log in";

  const onSubmit =
    mode === "signup"
      ? handleSignup
      : mode === "magic_link"
        ? handleMagicLink
        : mode === "forgot"
          ? handleForgot
          : handlePassword;

  return (
    <>
      {/* Not role="tablist": these swap a whole panel of forms, each with its
          own submit, rather than tab contents. A group with aria-pressed
          describes what it actually is. */}
      <div className="audience-toggle" role="group" aria-label="Who is signing in">
        <button
          type="button"
          className={"audience-option" + (isApplicant ? " is-active" : "")}
          aria-pressed={isApplicant}
          onClick={() => chooseAudience("applicant")}
        >
          Applicant
        </button>
        <button
          type="button"
          className={"audience-option" + (!isApplicant ? " is-active" : "")}
          aria-pressed={!isApplicant}
          onClick={() => chooseAudience("staff")}
        >
          Staff
        </button>
      </div>

      <div className="login-card">
        <div className="login-card-head">
          <span className="login-card-title">{heading}</span>
          <span className="login-card-who">{isApplicant ? "Applicant" : "Staff reviewer"}</span>
        </div>

        <div className="login-card-body">
          <p className="login-blurb">
            {isApplicant
              ? "Apply to the CBT Lab, or sign in to check the status of an application you have already sent."
              : "Reviewer access to the applications queue. Staff accounts are created by the programme team; there is no self sign-up."}
          </p>

          {notice ? (
            <div className={"notice " + notice.kind}>
              <p>{notice.text}</p>
            </div>
          ) : null}

          <form onSubmit={onSubmit}>
            {mode === "signup" ? (
              <div className="field">
                <label htmlFor="full_name">Full name</label>
                <input
                  id="full_name"
                  name="full_name"
                  type="text"
                  autoComplete="name"
                  maxLength={120}
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                />
              </div>
            ) : null}

            <div className="field">
              <label htmlFor="email">Email address</label>
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

            {mode === "password" || mode === "signup" ? (
              <div className="field">
                <label htmlFor="password">Password</label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  minLength={mode === "signup" ? 8 : undefined}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                {mode === "signup" ? (
                  <p className="hint">At least 8 characters.</p>
                ) : (
                  <p className="hint">
                    <button type="button" className="linkish" onClick={() => chooseMode("forgot")}>
                      Forgot password?
                    </button>
                  </p>
                )}
              </div>
            ) : null}

            <button type="submit" className="login-submit" disabled={pending}>
              {pending ? "Working…" : submitLabel}
            </button>
          </form>

          <div className="login-alts">
            {mode !== "password" ? (
              <button type="button" className="linkish" onClick={() => chooseMode("password")}>
                Back to log in
              </button>
            ) : null}

            {isApplicant && mode !== "magic_link" ? (
              <button type="button" className="linkish" onClick={() => chooseMode("magic_link")}>
                Email me a sign-in link
              </button>
            ) : null}

            {isApplicant && mode !== "signup" ? (
              <button type="button" className="linkish" onClick={() => chooseMode("signup")}>
                New here? Create an account
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}
