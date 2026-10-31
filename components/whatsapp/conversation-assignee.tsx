"use client";

import { useActionState } from "react";
import { assignConversationAction } from "@/app/(workspace)/businesses/[businessId]/whatsapp/actions";
import type { ActionState } from "@/lib/validation/action-state";

export function ConversationAssignee({
  businessId,
  conversationId,
  currentAssigneeId,
  members,
  disabled = false,
}: {
  businessId: string;
  conversationId: string;
  currentAssigneeId: string | null;
  members: Array<{
    user: {
      id: string;
      name: string;
      email: string;
    };
  }>;
  disabled?: boolean;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(assignConversationAction, {});

  return (
    <form action={action} className="inline-flex items-center gap-2 text-xs">
      <input type="hidden" name="businessId" value={businessId} />
      <input type="hidden" name="conversationId" value={conversationId} />
      <label htmlFor="assignedToUserId" className="font-medium text-zinc-500 whitespace-nowrap">
        Assignee:
      </label>
      <select
        id="assignedToUserId"
        name="assignedToUserId"
        defaultValue={currentAssigneeId ?? "unassigned"}
        disabled={disabled || pending}
        onChange={(e) => {
          e.currentTarget.form?.requestSubmit();
        }}
        className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-800 shadow-sm transition hover:border-zinc-300 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-50"
      >
        <option value="unassigned">Unassigned</option>
        {members.map((m) => (
          <option key={m.user.id} value={m.user.id}>
            {m.user.name} ({m.user.email})
          </option>
        ))}
      </select>
      {pending && <span className="text-[11px] text-zinc-400 animate-pulse">Saving…</span>}
      {state.error && <span className="text-[11px] text-red-600 font-medium">{state.error}</span>}
    </form>
  );
}
