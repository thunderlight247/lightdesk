"use client";

import { useActionState } from "react";
import { updateBusinessAction } from "@/app/(workspace)/businesses/[businessId]/settings/actions";
import { Button } from "@/components/ui/button";
import { Alert, Field, Input, Textarea } from "@/components/ui/field";
import type { ActionState } from "@/lib/validation/action-state";

export function BusinessSettingsForm({
  businessId,
  initial,
  canRename,
}: {
  businessId: string;
  initial: { name: string; description: string | null; location: string | null };
  canRename: boolean;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateBusinessAction, {});
  return (
    <form action={action} className="space-y-5 rounded-md border bg-white p-4 sm:p-6" aria-busy={pending}>
      <input type="hidden" name="businessId" value={businessId} />
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && state.message && <Alert tone="success">{state.message}</Alert>}

      <Field
        label="Business name"
        errors={state.fieldErrors?.name}
        hint={canRename ? undefined : "Only owners can change the business name."}
      >
        <Input name="name" defaultValue={initial.name} disabled={!canRename} required minLength={2} maxLength={100} />
      </Field>
      <Field label="Location" errors={state.fieldErrors?.location} hint="Town or area, e.g. “Kejetia, Kumasi”. Optional.">
        <Input name="location" defaultValue={initial.location ?? ""} maxLength={120} autoComplete="off" />
      </Field>
      <Field label="Description" errors={state.fieldErrors?.description} hint="What the business sells, in a sentence or two. Optional, up to 500 characters.">
        <Textarea name="description" defaultValue={initial.description ?? ""} rows={4} maxLength={500} />
      </Field>

      <Button type="submit" disabled={pending} className="w-full sm:w-auto">
        {pending ? "Saving…" : "Save changes"}
      </Button>
    </form>
  );
}
