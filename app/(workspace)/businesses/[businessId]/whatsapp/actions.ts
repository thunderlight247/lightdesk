"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/guards";
import { actionError, type ActionState } from "@/lib/validation/action-state";
import { businessIdSchema, parseOrThrow } from "@/lib/validation/schemas";
import { sendOwnerReply, setConversationMode } from "@/modules/whatsapp/service";

export async function sendWhatsAppReplyAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    const businessId = parseOrThrow(businessIdSchema, formData.get("businessId"));
    const conversationId = String(formData.get("conversationId") ?? "");
    const text = formData.get("text");
    const result = await sendOwnerReply(user.id, businessId, conversationId, { text });
    revalidatePath(`/businesses/${businessId}/whatsapp`);
    revalidatePath(`/businesses/${businessId}/whatsapp/${conversationId}`);
    if (!result.sent) return { error: result.reason };
    return {
      ok: true,
      message: `Message sent. ${result.meterUsed} of 1,000 free service messages used this month.`,
    };
  } catch (err) {
    return actionError(err);
  }
}

// M6c: owner-controlled AI assistance. OWNER_ONLY -> AI_ASSIST = "hand back to AI",
// AI_ASSIST -> OWNER_ONLY = takeover. Owner/admin only, audited; the AI never toggles it.
export async function setWhatsAppConversationModeAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    const businessId = parseOrThrow(businessIdSchema, formData.get("businessId"));
    const conversationId = String(formData.get("conversationId") ?? "");
    const mode = formData.get("mode");
    const result = await setConversationMode(user.id, businessId, conversationId, { mode });
    revalidatePath(`/businesses/${businessId}/whatsapp`);
    revalidatePath(`/businesses/${businessId}/whatsapp/${conversationId}`);
    if (!result.changed) return { ok: true, message: "The conversation is already in this mode." };
    return {
      ok: true,
      message: mode === "AI_ASSIST"
        ? "AI assistance enabled. Incoming texts get a draft for you to review; nothing is ever sent without your approval."
        : "You have taken over. New messages will not be drafted by the AI; any pending draft is marked superseded.",
    };
  } catch (err) {
    return actionError(err);
  }
}
