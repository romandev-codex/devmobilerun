import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["mongoose", "mongodb", "@hokify/agenda"],
}

export default nextConfig
