"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/guards";
import { actionError, type ActionState } from "@/lib/validation/action-state";
import { businessIdSchema, parseOrThrow } from "@/lib/validation/schemas";
import { cancelQueuedSend, sendOwnerReply, setConversationMode } from "@/modules/whatsapp/service";

export async function sendWhatsAppReplyAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    const businessId = parseOrThrow(businessIdSchema, formData.get("businessId"));
    const conversationId = String(formData.get("conversationId") ?? "");
    const text = formData.get("text");
    const result = await sendOwnerReply(user.id, businessId, conversationId, { text });
    revalidatePath(`/businesses/${businessId}/whatsapp`);
    revalidatePath(`/businesses/${businessId}/whatsapp/${conversationId}`);
    if (!result.sent) {
      // ADR 0010: a queue outcome is success-with-a-caveat, not an error — the approved text
      // was NOT lost; the console shows the honest story either way.
      return result.queued ? { ok: true, message: result.reason } : { error: result.reason };
    }
    return {
      ok: true,
      message: `Message sent. ${result.meterUsed} of 1,000 free service messages used this month.`,
    };
  } catch (err) {
    return actionError(err);
  }
}

// M8 (ADR 0010 §4): cancel a queued, not-yet-sent reply. Owner/admin only; the row goes
// terminal FAILED/CANCELLED_BY_OWNER — it never re-opens as a draft.
export async function cancelQueuedSendAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    const businessId = parseOrThrow(businessIdSchema, formData.get("businessId"));
    const conversationId = String(formData.get("conversationId") ?? "");
    const messageId = String(formData.get("messageId") ?? "");
    await cancelQueuedSend(user.id, businessId, conversationId, messageId);
    revalidatePath(`/businesses/${businessId}/whatsapp`);
    revalidatePath(`/businesses/${businessId}/whatsapp/${conversationId}`);
    return { ok: true, message: "Queued reply cancelled. Nothing was sent to the customer." };
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
