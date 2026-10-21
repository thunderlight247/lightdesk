"use client";

import { useActionState } from "react";
import { setWhatsAppConversationModeAction } from "@/app/(workspace)/businesses/[businessId]/whatsapp/actions";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/field";
import type { ActionState } from "@/lib/validation/action-state";

/**
 * M6c human-control panel (spec §3.3). Owner/admin only (the page gates this). Takeover is
 * the AI_ASSIST → OWNER_ONLY switch; "hand back to AI" is the symmetric reverse. The two
 * forms are separate so a stray double-click can only ever submit one direction.
 */
export function WhatsAppModeControls({ businessId, conversationId, mode }: {
  businessId: string;
  conversationId: string;
  mode: "OWNER_ONLY" | "AI_ASSIST";
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(setWhatsAppConversationModeAction, {});

  return (
    <form action={action} className="space-y-2" aria-busy={pending} aria-label="Conversation control mode">
      <input type="hidden" name="businessId" value={businessId} />
      <input type="hidden" name="conversationId" value={conversationId} />
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && state.message && <Alert tone="success">{state.message}</Alert>}
      {mode === "OWNER_ONLY" ? (
        <>
          <Button type="submit" name="mode" value="AI_ASSIST" disabled={pending}>
            {pending ? "Working…" : "Enable AI assistance"}
          </Button>
          <p className="text-xs text-zinc-500">Incoming texts get a draft grounded in your approved business information. Drafts are never sent without your approval.</p>
        </>
      ) : (
        <>
          <Button type="submit" name="mode" value="OWNER_ONLY" disabled={pending}>
            {pending ? "Working…" : "Take over this conversation"}
          </Button>
          <p className="text-xs text-zinc-500">Stops AI drafting immediately. The pending draft stays visible but is marked superseded.</p>
        </>
      )}
    </form>
  );
}
