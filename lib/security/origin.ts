import { getEnv } from "@/lib/env";
import { ForbiddenError } from "@/lib/security/errors";

/** CSRF defence in depth for cookie-authenticated mutating route handlers. */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(getEnv().APP_URL).origin) {
    throw new ForbiddenError("Cross-origin request rejected");
  }
}
