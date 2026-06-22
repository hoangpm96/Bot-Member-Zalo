import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 là native module — để Next bundle phía server, không gói vào client.
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
