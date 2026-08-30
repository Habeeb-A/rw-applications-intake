import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Fail the production build on a type error rather than shipping one.
  // Both default to false in Next 15; stated explicitly so a future change of
  // default cannot silently weaken the build.
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: false },
};

export default nextConfig;
