"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/guards";
import { actionError, type ActionState } from "@/lib/validation/action-state";
import { businessIdSchema, parseOrThrow } from "@/lib/validation/schemas";
import {
  approveDraft, createConversation, deleteConversation, markForFollowUp, regenerateDraft, resolveEscalation, submitCustomerMessage,
} from "@/modules/lab/service";

/**
 * Every action takes the user from the session and re-derives membership/role in the service layer.
 * No provider, model, role, state or business ownership value is ever read from the form.
 */
async function run(formData: FormData, fn: (userId: string, businessId: string) => Promise<string | ActionState>): Promise<ActionState> {
  try {
    const user = await requireUser();
    const businessId = parseOrThrow(businessIdSchema, formData.get("businessId"));
    const out = await fn(user.id, businessId);
    revalidatePath(`/businesses/${businessId}/lab`, "layout");
    return typeof out === "string" ? { ok: true, message: out } : out;
  } catch (err) {
    return actionError(err);
  }
}
const id = (fd: FormData, k: string) => String(fd.get(k) ?? "");

export async function createConversationAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let target: string | null = null;
  const state = await run(fd, async (u, b) => {
    const conv = await createConversation(u, b, { customerLabel: fd.get("customerLabel") });
    target = `/businesses/${b}/lab/${conv.id}`;
    return "Created.";
  });
  if (target) redirect(target);
  return state;
}

export async function sendMessageAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(fd, async (u, b) => {
    const r = await submitCustomerMessage(u, b, id(fd, "conversationId"), { text: fd.get("text"), idempotencyKey: fd.get("idempotencyKey") });
    if (r.outcome === "failed") return { error: r.message };
    return r.duplicate ? "That message was already sent." : "Draft ready for review.";
  });
}

export async function regenerateAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(fd, async (u, b) => {
    const r = await regenerateDraft(u, b, id(fd, "conversationId"), { idempotencyKey: fd.get("idempotencyKey") });
    if (r.outcome === "failed") return { error: r.message };
    return r.duplicate ? "That request was already handled." : "New draft ready for review.";
  });
}

export async function approveDraftAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(fd, async (u, b) => {
    const r = await approveDraft(u, b, id(fd, "conversationId"), id(fd, "messageId"), { editedText: fd.get("editedText") });
    return r.edited ? "Edited reply approved for the simulation. Nothing was sent to any customer." : "Reply approved for the simulation. Nothing was sent to any customer.";
  });
}

export async function followUpAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(fd, async (u, b) => {
    await markForFollowUp(u, b, id(fd, "conversationId"), { reason: fd.get("reason") });
    return "Marked for human follow-up.";
  });
}

export async function resolveAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(fd, async (u, b) => {
    await resolveEscalation(u, b, id(fd, "conversationId"));
    return "Escalation resolved.";
  });
}

export async function deleteConversationAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let target: string | null = null;
  const state = await run(fd, async (u, b) => {
    await deleteConversation(u, b, id(fd, "conversationId"));
    target = `/businesses/${b}/lab`;
    return "Deleted.";
  });
  if (target) redirect(target);
  return state;
}
