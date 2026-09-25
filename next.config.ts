import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Document and AI routes run on the Node
  // runtime; keep XML/zip libs server-side.
  serverExternalPackages: ["@xmldom/xmldom", "jszip", "pg"],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Defence in depth: the browser may only talk to this
          // origin, so no library can send document data elsewhere.
          {
            key: "Content-Security-Policy",
            value:
              "connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
          },
          {
            key: "Referrer-Policy",
            value: "same-origin",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
