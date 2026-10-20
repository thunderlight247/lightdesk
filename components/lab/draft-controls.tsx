"use client";

import { useActionState } from "react";
import { approveDraftAction, followUpAction, regenerateAction } from "@/app/(workspace)/businesses/[businessId]/lab/actions";
import { Button, GhostButton } from "@/components/ui/button";
import { Alert, Field, Input, Textarea } from "@/components/ui/field";
import type { ActionState } from "@/lib/validation/action-state";

export function ApproveDraftForm({ businessId, conversationId, messageId, draft }: {
  businessId: string; conversationId: string; messageId: string; draft: string;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(approveDraftAction, {});
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="businessId" value={businessId} />
      <input type="hidden" name="conversationId" value={conversationId} />
      <input type="hidden" name="messageId" value={messageId} />
      {state.error && <Alert>{state.error}</Alert>}
      {state.fieldErrors?.editedText?.map((e) => <Alert key={e}>{e}</Alert>)}
      <details>
        <summary className="cursor-pointer text-sm text-brand-700 underline underline-offset-2">
          Edit before approving (optional)
        </summary>
        <div className="mt-2">
          <Field label="Reply to use in the simulation" hint="Your edit is kept separately; the original AI draft is never overwritten.">
            <Textarea name="editedText" rows={4} maxLength={1200} defaultValue={draft} />
          </Field>
        </div>
      </details>
      <Button type="submit" disabled={pending}>{pending ? "Approving…" : "Approve reply"}</Button>
      <p className="text-xs text-zinc-600">
        Approving uses this reply in the test conversation only. Nothing is sent to any customer.
      </p>
    </form>
  );
}

export function RegenerateButton({ businessId, conversationId, idempotencyKey, label = "Regenerate draft" }: {
  businessId: string; conversationId: string; idempotencyKey: string; label?: string;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(regenerateAction, {});
  return (
    <form action={action} className="inline-block align-top" aria-busy={pending}>
      <input type="hidden" name="businessId" value={businessId} />
      <input type="hidden" name="conversationId" value={conversationId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <GhostButton type="submit" disabled={pending}>{pending ? "Generating…" : label}</GhostButton>
      {state.error && <p role="alert" className="mt-1 max-w-xs text-xs text-red-700">{state.error}</p>}
      {state.ok && state.message && <p role="status" className="mt-1 max-w-xs text-xs text-emerald-800">{state.message}</p>}
    </form>
  );
}

export function FollowUpForm({ businessId, conversationId }: { businessId: string; conversationId: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(followUpAction, {});
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="businessId" value={businessId} />
      <input type="hidden" name="conversationId" value={conversationId} />
      {state.error && <Alert>{state.error}</Alert>}
      {state.fieldErrors?.reason?.map((e) => <Alert key={e}>{e}</Alert>)}
      {state.ok && state.message && <Alert tone="success">{state.message}</Alert>}
      <Field label="Flag for human follow-up" hint="Say what a person needs to look at (up to 300 characters).">
        <Input name="reason" required maxLength={300} />
      </Field>
      <Button type="submit" variant="secondary" disabled={pending}>{pending ? "Saving…" : "Mark for follow-up"}</Button>
    </form>
  );
}
