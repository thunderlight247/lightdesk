"use client";

import { useActionState } from "react";
import { changeStatusAction } from "@/app/(workspace)/businesses/[businessId]/profile/actions";
import { Alert, Field, Textarea } from "@/components/ui/field";
import type { ActionState } from "@/lib/validation/action-state";

/** Suspension needs a reason; other transitions use ActionButton. */
export function SuspendForm({ businessId }: { businessId: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(changeStatusAction, {});
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="businessId" value={businessId} />
      <input type="hidden" name="to" value="SUSPENDED" />
      {state.error && <Alert>{state.error}</Alert>}
      <Field label="Reason for suspending" errors={state.fieldErrors?.reason} hint="Shown to your team. Required.">
        <Textarea name="reason" rows={2} maxLength={300} required />
      </Field>
      <button type="submit" disabled={pending} className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-800 hover:bg-red-50 disabled:opacity-50">
        {pending ? "Suspending…" : "Suspend profile"}
      </button>
    </form>
  );
}
