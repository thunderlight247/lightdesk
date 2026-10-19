"use client";

import { useActionState, useEffect, useRef } from "react";
import { createFaqAction, updateFaqAction } from "@/app/(workspace)/businesses/[businessId]/profile/actions";
import { Button } from "@/components/ui/button";
import { Alert, Field, Input, Textarea } from "@/components/ui/field";
import type { ActionState } from "@/lib/validation/action-state";

export function FaqForm({
  businessId, faq,
}: {
  businessId: string;
  faq?: { id: string; question: string; answer: string; category: string | null; revision: number };
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(faq ? updateFaqAction : createFaqAction, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!faq && state.ok) ref.current?.reset();
  }, [faq, state]);
  const rev = faq ? `${faq.id}-${faq.revision}` : "new";

  return (
    <form ref={ref} action={action} className="space-y-3">
      <input type="hidden" name="businessId" value={businessId} />
      {faq && <input type="hidden" name="faqId" value={faq.id} />}
      {state.error && !state.fieldErrors?.question && !state.fieldErrors?.answer && <Alert>{state.error}</Alert>}
      {state.ok && state.message && <Alert tone="success">{state.message}</Alert>}
      <Field label="Customer question or topic" errors={state.fieldErrors?.question}>
        <Input key={`q-${rev}`} name="question" required minLength={5} maxLength={300} defaultValue={faq?.question ?? ""} />
      </Field>
      <Field label="Approved answer" errors={state.fieldErrors?.answer} hint="Write exactly what LightDesk may tell customers.">
        <Textarea key={`a-${rev}`} name="answer" rows={4} required maxLength={1500} defaultValue={faq?.answer ?? ""} />
      </Field>
      <Field label="Category (optional)" errors={state.fieldErrors?.category}>
        <Input key={`c-${rev}`} name="category" maxLength={60} defaultValue={faq?.category ?? ""} />
      </Field>
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : faq ? "Save changes" : "Add FAQ"}</Button>
    </form>
  );
}
