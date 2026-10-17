import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone", // ships only the compiled server + minimal node_modules subset, not the full repo
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${process.env.API_URL ?? "http://localhost:4000"}/:path*` }];
  },
};

export default nextConfig;
