"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/guards";
import { actionError, type ActionState } from "@/lib/validation/action-state";
import { businessIdSchema, parseOrThrow } from "@/lib/validation/schemas";
import {
  approveAllPending, approveEntry, approveFaq, changeProfileStatus, clearEntry, createFaq, createProfile,
  deleteFaq, discardEntryChange, discardFaqChange, saveEntry, setFaqActive, updateFaq,
} from "@/modules/business-profile/service";

/**
 * Every action: session user from the server, business id validated, and the service layer
 * re-derives membership/role. Nothing about roles, states or approvals is read from the form.
 */
async function run(
  formData: FormData,
  fn: (userId: string, businessId: string) => Promise<string>,
): Promise<ActionState> {
  try {
    const user = await requireUser();
    const businessId = parseOrThrow(businessIdSchema, formData.get("businessId"));
    const message = await fn(user.id, businessId);
    revalidatePath(`/businesses/${businessId}/profile`, "layout");
    return { ok: true, message };
  } catch (err) {
    return actionError(err);
  }
}
const str = (fd: FormData, key: string) => fd.get(key);
const id = (fd: FormData, key: string) => String(fd.get(key) ?? "");

export async function createProfileAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(fd, async (u, b) => ((await createProfile(u, b)).created ? "Profile created." : "Profile already exists."));
}

export async function saveEntryAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(fd, async (u, b) => {
    const { outcome } = await saveEntry(u, b, { key: str(fd, "key"), value: str(fd, "value") });
    switch (outcome) {
      case "unchanged": return "No changes to save.";
      case "draft": return "Saved as a draft. An owner must approve it before it is used.";
      case "auto_approved": return "Saved.";
      default: return "Saved.";
    }
  });
}
export async function clearEntryAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(fd, async (u, b) => { await clearEntry(u, b, id(fd, "entryId")); return "Marked as not provided."; });
}
export async function approveEntryAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(fd, async (u, b) => { await approveEntry(u, b, id(fd, "entryId")); return "Approved."; });
}
export async function discardEntryAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(fd, async (u, b) => { await discardEntryChange(u, b, id(fd, "entryId")); return "Change discarded."; });
}

export async function createFaqAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(fd, async (u, b) => {
    await createFaq(u, b, { question: str(fd, "question"), answer: str(fd, "answer"), category: str(fd, "category") });
    return "FAQ saved as a draft. An owner must approve it before it is used.";
  });
}
export async function updateFaqAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(fd, async (u, b) => {
    const { outcome } = await updateFaq(u, b, id(fd, "faqId"), {
      question: str(fd, "question") ?? undefined, answer: str(fd, "answer") ?? undefined, category: str(fd, "category") ?? undefined,
    });
    return outcome === "draft" ? "Saved as a draft. The approved wording stays in use until an owner approves." : outcome === "unchanged" ? "No changes to save." : "Saved.";
  });
}
export async function toggleFaqAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(fd, async (u, b) => {
    const on = str(fd, "active") === "true";
    await setFaqActive(u, b, id(fd, "faqId"), on);
    return on ? "Activated." : "Deactivated.";
  });
}
export async function deleteFaqAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(fd, async (u, b) => { await deleteFaq(u, b, id(fd, "faqId")); return "Deleted."; });
}
export async function approveFaqAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(fd, async (u, b) => { await approveFaq(u, b, id(fd, "faqId")); return "Approved."; });
}
export async function discardFaqAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(fd, async (u, b) => { await discardFaqChange(u, b, id(fd, "faqId")); return "Change discarded."; });
}

export async function approveAllAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(fd, async (u, b) => {
    const { approved, skipped } = await approveAllPending(u, b);
    return skipped.length > 0
      ? `Approved ${approved}. Not approved (needs attention): ${skipped.join(", ")}.`
      : `Approved ${approved} item${approved === 1 ? "" : "s"}.`;
  });
}

export async function changeStatusAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(fd, async (u, b) => {
    const { to } = await changeProfileStatus(u, b, str(fd, "to"), { reason: str(fd, "reason") ?? undefined });
    return `Profile is now ${to.toLowerCase().replace("_", " ")}.`;
  });
}
