"use client";

import { useActionState } from "react";
import { createConversationAction } from "@/app/(workspace)/businesses/[businessId]/lab/actions";
import { Button } from "@/components/ui/button";
import { Alert, Field, Input } from "@/components/ui/field";
import { CardTitle } from "@/components/ui/card";
import type { ActionState } from "@/lib/validation/action-state";

export function NewConversationForm({ businessId }: { businessId: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(createConversationAction, {});
  return (
    <form action={action} className="card p-4 sm:p-5 space-y-4">
      <CardTitle
        title="Start a new test conversation"
        subtitle="Give the fictional customer a label so the transcript reads like an authentic customer enquiry."
      />
      <input type="hidden" name="businessId" value={businessId} />
      {state.error && <Alert>{state.error}</Alert>}
      {state.fieldErrors?.customerLabel?.map((e) => <Alert key={e}>{e}</Alert>)}
      <Field
        label="Simulated customer name or label (optional)"
        hint="e.g. “Ama (Kumasi)” or “Kwame”. Do not use real customer identities."
      >
        <Input name="customerLabel" maxLength={40} placeholder="e.g. Ama (Test Customer)" autoComplete="off" />
      </Field>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? (
            <>
              <svg className="h-4 w-4 animate-spin text-white" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <span>Creating…</span>
            </>
          ) : (
            <>
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span>Create test conversation</span>
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
