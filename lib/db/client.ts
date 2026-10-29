import { PrismaClient } from "@/lib/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * Postgres connectivity per ADR 0011 (Neon via Hyperdrive on Cloudflare).
 *
 * Every runtime reaches Postgres through the `@prisma/adapter-pg` driver adapter — the
 * client is generated engine-less (`prisma generate --no-engine`) because the plain
 * prisma-client-js Query Engine cannot exist in workerd, even with `nodejs_compat`
 * (verified live: the engine lookup is where the request dies, adapter notwithstanding).
 *
 * - Deployed Worker: the connection string comes from the `HYPERDRIVE` binding, which is
 *   part of the Cloudflare request context (AsyncLocalStorage) — set only *while a
 *   request is handled*, not while route modules are merely imported. So the client is
 *   created lazily: the exported `prisma` is a Proxy that forwards everything to a client
 *   built on first property access, which happens inside a request on the worker and at
 *   any time in plain Node.
 * - Plain Node (`next dev` without the wrapper, vitest, CLI scripts): the connection
 *   string is `DATABASE_URL` exactly as before.
 *
 * Caveats carried from the M7 evaluation (docs/m8-cloudflare-deploy-checklist.md §4):
 * risk #2 (module-level client reused across requests under Hyperdrive) is re-verified
 * empirically by the deploy acceptance checks — if a second sequential request hangs,
 * switch to per-request client creation per Cloudflare's Prisma-on-Workers guidance.
 */
function buildClient(connectionString: string | undefined): PrismaClient {
  if (!connectionString) {
    throw new Error(
      "[db/client] no Postgres connection string available: expected HYPERDRIVE binding in the Worker runtime or DATABASE_URL in plain Node",
    );
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

function connectionForRuntime(): { connectionString?: string; worker: boolean } {
  try {
    const env = getCloudflareContext().env as {
      HYPERDRIVE?: { connectionString?: string };
    };
    // A missing binding inside a real worker request is a deploy misconfiguration; the
    // DATABASE_URL secret still lets the app run degraded instead of crashing on boot.
    if (env?.HYPERDRIVE?.connectionString) {
      return { connectionString: env.HYPERDRIVE.connectionString, worker: true };
    }
    console.error("[db/client] HYPERDRIVE binding unavailable — falling back to DATABASE_URL");
    return { connectionString: process.env.DATABASE_URL, worker: true };
  } catch {
    // Plain Node: `next dev` without the wrapper, vitest, tsx CLI scripts, build workers.
    return { connectionString: process.env.DATABASE_URL, worker: false };
  }
}

function createClient(): PrismaClient {
  const { connectionString } = connectionForRuntime();
  return buildClient(connectionString);
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Worker: one client per request. A module-level client reused across requests hung on
// the second request under Hyperdrive (workerd cancelled it as "hung"), so the worker
// never shares a client between requests.
const requestClients = new WeakMap<object, PrismaClient>();

function resolveClient(): PrismaClient {
  const { worker } = connectionForRuntime();
  if (worker) {
    const key = getCloudflareContext().ctx as unknown as object;
    let perRequest = requestClients.get(key);
    if (!perRequest) {
      perRequest = createClient();
      requestClients.set(key, perRequest);
    }
    return perRequest;
  }
  // Plain Node keeps the dev/HMR singleton behaviour the app has always had.
  return (globalForPrisma.prisma ??= createClient());
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    if (prop === "then") return undefined; // `await prisma` must not resolve as thenable
    const instance = resolveClient();
    const value = Reflect.get(instance, prop, instance);
    // Bind top-level methods so their internal `this` is the real client even when
    // invoked through the proxy (model delegates are plain objects and forward fine).
    return typeof value === "function" ? value.bind(instance) : value;
  },
  has(_target, prop) {
    return Reflect.has(resolveClient(), prop);
  },
  set(_target, prop, value) {
    return Reflect.set(resolveClient(), prop, value);
  },
});
