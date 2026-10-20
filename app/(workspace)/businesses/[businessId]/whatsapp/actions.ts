"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/guards";
import { actionError, type ActionState } from "@/lib/validation/action-state";
import { businessIdSchema, parseOrThrow } from "@/lib/validation/schemas";
import { sendOwnerReply } from "@/modules/whatsapp/service";

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
