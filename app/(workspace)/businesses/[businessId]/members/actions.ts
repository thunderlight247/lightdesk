"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/guards";
import { AppError } from "@/lib/security/errors";
import { actionError, type ActionState } from "@/lib/validation/action-state";
import { businessIdSchema, parseOrThrow } from "@/lib/validation/schemas";
import { buildInviteLink, createInvitation, revokeInvitation } from "@/modules/businesses/invitations";

export async function createInvitationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    const businessId = parseOrThrow(businessIdSchema, formData.get("businessId"));
    const inv = await createInvitation(user.id, businessId, {
      email: formData.get("email"),
      role: formData.get("role"),
    });
    revalidatePath(`/businesses/${businessId}/members`);
    return { ok: true, inviteLink: buildInviteLink(inv.token) };
  } catch (err) {
    return actionError(err);
  }
}

export async function revokeInvitationAction(formData: FormData): Promise<void> {
  try {
    const user = await requireUser();
    const businessId = parseOrThrow(businessIdSchema, formData.get("businessId"));
    const invitationId = String(formData.get("invitationId") ?? "");
    await revokeInvitation(user.id, businessId, invitationId);
    revalidatePath(`/businesses/${businessId}/members`);
  } catch (err) {
    if (!(err instanceof AppError)) throw err;
  }
}
