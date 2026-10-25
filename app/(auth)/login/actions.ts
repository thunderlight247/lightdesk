"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import { safeRedirectPath } from "@/lib/security/redirect";
import { actionError, type ActionState } from "@/lib/validation/action-state";
import { loginSchema } from "@/lib/validation/schemas";
import { recordAudit } from "@/modules/audit/service";
import { authenticate } from "@/modules/identity/service";
import {
  assertLoginAllowed,
  clearLoginFailuresForEmail,
  clientIpFromHeaders,
  recordLoginFailure,
} from "@/modules/identity/throttle";

export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = loginSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: "Enter your email and password." };
  try {
    // M8 Phase 3: throttle BEFORE any password hashing. Failure floods never reach
    // scrypt, and the check itself records an audited refusal when a budget is exceeded.
    const ip = clientIpFromHeaders(await headers());
    await assertLoginAllowed({ ip, email: parsed.data.email });
    const user = await authenticate(parsed.data.email, parsed.data.password);
    if (!user) {
      await recordLoginFailure({ ip, email: parsed.data.email });
      return { error: "Invalid email or password." };
    }
    await createSession(user.id);
    // Correct credentials are proof in themselves: the email's failure history must not
    // keep a legitimate user locked out after a shared-ip or typo burst.
    await clearLoginFailuresForEmail(parsed.data.email);
    await recordAudit(prisma, { action: "auth.login", actorUserId: user.id });
  } catch (err) {
    return actionError(err);
  }
  redirect(safeRedirectPath(formData.get("next")));
}
