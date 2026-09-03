"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Set a new password.
 *
 * By the time this renders, /auth/callback has already exchanged the recovery
 * code for a session, so the caller is authenticated as themselves and
 * `updateUser` changes their own password and nobody else's. There is no user
 * id in this form and none is accepted — the identity comes from the session
 * cookie, which is the only thing that could be trusted here anyway.
 */
export function ResetForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (password !== confirm) {
      setError("Those two passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setError("Please choose a password of at least 8 characters.");
      return;
    }

    setPending(true);
    const supabase = createSupabaseBrowserClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setPending(false);

    if (updateError) {
      setError(
        "Could not change the password. The reset link may have expired — request a new one from the login page.",
      );
      return;
    }

    setDone(true);
    // The session is already valid, so there is nowhere to sign in again from.
    // Send them where they were going.
    router.replace("/");
    router.refresh();
  }

  if (done) {
    return (
      <div className="notice info">
        <p>Password changed. Taking you to your application…</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="card">
      <p className="card-label">Choose a new password</p>

      {error ? <div className="notice error"><p>{error}</p></div> : null}

      <div className="field">
        <label htmlFor="password">New password</label>
        <input
          id="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <p className="hint">At least 8 characters.</p>
      </div>

      <div className="field">
        <label htmlFor="confirm">Confirm new password</label>
        <input
          id="confirm"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </div>

      <button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save new password"}
      </button>
    </form>
  );
}
