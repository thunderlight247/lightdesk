import type { NextConfig } from "next";
import path from "node:path";

const isProd = process.env.NODE_ENV === "production";

/**
 * M8 Phase 3 edge hardening: a strict-by-default CSP plus the baseline hardening
 * headers for every response. CSP needs:
 * - 'unsafe-inline' scripts: Next.js App Router hydration bootstraps are inline
 *   (a nonce-based CSP would need middleware rewrite work — revisit under Next 16);
 * - connect.facebook.net / www.facebook.com: Meta's Embedded Signup SDK (M6d),
 *   loaded from components/whatsapp/connection-settings.tsx;
 * - 'unsafe-eval' in development only (Next dev tooling).
 * Invitation tokens travel in URLs, hence the existing no-referrer policy below.
 */
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data: https://www.facebook.com",
  "style-src 'self' 'unsafe-inline'",
  `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"} https://connect.facebook.net https://www.facebook.com`,
  "connect-src 'self' https://connect.facebook.net https://www.facebook.com",
  "frame-src https://www.facebook.com",
  "font-src 'self' data:",
].join("; ");

const config: NextConfig = {
  poweredByHeader: false,
  webpack(config, { isServer }) {
    if (isServer) {
      // Preserve Prisma's generated `?module` wasm import verbatim as a webpack
      // external (`import <abs-path>?module`): the OpenNext build passes it through to
      // wrangler, whose CompiledWasm collector turns it into a real WASM module import
      // in the bundled worker (verified live: .next/server/... module 11754 →
      // .open-next worker wasm binding, docs/m8-cloudflare-deploy-checklist.md §5).
      // Called ~once per compiled route; idempotent.
      config.experiments = { ...config.experiments, asyncWebAssembly: true };
      config.module.rules.push({
        test: /\.wasm$/,
        resourceQuery: /module/i,
        type: "webassembly/async",
      });
      // Externals: workerd has no usable `path` module through the OpenNext patch —
      // keep it commonjs-per-request while preserving Next's existing externals.
      config.externals = [
        (
          { context, request }: { context?: string; request?: string },
          callback: (error?: Error | null, result?: string) => void,
        ) => {
          if (request && context && /\.wasm\?module$/.test(request)) {
            // Point every route at the one source wasm, so wrangler bundles a real file.
            const [file, query] = request.split("?");
            const abs = path.resolve(context, file);
            callback(null, `import ${abs}?${query}`);
            return;
          }
          if (request === "path") {
            callback(null, "commonjs path");
            return;
          }
          callback();
        },
        ...(Array.isArray(config.externals) ? config.externals : [config.externals].filter(Boolean)),
      ];
    }
    return config;
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: CSP },
          // Production serves over HTTPS (dev runs on http, where HSTS is skipped).
          ...(isProd ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
          // Invitation tokens travel in URLs: never leak them via Referer.
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      { source: "/invite/:path*", headers: [{ key: "Cache-Control", value: "no-store" }] },
    ];
  },
};

export default config;

import('@opennextjs/cloudflare').then(m => m.initOpenNextCloudflareForDev());
