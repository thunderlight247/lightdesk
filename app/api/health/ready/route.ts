import { prisma } from "@/lib/db/client";

export const dynamic = "force-dynamic";

type HealthCheckItem = {
  status: "ok" | "degraded" | "error";
  latencyMs?: number;
  message?: string;
};

/**
 * Deep readiness probe for Kubernetes / Cloudflare health monitors.
 * Verifies:
 * 1. Database connectivity and query execution.
 * 2. Presence of critical encryption keys in environment.
 *
 * Invariant: Never reveals secret values, keys, or internal stack traces.
 */
export async function GET() {
  const start = Date.now();
  const checks: Record<string, HealthCheckItem> = {};
  let isReady = true;

  // 1. Database check: test actual query round-trip
  try {
    const dbStart = Date.now();
    await prisma.$queryRawUnsafe("SELECT 1");
    checks.database = {
      status: "ok",
      latencyMs: Date.now() - dbStart,
    };
  } catch {
    isReady = false;
    checks.database = {
      status: "error",
      message: "Database unreachable",
    };
  }

  // 2. Encryption key check
  const encryptionKey = process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY;
  if (!encryptionKey || encryptionKey.length < 32) {
    checks.encryption = {
      status: "degraded",
      message: "WHATSAPP_TOKEN_ENCRYPTION_KEY missing or short",
    };
  } else {
    checks.encryption = { status: "ok" };
  }

  const overallStatus = isReady ? "ready" : "unhealthy";
  const statusCode = isReady ? 200 : 503;

  return Response.json(
    {
      status: overallStatus,
      totalLatencyMs: Date.now() - start,
      checks,
      timestamp: new Date().toISOString(),
    },
    {
      status: statusCode,
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    },
  );
}
