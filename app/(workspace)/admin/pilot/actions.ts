"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/guards";
import { actionError, type ActionState } from "@/lib/validation/action-state";
import {
  enrollBusinessInPilot,
  listPilotCandidates,
  setPilotStatus,
} from "@/modules/pilot/service";

export async function enrollInPilotAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    const businessId = String(formData.get("businessId") ?? "").trim();
    if (!businessId) return { error: "Choose a business." };
    const note = formData.get("note");
    await enrollBusinessInPilot(user.id, businessId, { note });
    revalidatePath("/admin/pilot");
    return { ok: true, message: "Business enrolled. The owner must now accept the pilot terms in their console." };
  } catch (err) {
    return actionError(err);
  }
}

export async function setPilotStatusAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    const businessId = String(formData.get("businessId") ?? "").trim();
    const action = String(formData.get("action") ?? "");
    const reason = formData.get("reason");
    if (!["pause", "resume", "exit"].includes(action)) return { error: "Invalid action." };
    const result = await setPilotStatus(user.id, businessId, action as "pause" | "resume" | "exit", typeof reason === "string" ? reason : undefined);
    revalidatePath("/admin/pilot");
    return { ok: true, message: `Pilot is now ${result.status.replace("_", " ").toLowerCase()}.` };
  } catch (err) {
    return actionError(err);
  }
}

export async function listPilotCandidatesForPage() {
  const user = await requireUser();
  return listPilotCandidates(user.id);
}
