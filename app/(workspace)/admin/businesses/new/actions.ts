"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/guards";
import { actionError, type ActionState } from "@/lib/validation/action-state";
import { buildInviteLink } from "@/modules/businesses/invitations";
import { createBusinessWithOwnerInvitation } from "@/modules/businesses/service";

export async function createBusinessAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    const { invitation } = await createBusinessWithOwnerInvitation(user.id, {
      name: formData.get("name"),
      ownerEmail: formData.get("ownerEmail"),
    } as { name: string; ownerEmail: string });
    revalidatePath("/admin/businesses/new");
    return { ok: true, inviteLink: buildInviteLink(invitation.token) };
  } catch (err) {
    return actionError(err);
  }
}
