"use server";

import { redirect } from "next/navigation";
import { createSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import { safeRedirectPath } from "@/lib/security/redirect";
import { actionError, type ActionState } from "@/lib/validation/action-state";
import { loginSchema } from "@/lib/validation/schemas";
import { recordAudit } from "@/modules/audit/service";
import { authenticate } from "@/modules/identity/service";

export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = loginSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: "Enter your email and password." };
  try {
    const user = await authenticate(parsed.data.email, parsed.data.password);
    if (!user) return { error: "Invalid email or password." };
    await createSession(user.id);
    await recordAudit(prisma, { action: "auth.login", actorUserId: user.id });
  } catch (err) {
    return actionError(err);
  }
  redirect(safeRedirectPath(formData.get("next")));
}
