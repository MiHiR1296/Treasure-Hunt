import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    // Don't fail build on type errors during deployment
    ignoreBuildErrors: false,
  },
  eslint: {
    // Don't fail build on lint errors during deployment
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
