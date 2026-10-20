import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand-600 text-white shadow-sm hover:bg-brand-700 disabled:hover:bg-brand-600",
  secondary: "border border-zinc-300 bg-white text-zinc-800 shadow-sm hover:border-zinc-400 hover:bg-zinc-50",
  danger: "border border-red-200 bg-white text-red-700 shadow-sm hover:border-red-300 hover:bg-red-50",
};

const BASE =
  "inline-flex min-w-0 items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

export function Button({ variant = "primary", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button className={`${BASE} ${VARIANTS[variant]} ${className}`} {...props} />;
}

const SIZE_SM = "px-3 py-1.5";

/** Compact ghost button for secondary inline actions. */
export function GhostButton({ className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`${BASE} ${VARIANTS.secondary} ${SIZE_SM} ${className}`} {...props} />;
}
