"use client";

import { useActionState, useEffect, useRef } from "react";
import { addConversationNoteAction, deleteConversationNoteAction } from "@/app/(workspace)/businesses/[businessId]/whatsapp/actions";
import { Button } from "@/components/ui/button";
import { Alert, Textarea } from "@/components/ui/field";
import { CardTitle } from "@/components/ui/card";
import { fmtDateTime } from "@/components/profile/format";
import type { ActionState } from "@/lib/validation/action-state";

export type NoteItem = {
  id: string;
  content: string;
  createdAt: Date;
  author: { id: string; name: string; email: string };
};

export function ConversationNotes({
  businessId,
  conversationId,
  notes,
  currentUserId,
}: {
  businessId: string;
  conversationId: string;
  notes: NoteItem[];
  currentUserId: string;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(addConversationNoteAction, {});
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  return (
    <section aria-label="Internal staff notes" className="card p-4 sm:p-5 space-y-4">
      <CardTitle
        title={
          <span className="flex items-center gap-2">
            <svg className="h-4 w-4 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
            </svg>
            <span>Internal team notes ({notes.length})</span>
          </span>
        }
        subtitle="Private notes for your team. Never visible to the customer."
      />

      {notes.length === 0 ? (
        <p className="text-xs text-zinc-400 italic py-1">No internal notes yet. Add private instructions, phone notes, or reminders below.</p>
      ) : (
        <ul className="space-y-2.5 max-h-60 overflow-y-auto pr-1">
          {notes.map((n) => (
            <li key={n.id} className="rounded-xl bg-zinc-50 border border-zinc-100 p-3 text-xs space-y-1">
              <div className="flex items-center justify-between text-zinc-500">
                <span className="font-semibold text-zinc-800">{n.author.name}</span>
                <div className="flex items-center gap-2">
                  <span>{fmtDateTime(n.createdAt)}</span>
                  {(n.author.id === currentUserId) && (
                    <form action={async (formData) => { await deleteConversationNoteAction({}, formData); }} className="inline">
                      <input type="hidden" name="businessId" value={businessId} />
                      <input type="hidden" name="conversationId" value={conversationId} />
                      <input type="hidden" name="noteId" value={n.id} />
                      <button
                        type="submit"
                        className="text-red-600 hover:text-red-800 underline font-medium"
                        title="Delete note"
                      >
                        Delete
                      </button>
                    </form>
                  )}
                </div>
              </div>
              <p className="whitespace-pre-line text-zinc-700 leading-relaxed font-sans">{n.content}</p>
            </li>
          ))}
        </ul>
      )}

      <form ref={formRef} action={action} className="space-y-2.5 pt-2 border-t border-zinc-100">
        <input type="hidden" name="businessId" value={businessId} />
        <input type="hidden" name="conversationId" value={conversationId} />
        {state.error && <Alert>{state.error}</Alert>}
        {state.ok && state.message && <Alert tone="success">{state.message}</Alert>}

        <Textarea
          name="content"
          rows={2}
          maxLength={1000}
          required
          placeholder="Add an internal note (e.g. 'Customer called on phone, requested dispatch by 2pm')..."
        />
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={pending} variant="secondary">
            {pending ? "Adding…" : "Add internal note"}
          </Button>
        </div>
      </form>
    </section>
  );
}
