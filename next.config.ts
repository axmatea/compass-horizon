import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  async redirects() {
    return [{ source: "/demo", destination: "/", permanent: false }];
  },
};

export default nextConfig;
