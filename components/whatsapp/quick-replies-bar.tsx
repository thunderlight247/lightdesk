"use client";

import { useState, useActionState, useRef, useEffect } from "react";
import { createQuickReplyAction, deleteQuickReplyAction } from "@/app/(workspace)/businesses/[businessId]/whatsapp/actions";
import { Button } from "@/components/ui/button";
import { Alert, Field, Input, Textarea } from "@/components/ui/field";
import type { ActionState } from "@/lib/validation/action-state";

export type QuickReplyItem = {
  id: string;
  shortcut: string;
  title: string;
  content: string;
  category: string | null;
};

export function QuickRepliesBar({
  businessId,
  quickReplies,
  onInsertText,
}: {
  businessId: string;
  quickReplies: QuickReplyItem[];
  onInsertText?: (text: string) => void;
}) {
  const [showManager, setShowManager] = useState(false);
  const [copiedShortcut, setCopiedShortcut] = useState<string | null>(null);
  const [createState, createAction, createPending] = useActionState<ActionState, FormData>(createQuickReplyAction, {});
  const createFormRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (createState.ok) {
      createFormRef.current?.reset();
    }
  }, [createState]);

  const handleSelect = (reply: QuickReplyItem) => {
    if (onInsertText) {
      onInsertText(reply.content);
    } else {
      // Find the reply textarea if available
      const textarea = document.querySelector<HTMLTextAreaElement>("textarea[name='text']");
      if (textarea) {
        const currentVal = textarea.value;
        const newVal = currentVal ? `${currentVal}\n${reply.content}` : reply.content;
        textarea.value = newVal;
        // Trigger React's change event if any listener exists
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
        textarea.focus();
      } else {
        navigator.clipboard.writeText(reply.content).catch(() => {});
      }
    }
    setCopiedShortcut(reply.shortcut);
    setTimeout(() => setCopiedShortcut(null), 2000);
  };

  return (
    <div className="space-y-2 border-t border-zinc-100 pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Quick Replies
          </span>
          {copiedShortcut && (
            <span className="text-[11px] font-medium text-emerald-600 animate-fade-in">
              Inserted {copiedShortcut}!
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setShowManager(!showManager)}
          className="text-xs font-medium text-brand-600 hover:text-brand-800 transition"
        >
          {showManager ? "Close shortcuts" : "+ Manage shortcuts"}
        </button>
      </div>

      {quickReplies.length === 0 && !showManager ? (
        <p className="text-xs text-zinc-400 italic">
          No quick replies configured. Click &ldquo;+ Manage shortcuts&rdquo; to add templates like /delivery, /momo, or /hours.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5 overflow-x-auto pb-1">
          {quickReplies.map((qr) => (
            <button
              key={qr.id}
              type="button"
              onClick={() => handleSelect(qr)}
              title={`${qr.title}: ${qr.content}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 shadow-sm transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-900 active:scale-95"
            >
              <span className="font-semibold text-brand-600">{qr.shortcut}</span>
              <span className="text-zinc-500 max-w-[120px] truncate">{qr.title}</span>
            </button>
          ))}
        </div>
      )}

      {showManager && (
        <div className="mt-3 rounded-xl border border-zinc-200 bg-zinc-50/70 p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-zinc-800">Quick Reply Templates</h3>
            <span className="text-[11px] text-zinc-500">Click a chip above to insert into the reply box</span>
          </div>

          {quickReplies.length > 0 && (
            <ul className="space-y-2 max-h-48 overflow-y-auto pr-1">
              {quickReplies.map((qr) => (
                <li
                  key={qr.id}
                  className="flex items-start justify-between gap-3 rounded-lg border border-zinc-200 bg-white p-2.5 text-xs shadow-xs"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-brand-700">{qr.shortcut}</span>
                      <span className="font-medium text-zinc-900 truncate">{qr.title}</span>
                      {qr.category && (
                        <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-600">
                          {qr.category}
                        </span>
                      )}
                    </div>
                    <p className="text-zinc-600 line-clamp-2 text-[11px]">{qr.content}</p>
                  </div>
                  <form
                    action={async (formData) => {
                      await deleteQuickReplyAction({}, formData);
                    }}
                  >
                    <input type="hidden" name="businessId" value={businessId} />
                    <input type="hidden" name="id" value={qr.id} />
                    <button
                      type="submit"
                      className="text-[11px] text-red-600 hover:text-red-800 underline font-medium"
                      title="Delete template"
                    >
                      Delete
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}

          <form ref={createFormRef} action={createAction} className="space-y-3 pt-2 border-t border-zinc-200">
            <h4 className="text-xs font-medium text-zinc-700">Add New Shortcut</h4>
            <input type="hidden" name="businessId" value={businessId} />
            {createState.error && <Alert>{createState.error}</Alert>}
            {createState.ok && createState.message && <Alert tone="success">{createState.message}</Alert>}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Field label="Shortcut" hint="Must start with / (e.g. /delivery, /momo)">
                <Input name="shortcut" required placeholder="/delivery" maxLength={40} />
              </Field>
              <Field label="Title" hint="Brief label (e.g. Delivery terms)">
                <Input name="title" required placeholder="Standard Delivery Info" maxLength={100} />
              </Field>
            </div>

            <Field label="Message Content" hint="The exact text inserted into reply. Up to 1000 characters.">
              <Textarea
                name="content"
                required
                rows={3}
                placeholder="We deliver across Accra within 24 hours. Delivery fee is GHS 30."
                maxLength={1000}
              />
            </Field>

            <Field label="Category (optional)" hint="e.g. Payment, Logistics, FAQ">
              <Input name="category" placeholder="Logistics" maxLength={50} />
            </Field>

            <Button type="submit" disabled={createPending}>
              {createPending ? "Saving shortcut…" : "Save Quick Reply"}
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}
