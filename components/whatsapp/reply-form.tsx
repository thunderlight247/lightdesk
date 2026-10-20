"use client";

import { useActionState, useEffect, useRef } from "react";
import { sendWhatsAppReplyAction } from "@/app/(workspace)/businesses/[businessId]/whatsapp/actions";
import { Button } from "@/components/ui/button";
import { Alert, Field, Textarea } from "@/components/ui/field";
import type { ActionState } from "@/lib/validation/action-state";

export function WhatsAppReplyForm({ businessId, conversationId, enabled }: {
  businessId: string;
  conversationId: string;
  enabled: boolean;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(sendWhatsAppReplyAction, {});
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);

  return (
    <form ref={ref} action={action} className="space-y-3" aria-busy={pending}>
      <input type="hidden" name="businessId" value={businessId} />
      <input type="hidden" name="conversationId" value={conversationId} />
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && state.message && <Alert tone="success">{state.message}</Alert>}
      <Field label="Reply to customer" hint="Only send information you have verified. Replies are plain text and limited to 4,000 characters.">
        <Textarea name="text" rows={4} required maxLength={4000} disabled={!enabled || pending}
          placeholder={enabled ? "Write a reply…" : "The 24-hour reply window is closed."} />
      </Field>
      <Button type="submit" disabled={!enabled || pending}>
        {pending ? "Sending…" : "Send reply"}
      </Button>
      <p className="text-xs text-zinc-500">This sends a real WhatsApp message to the customer. You are responsible for reviewing it before sending.</p>
    </form>
  );
}
