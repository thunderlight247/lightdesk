"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/guards";
import { actionError, type ActionState } from "@/lib/validation/action-state";
import { businessIdSchema, parseOrThrow } from "@/lib/validation/schemas";
import { cancelQueuedSend, sendOwnerReply, setConversationMode } from "@/modules/whatsapp/service";
import { createConversationNote, deleteConversationNote } from "@/modules/frontline/notes";
import { assignConversation } from "@/modules/frontline/assignment";
import { createOrderLead, updateOrderLeadStatus, type OrderItemInput } from "@/modules/frontline/orders";
import { createQuickReply, deleteQuickReply } from "@/modules/frontline/quick-replies";
import { inspectReceipt, transcribeAudio } from "@/modules/media/receipt-and-audio";

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

export async function addConversationNoteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    const businessId = parseOrThrow(businessIdSchema, formData.get("businessId"));
    const conversationId = String(formData.get("conversationId") ?? "");
    const content = String(formData.get("content") ?? "");
    await createConversationNote(user.id, businessId, { conversationId, content });
    revalidatePath(`/businesses/${businessId}/whatsapp/${conversationId}`);
    return { ok: true, message: "Internal note added." };
  } catch (err) {
    return actionError(err);
  }
}

export async function deleteConversationNoteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    const businessId = parseOrThrow(businessIdSchema, formData.get("businessId"));
    const conversationId = String(formData.get("conversationId") ?? "");
    const noteId = String(formData.get("noteId") ?? "");
    await deleteConversationNote(user.id, businessId, noteId);
    revalidatePath(`/businesses/${businessId}/whatsapp/${conversationId}`);
    return { ok: true, message: "Internal note deleted." };
  } catch (err) {
    return actionError(err);
  }
}

export async function assignConversationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    const businessId = parseOrThrow(businessIdSchema, formData.get("businessId"));
    const conversationId = String(formData.get("conversationId") ?? "");
    const rawAssignee = formData.get("assignedToUserId");
    const assignedToUserId = rawAssignee && typeof rawAssignee === "string" && rawAssignee !== "unassigned" ? rawAssignee : null;
    await assignConversation(user.id, businessId, conversationId, assignedToUserId);
    revalidatePath(`/businesses/${businessId}/whatsapp`);
    revalidatePath(`/businesses/${businessId}/whatsapp/${conversationId}`);
    return { ok: true, message: assignedToUserId ? "Conversation assigned." : "Conversation unassigned." };
  } catch (err) {
    return actionError(err);
  }
}

export async function createOrderLeadAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    const businessId = parseOrThrow(businessIdSchema, formData.get("businessId"));
    const conversationId = formData.get("conversationId") ? String(formData.get("conversationId")) : undefined;
    const customerName = String(formData.get("customerName") ?? "");
    const customerPhone = String(formData.get("customerPhone") ?? "");
    const totalGhs = Number(formData.get("totalGhs") ?? 0);
    const deliveryAddress = String(formData.get("deliveryAddress") ?? "");
    const deliveryNotes = String(formData.get("deliveryNotes") ?? "");
    const status = String(formData.get("status") ?? "PENDING");
    const paymentStatus = String(formData.get("paymentStatus") ?? "UNPAID");
    const receiptRef = String(formData.get("receiptRef") ?? "");

    const rawItems = formData.get("items");
    let items: OrderItemInput[] = [];
    if (typeof rawItems === "string" && rawItems.trim()) {
      try {
        items = JSON.parse(rawItems) as OrderItemInput[];
      } catch {
        items = [{ name: rawItems.trim(), quantity: 1, priceGhs: totalGhs }];
      }
    } else {
      const singleItemName = String(formData.get("itemName") ?? "Order Item");
      items = [{ name: singleItemName, quantity: 1, priceGhs: totalGhs }];
    }

    await createOrderLead(user.id, businessId, {
      conversationId,
      customerName,
      customerPhone,
      items,
      totalGhs,
      deliveryAddress,
      deliveryNotes,
      status,
      paymentStatus,
      receiptRef,
    });

    revalidatePath(`/businesses/${businessId}/orders`);
    if (conversationId) revalidatePath(`/businesses/${businessId}/whatsapp/${conversationId}`);
    return { ok: true, message: "Order lead recorded successfully." };
  } catch (err) {
    return actionError(err);
  }
}

export async function updateOrderLeadStatusAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    const businessId = parseOrThrow(businessIdSchema, formData.get("businessId"));
    const orderId = String(formData.get("orderId") ?? "");
    const status = formData.get("status") ? String(formData.get("status")) : undefined;
    const paymentStatus = formData.get("paymentStatus") ? String(formData.get("paymentStatus")) : undefined;
    const receiptRef = formData.get("receiptRef") ? String(formData.get("receiptRef")) : undefined;
    const deliveryNotes = formData.get("deliveryNotes") ? String(formData.get("deliveryNotes")) : undefined;

    await updateOrderLeadStatus(user.id, businessId, orderId, {
      status,
      paymentStatus,
      receiptRef,
      deliveryNotes,
    });

    revalidatePath(`/businesses/${businessId}/orders`);
    return { ok: true, message: "Order status updated." };
  } catch (err) {
    return actionError(err);
  }
}

export async function createQuickReplyAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    const businessId = parseOrThrow(businessIdSchema, formData.get("businessId"));
    const shortcut = String(formData.get("shortcut") ?? "");
    const title = String(formData.get("title") ?? "");
    const content = String(formData.get("content") ?? "");
    const category = String(formData.get("category") ?? "");

    await createQuickReply(user.id, businessId, { shortcut, title, content, category });
    revalidatePath(`/businesses/${businessId}/whatsapp`);
    return { ok: true, message: "Quick reply saved." };
  } catch (err) {
    return actionError(err);
  }
}

export async function deleteQuickReplyAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    const businessId = parseOrThrow(businessIdSchema, formData.get("businessId"));
    const id = String(formData.get("id") ?? "");

    await deleteQuickReply(user.id, businessId, id);
    revalidatePath(`/businesses/${businessId}/whatsapp`);
    return { ok: true, message: "Quick reply removed." };
  } catch (err) {
    return actionError(err);
  }
}

export async function inspectReceiptAction(_prev: ActionState, formData: FormData): Promise<ActionState & { inspection?: unknown }> {
  try {
    const base64Data = String(formData.get("base64Data") ?? "");
    const mimeType = String(formData.get("mimeType") ?? "image/jpeg");
    if (!base64Data) {
      return { error: "No receipt image data provided." };
    }
    const result = await inspectReceipt({ base64Data, mimeType });
    return {
      ok: true,
      message: result.summary,
      inspection: result,
    };
  } catch (err) {
    return actionError(err);
  }
}

export async function transcribeAudioAction(_prev: ActionState, formData: FormData): Promise<ActionState & { transcription?: unknown }> {
  try {
    const base64Data = String(formData.get("base64Data") ?? "");
    const mimeType = String(formData.get("mimeType") ?? "audio/ogg");
    if (!base64Data) {
      return { error: "No audio data provided." };
    }
    const result = await transcribeAudio({ base64Data, mimeType });
    return {
      ok: true,
      message: result.summary,
      transcription: result,
    };
  } catch (err) {
    return actionError(err);
  }
}

