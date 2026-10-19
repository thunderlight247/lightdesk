"use client";

import { useActionState } from "react";
import { createBusinessAction } from "@/app/(workspace)/admin/businesses/new/actions";
import { Button } from "@/components/ui/button";
import { Alert, Field, Input } from "@/components/ui/field";
import type { ActionState } from "@/lib/validation/action-state";

export function CreateBusinessForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(createBusinessAction, {});
  return (
    <form action={action} className="space-y-4 rounded-md border bg-white p-4">
      {state.error && <Alert>{state.error}</Alert>}
      {state.inviteLink && (
        <Alert tone="info">
          <p className="mb-1 font-medium">Business created. No email was sent — send this owner invitation link privately.</p>
          <p className="mb-1">Shown once; it cannot be recovered.</p>
          <code className="block break-all rounded bg-white p-2">{state.inviteLink}</code>
        </Alert>
      )}
      <Field label="Business name" errors={state.fieldErrors?.name}>
        <Input name="name" required minLength={2} maxLength={100} />
      </Field>
      <Field label="Owner's email" errors={state.fieldErrors?.ownerEmail}>
        <Input name="ownerEmail" type="email" required />
      </Field>
      <Button type="submit" disabled={pending}>Create business &amp; owner invitation</Button>
    </form>
  );
}
