/**
 * Environment access with a loud failure mode.
 *
 * A missing Supabase URL should stop the process with a message naming the
 * variable, not surface later as a fetch to the string "undefined". On Netlify
 * this turns a misconfigured deploy into an obvious build/runtime error rather
 * than a login page that silently never works.
 *
 * NEXT_PUBLIC_* values are inlined at build time, so they must be referenced as
 * literal `process.env.NEXT_PUBLIC_...` property accesses somewhere in the
 * bundle — a dynamic `process.env[name]` lookup is not substituted. Hence the
 * explicit map below rather than a generic getter.
 */

const PUBLIC_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
} as const;

export type PublicEnvKey = keyof typeof PUBLIC_ENV;

export function requireEnv(key: PublicEnvKey): string {
  const value = PUBLIC_ENV[key];
  if (!value) {
    throw new Error(
      `Missing environment variable ${key}. ` +
        `Copy .env.example to .env.local for local development, or set it in ` +
        `Netlify under Site configuration → Environment variables. ` +
        `Note that Netlify only picks up new variables on a fresh build, not a redeploy of an existing one.`,
    );
  }
  return value;
}
