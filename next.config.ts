import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * agent0-sdk (ERC-8004) pulls in helia -> libp2p -> webrtc, which ships a
   * native .node binary. The bundler can't place that in an ESM chunk, so
   * `next build` dies with "non-ecmascript placeable asset" even though
   * `next dev` is happy. Keeping it external leaves it as a runtime require
   * on the server instead of trying to bundle it.
   *
   * Without this, the production build fails and Vercel deploys fail with it.
   */
  serverExternalPackages: ["agent0-sdk", "helia", "@libp2p/webrtc"],
};

export default nextConfig;
