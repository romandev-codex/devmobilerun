import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  serverExternalPackages: ["mongoose", "mongodb", "@hokify/agenda"],
}

export default nextConfig
