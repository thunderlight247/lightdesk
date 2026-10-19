"use server";

import { redirect } from "next/navigation";
import { getCurrentUser, createSession } from "@/lib/auth/session";
import { actionError, type ActionState } from "@/lib/validation/action-state";
import { acceptInvitation } from "@/modules/businesses/invitations";

export async function acceptInvitationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let businessId: string;
  try {
    const current = await getCurrentUser();
    const token = String(formData.get("token") ?? "");
    const result = await acceptInvitation({
      token,
      actorUserId: current?.id ?? null,
      registration: current
        ? undefined
        : { name: String(formData.get("name") ?? ""), password: String(formData.get("password") ?? "") },
    });
    if (result.createdUser) await createSession(result.userId);
    businessId = result.businessId;
  } catch (err) {
    return actionError(err);
  }
  redirect(`/businesses/${businessId}`);
}
