"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/guards";
import { actionError, type ActionState } from "@/lib/validation/action-state";
import { businessIdSchema, parseOrThrow } from "@/lib/validation/schemas";
import {
  consentToPilot,
  revokePilotConsent,
  submitPilotFeedback,
  updateUsageCaps,
} from "@/modules/pilot/service";

function numOr(formData: FormData, key: string, fallback: number): number {
  const raw = formData.get(key);
  const parsed = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : fallback;
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Owner-only: accept the pilot terms and activate the enrollment. */
export async function consentToPilotAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    const businessId = parseOrThrow(businessIdSchema, formData.get("businessId"));
    if (formData.get("accepted") !== "yes") return { error: "You must accept the pilot terms to continue." };
    await consentToPilot(user.id, businessId);
    revalidatePath(`/businesses/${businessId}/whatsapp/settings`);
    return { ok: true, message: "Pilot activated. AI assist and the send gate are now subject to your usage caps." };
  } catch (err) {
    return actionError(err);
  }
}

/** Owner-only: leave the pilot entirely. Restricted capabilities turn off immediately. */
export async function leavePilotAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    const businessId = parseOrThrow(businessIdSchema, formData.get("businessId"));
    await revokePilotConsent(user.id, businessId);
    revalidatePath(`/businesses/${businessId}/whatsapp/settings`);
    return { ok: true, message: "You have left the pilot. AI assist is disabled until you rejoin." };
  } catch (err) {
    return actionError(err);
  }
}

/** Owner-only: change the per-business hard caps (floor 0, platform ceiling enforced in code). */
export async function updateUsageCapsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    const businessId = parseOrThrow(businessIdSchema, formData.get("businessId"));
    await updateUsageCaps(user.id, businessId, {
      aiCallsPerDay: numOr(formData, "aiCallsPerDay", NaN),
      outboundPerMonth: numOr(formData, "outboundPerMonth", NaN),
    });
    revalidatePath(`/businesses/${businessId}/whatsapp/settings`);
    return { ok: true, message: "Usage caps updated." };
  } catch (err) {
    return actionError(err);
  }
}

/** Any member: submit pilot feedback to the platform team. */
export async function submitPilotFeedbackAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    const businessId = parseOrThrow(businessIdSchema, formData.get("businessId"));
    await submitPilotFeedback(user.id, businessId, { category: formData.get("category"), comment: formData.get("comment") });
    revalidatePath(`/businesses/${businessId}/whatsapp/settings`);
    return { ok: true, message: "Thank you — your feedback was sent to the LightDesk team." };
  } catch (err) {
    return actionError(err);
  }
}
