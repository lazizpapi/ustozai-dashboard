import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /*
   * google-play-scraper stays a runtime require rather than being bundled.
   *
   * It is CommonJS, reaches for its own files at runtime, and carries a large
   * dependency tree that the bundler has no reason to walk. Left to bundle, it
   * is the classic source of a build that succeeds and then fails on the first
   * request in production.
   *
   * Option name checked against node_modules/next/dist/docs on this version:
   * it is serverExternalPackages, not the older
   * experimental.serverComponentsExternalPackages.
   */
  serverExternalPackages: ["google-play-scraper"],
};

export default nextConfig;
