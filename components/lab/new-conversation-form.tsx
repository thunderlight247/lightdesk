"use client";

import { useActionState } from "react";
import { createConversationAction } from "@/app/(workspace)/businesses/[businessId]/lab/actions";
import { Button } from "@/components/ui/button";
import { Alert, Field, Input } from "@/components/ui/field";
import type { ActionState } from "@/lib/validation/action-state";

export function NewConversationForm({ businessId }: { businessId: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(createConversationAction, {});
  return (
    <form action={action} className="space-y-3 rounded-md border bg-white p-4">
      <input type="hidden" name="businessId" value={businessId} />
      {state.error && <Alert>{state.error}</Alert>}
      {state.fieldErrors?.customerLabel?.map((e) => <Alert key={e}>{e}</Alert>)}
      <Field label="Fictional customer name (optional)" hint="A label like “Ama (test)”. Don’t use a real customer’s name.">
        <Input name="customerLabel" maxLength={40} placeholder="Test customer" autoComplete="off" />
      </Field>
      <Button type="submit" disabled={pending}>{pending ? "Creating…" : "New test conversation"}</Button>
    </form>
  );
}
