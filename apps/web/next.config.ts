import type { NextConfig } from "next";

const apiInternal = process.env.API_INTERNAL_URL ?? "http://localhost:3001";

const nextConfig: NextConfig = {
  transpilePackages: ["@rag/shared"],
  output: "standalone",
  async rewrites() {
    // Same-origin /api → backend so auth cookies stick (fixes :3000 vs :3001).
    return [
      {
        source: "/api/:path*",
        destination: `${apiInternal}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
