"use client";

import { useActionState, useState } from "react";
import { deleteBusinessAction } from "@/app/(workspace)/businesses/[businessId]/settings/actions";
import { Alert, Field, Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import type { ActionState } from "@/lib/validation/action-state";

export function DeleteBusinessSection({
  businessId,
  businessName,
}: {
  businessId: string;
  businessName: string;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(deleteBusinessAction, {});
  const [typedName, setTypedName] = useState("");
  const isMatch = typedName.trim() === businessName.trim();

  return (
    <section aria-labelledby="delete-heading" className="card space-y-4 border-red-200 bg-red-50/20 p-5">
      <div>
        <h2 id="delete-heading" className="text-sm font-semibold text-red-900">
          Delete workspace
        </h2>
        <p className="mt-1 text-sm text-zinc-600">
          Permanently delete <strong>{businessName}</strong> and all of its associated data including
          product catalogue, knowledge profile, WhatsApp messages, and member access. This action cannot be undone.
        </p>
      </div>

      {state.error && <Alert tone="error">{state.error}</Alert>}

      <form action={action} className="space-y-3">
        <input type="hidden" name="businessId" value={businessId} />
        <Field
          label={`Type "${businessName}" to confirm deletion`}
          hint="Case-sensitive verification."
        >
          <Input
            name="confirmationName"
            value={typedName}
            onChange={(e) => setTypedName(e.target.value)}
            placeholder={businessName}
            required
            autoComplete="off"
          />
        </Field>

        <Button
          type="submit"
          variant="danger"
          disabled={!isMatch || pending}
        >
          {pending ? "Deleting workspace…" : "Permanently delete this business"}
        </Button>
      </form>
    </section>
  );
}
