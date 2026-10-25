"use client";

import { useActionState } from "react";
import { cancelQueuedSendAction } from "@/app/(workspace)/businesses/[businessId]/whatsapp/actions";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/field";
import type { ActionState } from "@/lib/validation/action-state";

/**
 * M8 (ADR 0010 §6): the Cancel affordance on a queued, not-yet-sent reply. Cancel is
 * terminal (FAILED/CANCELLED_BY_OWNER) — it never returns the row to a draft.
 */
export function WhatsAppQueuedCancel({ businessId, conversationId, messageId, queuedAt }: {
  businessId: string;
  conversationId: string;
  messageId: string;
  queuedAt: string;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(cancelQueuedSendAction, {});

  return (
    <form action={action} className="space-y-2" aria-busy={pending} aria-label="Cancel queued reply">
      <input type="hidden" name="businessId" value={businessId} />
      <input type="hidden" name="conversationId" value={conversationId} />
      <input type="hidden" name="messageId" value={messageId} />
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && state.message && <Alert tone="success">{state.message}</Alert>}
      <div className="flex items-center gap-3">
        <span className="text-xs text-zinc-500">Queued {queuedAt}</span>
        <Button type="submit" disabled={pending} variant="secondary">
          {pending ? "Cancelling…" : "Cancel queued reply"}
        </Button>
      </div>
    </form>
  );
}
