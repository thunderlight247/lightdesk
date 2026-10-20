"use client";

import { useActionState } from "react";
import type { ActionState } from "@/lib/validation/action-state";

const STYLE = {
  primary: "bg-brand-600 text-white shadow-sm hover:bg-brand-700",
  secondary: "border border-zinc-300 bg-white text-zinc-800 shadow-sm hover:border-zinc-400 hover:bg-zinc-50",
  danger: "border border-red-200 bg-white text-red-700 shadow-sm hover:border-red-300 hover:bg-red-50",
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
      <button
        type="submit"
        disabled={pending}
        className={`inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${STYLE[variant]}`}
      >
        {pending ? pendingLabel : label}
      </button>
      {state.error && <p role="alert" className="mt-1 max-w-xs text-xs text-red-700">{state.error}</p>}
      {state.ok && state.message && <p role="status" className="mt-1 max-w-xs text-xs text-emerald-800">{state.message}</p>}
    </form>
  );
}
