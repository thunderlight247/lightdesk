"use client";

import { useActionState } from "react";
import { createBusinessAction } from "@/app/(workspace)/admin/businesses/new/actions";
import { Button } from "@/components/ui/button";
import { Alert, Field, Input } from "@/components/ui/field";
import type { ActionState } from "@/lib/validation/action-state";

export function CreateBusinessForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(createBusinessAction, {});
  return (
    <form action={action} className="space-y-4">
      {state.error && <Alert>{state.error}</Alert>}
      {state.inviteLink && (
        <Alert tone="info">
          <p className="font-semibold text-amber-950">Business created successfully:</p>
          <p className="mt-0.5 text-xs text-amber-900">
            Share this single-use owner invitation link privately. It is only shown once and cannot be recovered.
          </p>
          <div className="mt-2">
            <code className="block break-all rounded-lg bg-white/80 p-2.5 font-mono text-xs border border-amber-200/80 text-amber-950">
              {state.inviteLink}
            </code>
          </div>
        </Alert>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Business name" errors={state.fieldErrors?.name}>
          <Input name="name" required minLength={2} maxLength={100} placeholder="e.g. Acme Ghana Ltd" />
        </Field>
        <Field label="Owner's email" errors={state.fieldErrors?.ownerEmail}>
          <Input name="ownerEmail" type="email" required placeholder="owner@example.com" />
        </Field>
      </div>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Creating workspace…" : "Create business & generate owner link"}
        </Button>
      </div>
    </form>
  );
}
