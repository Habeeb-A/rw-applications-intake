import { requireUser } from "@/lib/auth";

import { ResetForm } from "./reset-form";

/**
 * Where a password-reset link lands, after /auth/callback has turned the
 * recovery code into a session.
 *
 * requireUser() rather than a public page: arriving here without a session
 * means the link was never valid, already spent, or expired, and the only
 * useful destination then is the login page — which is exactly where
 * requireUser sends them.
 */
export const dynamic = "force-dynamic";

export default async function ResetPasswordPage() {
  await requireUser("/auth/reset");

  return (
    <main className="main narrow">
      <p className="eyebrow">Account · CBT Lab</p>

      <div className="hero">
        <p className="hero-eyebrow">Password reset</p>
        <h1>Set a new password</h1>
        <p className="hero-lede">
          You followed a reset link, so you are signed in already. Choose a new
          password and we will take you back to your application.
        </p>
      </div>

      <ResetForm />
    </main>
  );
}
