"use client";

import { useActionState, useEffect, useRef } from "react";
import { sendMessageAction } from "@/app/(workspace)/businesses/[businessId]/lab/actions";
import { Button } from "@/components/ui/button";
import { Alert, Textarea } from "@/components/ui/field";
import { CardTitle } from "@/components/ui/card";
import type { ActionState } from "@/lib/validation/action-state";

const SUGGESTIONS = [
  "Do you deliver to Kumasi?",
  "What are your opening hours on weekends?",
  "How much does your standard service cost?",
  "What payment methods do you accept?",
];

/** The idempotency key is minted by the server per page render, so a double-click re-sends the SAME key. */
export function Composer({
  businessId,
  conversationId,
  idempotencyKey,
  timeoutSeconds,
}: {
  businessId: string;
  conversationId: string;
  idempotencyKey: string;
  timeoutSeconds: number;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(sendMessageAction, {});
  const ref = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);

  const applySuggestion = (text: string) => {
    if (textareaRef.current) {
      textareaRef.current.value = text;
      textareaRef.current.focus();
    }
  };

  return (
    <form ref={ref} action={action} className="card p-4 sm:p-5 space-y-4" aria-busy={pending}>
      <CardTitle
        title="Simulate a customer enquiry"
        subtitle="The assistant drafts a reply strictly from your approved business facts."
      />
      <input type="hidden" name="businessId" value={businessId} />
      <input type="hidden" name="conversationId" value={conversationId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

      {state.error && <Alert>{state.error}</Alert>}
      {state.fieldErrors?.text?.map((e) => <Alert key={e}>{e}</Alert>)}
      {state.ok && state.message && <Alert tone="success">{state.message}</Alert>}

      {/* Quick Test Prompt Suggestions */}
      <div className="space-y-1.5">
        <span className="text-xs font-medium text-zinc-500">Quick test examples:</span>
        <div className="nav-scroll -mx-1 px-1">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => applySuggestion(s)}
              className="whitespace-nowrap rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs text-zinc-600 hover:border-zinc-300 hover:bg-zinc-100 active:bg-zinc-200"
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label htmlFor="customer-message" className="mb-1.5 block text-sm font-medium text-zinc-800">
          Customer message
        </label>
        <Textarea
          ref={textareaRef}
          id="customer-message"
          name="text"
          rows={3}
          maxLength={1000}
          required
          disabled={pending}
          aria-describedby="customer-message-help"
          placeholder="e.g. Do you deliver to Kumasi? How much is shipping?"
        />
        <p id="customer-message-help" className="mt-1.5 text-xs text-zinc-400">
          Fictional enquiries only — do not enter real customer phone numbers, personal identity, or payment details.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <Button type="submit" disabled={pending} size="md">
          {pending ? (
            <>
              <svg className="h-4 w-4 animate-spin text-white" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <span>Drafting response…</span>
            </>
          ) : (
            <>
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
              <span>Send &amp; draft reply</span>
            </>
          )}
        </Button>
        {pending && (
          <p role="status" className="text-xs text-zinc-500 animate-pulse">
            Processing with AI pipeline (can take up to {timeoutSeconds}s)…
          </p>
        )}
      </div>
    </form>
  );
}
