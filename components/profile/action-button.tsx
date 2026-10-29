"use client";

import { useActionState } from "react";
import type { ActionState } from "@/lib/validation/action-state";

const STYLE = {
  primary: "bg-brand-600 text-white shadow-xs hover:bg-brand-700 active:bg-brand-800 focus-visible:ring-brand-500",
  secondary: "border border-zinc-300/90 bg-white text-zinc-800 shadow-xs hover:border-zinc-400 hover:bg-zinc-50 active:bg-zinc-100 focus-visible:ring-zinc-400",
  danger: "border border-red-200 bg-white text-red-700 shadow-xs hover:border-red-300 hover:bg-red-50 active:bg-red-100 focus-visible:ring-red-400",
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
        className={`inline-flex min-h-[38px] sm:min-h-[36px] items-center justify-center rounded-xl px-3.5 py-1.5 text-xs sm:text-sm font-medium tracking-tight transition-all duration-150 active:scale-[0.98] outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${STYLE[variant]}`}
      >
        {pending ? pendingLabel : label}
      </button>
      {state.error && <p role="alert" className="mt-1.5 max-w-xs text-xs font-medium text-red-600">{state.error}</p>}
      {state.ok && state.message && <p role="status" className="mt-1.5 max-w-xs text-xs font-medium text-emerald-700">{state.message}</p>}
    </form>
  );
}
