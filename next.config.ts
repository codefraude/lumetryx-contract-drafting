import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@xmldom/xmldom", "jszip", "pg"],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
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
