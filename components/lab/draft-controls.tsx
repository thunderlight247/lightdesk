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
    <form action={action} className="space-y-3">
      <input type="hidden" name="businessId" value={businessId} />
      <input type="hidden" name="conversationId" value={conversationId} />
      <input type="hidden" name="messageId" value={messageId} />
      {state.error && <Alert>{state.error}</Alert>}
      {state.fieldErrors?.editedText?.map((e) => <Alert key={e}>{e}</Alert>)}

      <details className="group rounded-xl border border-zinc-200 bg-white p-3">
        <summary className="cursor-pointer select-none text-xs sm:text-sm font-medium text-brand-700 hover:text-brand-800 flex items-center justify-between">
          <span>Edit before approving (optional)</span>
          <span className="text-zinc-400 group-open:rotate-180 transition-transform">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </span>
        </summary>
        <div className="mt-3 pt-3 border-t border-zinc-100">
          <Field label="Revised wording for simulation" hint="Your edit is saved separately; the original AI draft is retained in audit logs.">
            <Textarea name="editedText" rows={3} maxLength={1200} defaultValue={draft} />
          </Field>
        </div>
      </details>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending} variant="primary">
          {pending ? "Approving…" : "Approve reply"}
        </Button>
        <span className="text-xs text-zinc-500">
          Applies to this test simulation only.
        </span>
      </div>
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
      <GhostButton type="submit" disabled={pending} variant="secondary">
        {pending ? "Generating…" : label}
      </GhostButton>
      {state.error && <p role="alert" className="mt-1.5 max-w-xs text-xs font-medium text-red-600">{state.error}</p>}
      {state.ok && state.message && <p role="status" className="mt-1.5 max-w-xs text-xs font-medium text-emerald-700">{state.message}</p>}
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
      <Field label="Flag for human follow-up" hint="Describe what requires human attention (up to 300 characters).">
        <Input name="reason" required maxLength={300} placeholder="e.g. Needs pricing confirmation for custom bulk order." />
      </Field>
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Saving…" : "Mark for human follow-up"}
      </Button>
    </form>
  );
}
