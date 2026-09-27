import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  async headers() {
    return [
      {
        // The cafe's own QR pages may be embedded in nothing, but a bookmarked
        // or installed copy should never be framed or sniffed.
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            // The staff board uses vibration for the new-order alert; nothing
            // else is needed, so everything else is denied.
            value: "geolocation=(), microphone=(), camera=(), payment=()",
          },
        ],
      },
      {
        // The service worker must never be cached, or a stale one can pin an
        // old app shell on the counter phone indefinitely.
        source: "/sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [{ key: "Cache-Control", value: "public, max-age=3600" }],
      },
    ];
  },
};

export default nextConfig;
