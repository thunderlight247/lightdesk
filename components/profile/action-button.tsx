"use client";

import { useActionState } from "react";
import type { ActionState } from "@/lib/validation/action-state";

const STYLE = {
  primary: "bg-neutral-900 text-white hover:bg-neutral-700",
  secondary: "border border-neutral-300 bg-white hover:bg-neutral-50",
  danger: "border border-red-300 bg-white text-red-800 hover:bg-red-50",
} as const;

/** One-click server action with inline success/error feedback. Hidden fields carry ids only. */
export function ActionButton({
  action, fields, label, pendingLabel = "Working…", variant = "secondary", confirm,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  fields: Record<string, string>;
  label: string;
  pendingLabel?: string;
  variant?: keyof typeof STYLE;
  confirm?: string;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, {});
  return (
    <form
      action={formAction}
      onSubmit={confirm ? (e) => { if (!window.confirm(confirm)) e.preventDefault(); } : undefined}
      className="inline-block align-top"
    >
      {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <button type="submit" disabled={pending} className={`rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${STYLE[variant]}`}>
        {pending ? pendingLabel : label}
      </button>
      {state.error && <p role="alert" className="mt-1 max-w-xs text-xs text-red-700">{state.error}</p>}
      {state.ok && state.message && <p role="status" className="mt-1 max-w-xs text-xs text-green-800">{state.message}</p>}
    </form>
  );
}
