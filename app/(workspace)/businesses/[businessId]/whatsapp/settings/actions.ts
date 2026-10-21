"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/guards";
import { actionError } from "@/lib/validation/action-state";
import { businessIdSchema } from "@/lib/validation/schemas";
import {
  completeEmbeddedSignupChoice, disconnectWhatsAppConnection, startEmbeddedSignup,
  type SignupOutcome,
} from "@/modules/whatsapp/onboarding";

type Outcome = { ok: true; result: SignupOutcome | { disconnected: true } } | { ok: false; error: string };

/**
 * M6d, step 1: the browser completed Meta's Embedded Signup and holds a short-lived `code`.
 * The code is the ONLY thing that ever travels through the browser here; tokens are exchanged
 * server-side and never round-tripped back to the client.
 */
export async function startWhatsAppSignupAction(businessId: string, code: string): Promise<Outcome> {
  try {
    const user = await requireUser();
    const bizId = businessIdSchema.parse(businessId);
    const result = await startEmbeddedSignup(user.id, bizId, { code });
    revalidateSettings(bizId);
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: errText(err) };
  }
}

/** M6d, step 2 (only when the signup exposed several numbers): verify and bind the choice. */
export async function chooseWhatsAppSignupAction(businessId: string, input: { pendingId: string; wabaId: string; phoneNumberId: string }): Promise<Outcome> {
  try {
    const user = await requireUser();
    const bizId = businessIdSchema.parse(businessId);
    const result = await completeEmbeddedSignupChoice(user.id, bizId, input);
    revalidateSettings(bizId);
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: errText(err) };
  }
}

/** Owner disconnect: the number stops serving webhooks and sends; conversation history is kept. */
export async function disconnectWhatsAppAction(businessId: string): Promise<Outcome> {
  try {
    const user = await requireUser();
    const bizId = businessIdSchema.parse(businessId);
    await disconnectWhatsAppConnection(user.id, bizId);
    revalidateSettings(bizId);
    return { ok: true, result: { disconnected: true } };
  } catch (err) {
    return { ok: false, error: errText(err) };
  }
}

function revalidateSettings(businessId: string) {
  revalidatePath(`/businesses/${businessId}/whatsapp`);
  revalidatePath(`/businesses/${businessId}/whatsapp/settings`);
}

function errText(err: unknown): string {
  // Same user-facing rule as actionError: AppError messages are safe; everything else stays generic.
  const actionState = actionError(err);
  return actionState.error ?? "Something went wrong. Please try again.";
}
