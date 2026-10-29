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
    <form action={action} className="card p-4 sm:p-6 space-y-5" aria-busy={pending}>
      <input type="hidden" name="businessId" value={businessId} />
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && state.message && <Alert tone="success">{state.message}</Alert>}

      <Field
        label="Business name"
        errors={state.fieldErrors?.name}
        hint={canRename ? undefined : "Only business owners can modify the business name."}
      >
        <Input name="name" defaultValue={initial.name} disabled={!canRename} required minLength={2} maxLength={100} />
      </Field>
      <Field label="Location" errors={state.fieldErrors?.location} hint="Town, city or area, e.g. “Kejetia, Kumasi”. Optional.">
        <Input name="location" defaultValue={initial.location ?? ""} maxLength={120} autoComplete="off" placeholder="e.g. Osu, Accra" />
      </Field>
      <Field label="Description" errors={state.fieldErrors?.description} hint="What the business offers, in a sentence or two. Optional, up to 500 characters.">
        <Textarea name="description" defaultValue={initial.description ?? ""} rows={4} maxLength={500} placeholder="e.g. Handcrafted leather shoes and accessories." />
      </Field>

      <div>
        <Button type="submit" disabled={pending} className="w-full sm:w-auto">
          {pending ? "Saving changes…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
