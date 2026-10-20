"use client";

import { useActionState, useEffect, useRef } from "react";
import { sendMessageAction } from "@/app/(workspace)/businesses/[businessId]/lab/actions";
import { Button } from "@/components/ui/button";
import { Alert, Textarea } from "@/components/ui/field";
import { CardTitle } from "@/components/ui/card";
import type { ActionState } from "@/lib/validation/action-state";

/** The idempotency key is minted by the server per page render, so a double-click re-sends the SAME key. */
export function Composer({ businessId, conversationId, idempotencyKey, timeoutSeconds }: {
  businessId: string; conversationId: string; idempotencyKey: string; timeoutSeconds: number;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(sendMessageAction, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} action={action} className="card space-y-3 p-4 sm:p-5" aria-busy={pending}>
      <CardTitle
        title="Simulate a customer message"
        subtitle="The assistant drafts a reply from approved information — you always review before it counts."
      />
      <input type="hidden" name="businessId" value={businessId} />
      <input type="hidden" name="conversationId" value={conversationId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      {state.error && <Alert>{state.error}</Alert>}
      {state.fieldErrors?.text?.map((e) => <Alert key={e}>{e}</Alert>)}
      {state.ok && state.message && <Alert tone="success">{state.message}</Alert>}
      <label htmlFor="customer-message" className="block text-sm font-medium text-zinc-800">
        Customer enquiry
      </label>
      <Textarea id="customer-message" name="text" rows={3} maxLength={1000} required disabled={pending}
        aria-describedby="customer-message-help" placeholder="e.g. Do you deliver to Kumasi?" />
      <p id="customer-message-help" className="text-xs text-zinc-500">
        Fictional enquiries only — don&apos;t enter real customer names, phone numbers or payment details. Up to 1000 characters.
      </p>
      <Button type="submit" disabled={pending}>
        {pending ? "Generating a draft…" : "Send & draft a reply"}
      </Button>
      {pending && <p role="status" className="text-sm text-zinc-600">Generating a draft. This can take up to {timeoutSeconds} seconds.</p>}
    </form>
  );
}
