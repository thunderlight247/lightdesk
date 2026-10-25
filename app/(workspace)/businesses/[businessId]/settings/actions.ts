"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/guards";
import { actionError, type ActionState } from "@/lib/validation/action-state";
import { businessIdSchema, parseOrThrow } from "@/lib/validation/schemas";
import { updateBusiness } from "@/modules/businesses/service";
import { deleteBusiness } from "@/modules/privacy/deletion";

const FIELDS = ["name", "description", "location"] as const;

export async function updateBusinessAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    const businessId = parseOrThrow(businessIdSchema, formData.get("businessId"));
    // Only fields actually present are sent: a disabled "name" input is simply absent.
    // Authorisation is re-checked by updateBusiness regardless of what the form showed.
    const input: Record<string, string> = {};
    for (const key of FIELDS) {
      const value = formData.get(key);
      if (typeof value === "string") input[key] = value;
    }
    const { changed } = await updateBusiness(user.id, businessId, input);
    if (changed.length > 0) {
      revalidatePath(`/businesses/${businessId}`, "layout");
      revalidatePath("/businesses");
    }
    return { ok: true, message: changed.length > 0 ? "Settings saved." : "No changes to save." };
  } catch (err) {
    return actionError(err);
  }
}

export async function deleteBusinessAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    const businessId = parseOrThrow(businessIdSchema, formData.get("businessId"));
    const confirmationName = String(formData.get("confirmationName") ?? "");
    await deleteBusiness(user.id, businessId, confirmationName);
    revalidatePath("/businesses");
  } catch (err) {
    return actionError(err);
  }
  redirect("/businesses");
}
